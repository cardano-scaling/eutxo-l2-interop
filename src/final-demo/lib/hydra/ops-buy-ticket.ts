import {
  CML,
  Data,
  Lucid,
  applyParamsToScript,
  fromUnit,
  validatorToAddress,
  type LucidEvolution,
} from "@lucid-evolution/lucid";
import { HydraOpsHandler, txHashFromCbor } from "./ops-handler";
import { HydraOpsProvider } from "./ops-provider";
import { getParameterizedTicketScriptInfo, getLotteryScriptInfo } from "./ops-scripts";
import { LotteryDatum, type LotteryDatumT, TicketDatum, type TicketDatumT } from "./ops-lottery-types";
import { createDraft, takeDraft } from "./ops-draft-store";
import type { PrepareBuyTicketInput, PreparedBuyTicketDraft, SubmitBuyTicketInput } from "./ops-types";
import { desiredOutputToDatum } from "./ops-utils";
import { hexAddressToBech32 } from "./ops-address";
import { getActiveLotteryForHead } from "../lottery-instances";

type SourceHead = "headA" | "headC";
type Head = "headA" | "headB" | "headC";

function headApiUrl(head: Head): string {
  const key = head === "headA"
    ? "HYDRA_HEAD_A_API_URL"
    : head === "headB"
      ? "HYDRA_HEAD_B_API_URL"
      : "HYDRA_HEAD_C_API_URL";
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is not configured`);
  }
  return value;
}

async function makeLucidForHead(head: Head): Promise<{ lucid: LucidEvolution; handler: HydraOpsHandler }> {
  const handler = new HydraOpsHandler(headApiUrl(head));
  const lucid = await Lucid(new HydraOpsProvider(handler), "Custom");
  return { lucid, handler };
}

function ticketCostFromLotteryDatum(lotteryUtxo: { datum?: string | null }): bigint {
  const lotteryDatum = Data.from<LotteryDatumT>(lotteryUtxo.datum ?? Data.void(), LotteryDatum);
  return lotteryDatum.ticket_cost;
}

export async function prepareBuyTicketDraft(input: PrepareBuyTicketInput): Promise<PreparedBuyTicketDraft> {
  const sourceHead = input.sourceHead as SourceHead;
  const { lucid } = await makeLucidForHead(sourceHead);
  const userAddressBech32 = hexAddressToBech32(input.address);
  const userUtxos = await lucid.utxosAt(userAddressBech32);
  lucid.selectWallet.fromAddress(userAddressBech32, userUtxos);

  const lotteryInfo = getLotteryScriptInfo();
  const ticketInfo = getParameterizedTicketScriptInfo(lotteryInfo.hash);
  const ticketScriptAddress = validatorToAddress("Custom", { type: "PlutusV3", script: ticketInfo.compiledCode });

  // Lottery is minted/managed on Head B; source heads only create ticket outputs.
  const activeLottery = await getActiveLotteryForHead("headB");
  if (!activeLottery) {
    throw new Error("No active lottery registered for headB");
  }
  const lotteryUnit = activeLottery.assetUnit;
  const { lucid: headBLucid } = await makeLucidForHead("headB");
  const lotteryUtxos = await headBLucid.utxosAt({ type: "Script", hash: lotteryInfo.hash });
  const lotteryUtxo = lotteryUtxos.find((utxo) => (utxo.assets[lotteryUnit] ?? 0n) >= 1n);
  if (!lotteryUtxo) {
    throw new Error(`Could not find lottery UTxO for asset ${lotteryUnit}`);
  }

  const { assetName } = fromUnit(lotteryUnit);
  if (!assetName) {
    throw new Error("LOTTERY_ASSET is missing token name");
  }

  const ticketCost = ticketCostFromLotteryDatum(lotteryUtxo);
  const desiredOutput = desiredOutputToDatum({
    address: activeLottery.contractAddress,
    datum: null,
  });
  const ticketDatum: TicketDatumT = {
    lottery_id: assetName,
    desired_output: {
      address: desiredOutput.address as any,
      datum: desiredOutput.datum,
    },
  };
  const inlineDatum = Data.to<TicketDatumT>(ticketDatum, TicketDatum);

  const txBuilder = await lucid
    .newTx()
    .pay.ToContract(
      ticketScriptAddress,
      { kind: "inline", value: inlineDatum },
      { lovelace: ticketCost },
    )
    .complete({
      changeAddress: userAddressBech32,
      presetWalletInputs: userUtxos,
    });

  const unsignedTxCborHex = txBuilder.toCBOR();
  const txBodyHash = txBuilder.toHash();
  return createDraft({
    sourceHead,
    unsignedTxCborHex,
    txBodyHash,
    summary: {
      sourceHead,
      amountLovelace: input.amountLovelace,
      htlcHash: input.htlcHash.toLowerCase(),
      desiredOutput: {
        address: activeLottery.contractAddress,
        datum: null,
      },
    },
  });
}

export async function submitBuyTicketDraft(input: SubmitBuyTicketInput): Promise<{
  txHash: string;
  sourceHtlcRef: string;
  headBHtlcRef: string;
  hashRef: string;
}> {
  const draft = takeDraft(input.draftId);
  if (!draft) {
    throw new Error("Draft not found or expired");
  }
  const nowMs = Date.now();
  if (draft.expiresAtMs < nowMs) {
    throw new Error("Draft expired");
  }

  const { handler } = await makeLucidForHead(draft.sourceHead);
  const signBuilder = (await Lucid(new HydraOpsProvider(handler), "Custom"))
    .fromTx(draft.unsignedTxCborHex)
    .assemble([input.witnessHex]);
  const signedTxCborHex = signBuilder.toCBOR();
  await handler.sendTx(signedTxCborHex);
  const txHash = txHashFromCbor(signedTxCborHex);

  return {
    txHash,
    hashRef: draft.summary.htlcHash,
    sourceHtlcRef: `${draft.sourceHead}_${txHash}`,
    headBHtlcRef: `headB_mirror_${txHash.slice(0, 24)}`,
  };
}
