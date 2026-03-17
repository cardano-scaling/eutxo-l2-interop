import {
  CML,
  Data,
  Lucid,
  getAddressDetails,
  validatorToAddress,
  type LucidEvolution,
} from "@lucid-evolution/lucid";
import { readFileSync } from "node:fs";
import { HydraOpsHandler, txHashFromCbor } from "./ops-handler";
import { HydraOpsProvider } from "./ops-provider";
import { getHtlcScriptInfo, getLotteryScriptInfo } from "./ops-scripts";
import { ensureHydraSlotConfig } from "./slot-config";
import { LotteryDatum, type LotteryDatumT } from "./ops-lottery-types";
import { HtlcDatum, type HtlcDatumT } from "./ops-htlc-types";
import type { PrepareBuyTicketInput, PreparedBuyTicketDraft, SubmitBuyTicketInput } from "./ops-types";
import { assetsToDataPairs, bech32ToDataAddress } from "./ops-utils";
import { normalizeAddressToBech32 } from "./ops-address";
import { getActiveLotteryForHead } from "../lottery-instances";
import { logger } from "../logger";
import { credentialsPath } from "@/lib/runtime-paths";

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
  ensureHydraSlotConfig();
  const handler = new HydraOpsHandler(headApiUrl(head));
  const lucid = await Lucid(new HydraOpsProvider(handler), "Custom");
  return { lucid, handler };
}

function ticketCostFromLotteryDatum(lotteryUtxo: { datum?: string | null }): bigint {
  const lotteryDatum = Data.from<LotteryDatumT>(lotteryUtxo.datum ?? Data.void(), LotteryDatum);
  return lotteryDatum.ticket_cost;
}

function paymentKeyHashFromAddress(addressBech32: string): string {
  const details = getAddressDetails(addressBech32);
  const paymentCredential = details.paymentCredential;
  if (!paymentCredential || paymentCredential.type !== "Key") {
    throw new Error("buy_ticket requires key-based payment addresses");
  }
  return paymentCredential.hash;
}

function loadIdaFundsAddressBech32(): string {
  const addrPath = credentialsPath("ida", "ida-funds.addr");
  return readFileSync(addrPath, "utf8").trim();
}

export async function readActiveLotteryTicketCostFromHeadB() {
  const activeLottery = await getActiveLotteryForHead("headB");
  if (!activeLottery) {
    throw new Error("No active lottery registered for headB");
  }
  const lotteryInfo = getLotteryScriptInfo();
  const lotteryUnit = activeLottery.assetUnit;
  const { lucid: headBLucid } = await makeLucidForHead("headB");
  const lotteryUtxos = await headBLucid.utxosAt({ type: "Script", hash: lotteryInfo.hash });
  const lotteryUtxo = lotteryUtxos.find((utxo) => (utxo.assets[lotteryUnit] ?? 0n) >= 1n);
  if (!lotteryUtxo) {
    throw new Error(`Could not find lottery UTxO for asset ${lotteryUnit}`);
  }
  const ticketCost = ticketCostFromLotteryDatum(lotteryUtxo);
  return { activeLottery, ticketCost };
}

export async function prepareBuyTicketDraft(input: PrepareBuyTicketInput): Promise<PreparedBuyTicketDraft> {
  const sourceHead = input.sourceHead as SourceHead;
  const { lucid } = await makeLucidForHead(sourceHead);
  const userAddressBech32 = normalizeAddressToBech32(input.address);
  const userPaymentKeyHash = paymentKeyHashFromAddress(userAddressBech32);
  const idaAddressBech32 = loadIdaFundsAddressBech32();
  const idaPaymentKeyHash = paymentKeyHashFromAddress(idaAddressBech32);
  const userUtxos = await lucid.utxosAt(userAddressBech32);
  logger.info(
    {
      sourceHead,
      userAddressBech32,
      providedAddress: input.address,
      userUtxoCount: userUtxos.length,
    },
    "buy-ticket prepare wallet input selection",
  );
  if (userUtxos.length === 0) {
    logger.warn(
      { sourceHead, userAddressBech32 },
      "buy-ticket prepare found zero UTxOs for selected wallet address",
    );
    throw new Error(
      `Selected wallet address has no spendable UTxOs on ${sourceHead}; cannot create user-funded HTLC`,
    );
  }
  lucid.selectWallet.fromAddress(userAddressBech32, userUtxos);

  const htlcInfo = getHtlcScriptInfo();
  const htlcScriptAddress = validatorToAddress("Custom", { type: "PlutusV3", script: htlcInfo.compiledCode });

  const { ticketCost } = await readActiveLotteryTicketCostFromHeadB();
  const timeoutMinutes = Number(input.timeoutMinutes);
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
    throw new Error("timeoutMinutes must be a positive number");
  }
  const htlcTimeout = BigInt(Date.now() + timeoutMinutes * 60_000);
  const htlcDatum: HtlcDatumT = {
    hash: input.htlcHash.trim().toLowerCase(),
    timeout: htlcTimeout,
    sender: userPaymentKeyHash,
    receiver: idaPaymentKeyHash,
    desired_output: {
      address: bech32ToDataAddress(idaAddressBech32) as any,
      value: assetsToDataPairs({ lovelace: ticketCost }) as any,
      datum: null,
    },
  };
  const inlineDatum = Data.to<HtlcDatumT>(htlcDatum, HtlcDatum);

  const txBuilder = await lucid
    .newTx()
    .pay.ToContract(
      htlcScriptAddress,
      { kind: "inline", value: inlineDatum },
      { lovelace: ticketCost },
    )
    .addSignerKey(userPaymentKeyHash)
    .complete({
      changeAddress: userAddressBech32,
      presetWalletInputs: userUtxos,
    });

  const unsignedTxCborHex = txBuilder.toCBOR();
  const txBodyHash = txBuilder.toHash();
  const nowMs = Date.now();
  return {
    id: crypto.randomUUID(),
    createdAtMs: nowMs,
    expiresAtMs: nowMs + Number(process.env.HYDRA_OPS_DRAFT_TTL_MS ?? 5 * 60 * 1000),
    sourceHead,
    unsignedTxCborHex,
    txBodyHash,
    summary: {
      sourceHead,
      amountLovelace: ticketCost.toString(),
      htlcHash: input.htlcHash.toLowerCase(),
      timeoutMinutes: input.timeoutMinutes,
      desiredOutput: {
        address: idaAddressBech32,
        datum: null,
      },
    },
  };
}

export async function submitBuyTicketDraft(input: SubmitBuyTicketInput): Promise<{
  txHash: string;
  sourceHtlcRef: string;
  headBHtlcRef: string | null;
  hashRef: string;
}> {
  const { handler } = await makeLucidForHead(input.sourceHead);
  const unsignedTx = CML.Transaction.from_cbor_hex(input.unsignedTxCborHex);
  const witnessBuilder = CML.TransactionWitnessSetBuilder.new();
  witnessBuilder.add_existing(unsignedTx.witness_set());
  witnessBuilder.add_existing(CML.TransactionWitnessSet.from_cbor_hex(input.witnessHex));
  const signedTxCborHex = CML.Transaction
    .new(unsignedTx.body(), witnessBuilder.build(), true, unsignedTx.auxiliary_data())
    .to_cbor_hex();
  await handler.sendTx(signedTxCborHex);
  const sourceTxHash = txHashFromCbor(signedTxCborHex);

  return {
    txHash: sourceTxHash,
    hashRef: input.htlcHash.trim().toLowerCase(),
    sourceHtlcRef: `${input.sourceHead}_${sourceTxHash}`,
    headBHtlcRef: null,
  };
}
