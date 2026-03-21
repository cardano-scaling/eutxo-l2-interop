import { readFileSync } from "node:fs";
import { CML, Data, Lucid, getAddressDetails, validatorToAddress, type LucidEvolution } from "@lucid-evolution/lucid";
import { fetchHydraSnapshot, isRealHydraMode } from "@/lib/hydra-client";
import { getActiveLotteryForHead } from "@/lib/lottery-instances";
import { HydraOpsHandler, txHashFromCbor } from "@/lib/hydra/ops-handler";
import { HydraOpsProvider } from "@/lib/hydra/ops-provider";
import { getHtlcScriptInfo, getLotteryScriptInfo, getParameterizedTicketScriptInfo } from "@/lib/hydra/ops-scripts";
import { ensureHydraSlotConfig } from "@/lib/hydra/slot-config";
import { lucidNetworkName } from "@/lib/hydra/network";
import { HtlcDatum, HtlcRedeemer, type HtlcDatumT, type HtlcRedeemerT } from "@/lib/hydra/ops-htlc-types";
import { LotteryDatum, TicketDatum, type LotteryDatumT, type TicketDatumT } from "@/lib/hydra/ops-lottery-types";
import { assetsToDataPairs, bech32ToDataAddress, dataAddressToBech32, dataPairsToAssets } from "@/lib/hydra/ops-utils";
import { normalizeAddressToBech32 } from "@/lib/hydra/ops-address";
import { credentialsPath } from "@/lib/runtime-paths";

export interface BuyTicketPayload {
  address: string;
  amountLovelace: string;
  sourceHead: "headA" | "headC";
  htlcHash: string;
  timeoutMinutes: string;
  preimage?: string;
  submittedSourceTxHash?: string | null;
  submittedSourceHtlcRef?: string | null;
  submittedHeadBHtlcRef?: string | null;
}

export interface BuyTicketContext {
  workflowId: string;
  correlationId: string;
  attempt: number;
}

export interface BuyTicketResult {
  sourceHead: "headA" | "headC";
  hashRef: string;
  sourceHtlcRef: string;
  headBHtlcRef: string;
  headBAutomationAction: "reused" | "created";
  amountLovelace: string;
  submittedSourceTxHash?: string | null;
  sourceClaimAction: "claimed" | "already_claimed";
  headBClaimAction: "claimed" | "already_claimed";
  sourceClaimTxHash: string | null;
  headBClaimTxHash: string | null;
  pairDetected: boolean;
  claimOrder: Array<"target_head_b" | "source_head">;
}

export class TicketServiceError extends Error {
  code: string;
  retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "TicketServiceError";
    this.code = code;
    this.retryable = retryable;
  }
}

const CLAIM_VALIDITY_OFFSET_MS = 20 * 60 * 1000;

function validatePayload(payload: BuyTicketPayload) {
  const amount = BigInt(payload.amountLovelace);
  if (amount <= 0n) {
    throw new TicketServiceError("BUY_TICKET_INVALID_INPUT", "amountLovelace must be positive", false);
  }
  if (payload.sourceHead !== "headA" && payload.sourceHead !== "headC") {
    throw new TicketServiceError("BUY_TICKET_INVALID_INPUT", "sourceHead must be headA or headC", false);
  }
  if (!/^[0-9a-fA-F]+$/.test(payload.htlcHash.trim())) {
    throw new TicketServiceError("BUY_TICKET_INVALID_INPUT", "htlcHash must be a hex string", false);
  }
  const timeoutMinutes = Number(payload.timeoutMinutes);
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
    throw new TicketServiceError("BUY_TICKET_INVALID_INPUT", "timeoutMinutes must be positive", false);
  }
}

type Head = "headA" | "headB" | "headC";

function headApiUrl(head: Head): string {
  const key = head === "headA"
    ? "HYDRA_HEAD_A_API_URL"
    : head === "headB"
      ? "HYDRA_HEAD_B_API_URL"
      : "HYDRA_HEAD_C_API_URL";
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not configured`);
  return value;
}

async function makeLucidForHead(head: Head): Promise<{ lucid: LucidEvolution; handler: HydraOpsHandler }> {
  ensureHydraSlotConfig();
  const handler = new HydraOpsHandler(headApiUrl(head));
  const lucid = await Lucid(new HydraOpsProvider(handler), lucidNetworkName());
  return { lucid, handler };
}

function paymentKeyHashFromAddress(addressBech32: string): string {
  const details = getAddressDetails(addressBech32);
  const paymentCredential = details.paymentCredential;
  if (!paymentCredential || paymentCredential.type !== "Key") {
    throw new Error("buy_ticket requires key-based payment addresses");
  }
  return paymentCredential.hash;
}

function loadIdaFundsPrivateKeyBech32(): string {
  const skPath = credentialsPath("ida", "ida-funds.sk");
  const skJson = JSON.parse(readFileSync(skPath, "utf8")) as { cborHex: string };
  const skBytes = Buffer.from(skJson.cborHex, "hex");
  const sk = CML.PrivateKey.from_normal_bytes(skBytes.subarray(2));
  return sk.to_bech32();
}

function loadIdaFundsAddressBech32(): string {
  const addrPath = credentialsPath("ida", "ida-funds.addr");
  return readFileSync(addrPath, "utf8").trim();
}

function ticketCostFromLotteryDatum(lotteryUtxo: { datum?: string | null }): bigint {
  const lotteryDatum = Data.from<LotteryDatumT>(lotteryUtxo.datum ?? Data.void(), LotteryDatum);
  return lotteryDatum.ticket_cost;
}

async function readActiveLotteryTicketCostFromHeadB() {
  const activeLottery = await getActiveLotteryForHead("headB");
  if (!activeLottery) throw new Error("No active lottery registered for headB");
  const lotteryInfo = getLotteryScriptInfo();
  const { lucid: headBLucid } = await makeLucidForHead("headB");
  const lotteryUtxos = await headBLucid.utxosAt({ type: "Script", hash: lotteryInfo.hash });
  const lotteryUtxo = lotteryUtxos.find((utxo) => (utxo.assets[activeLottery.assetUnit] ?? 0n) >= 1n);
  if (!lotteryUtxo) {
    throw new Error(`Could not find lottery UTxO for asset ${activeLottery.assetUnit}`);
  }
  return { activeLottery, ticketCost: ticketCostFromLotteryDatum(lotteryUtxo) };
}

function matchesExpectedHeadBDatum(
  datum: HtlcDatumT,
  expected: {
    hash: string;
    idaPaymentKeyHash: string;
    ticketScriptDataAddress: unknown;
    ticketCost: bigint;
    ticketInlineDatum: string;
  },
): boolean {
  const lovelace = datum.desired_output.value.get("")?.get("") ?? 0n;
  const datumMatches = (() => {
    try {
      return Data.to(datum.desired_output.datum as any) === expected.ticketInlineDatum;
    } catch {
      return false;
    }
  })();
  return datum.hash.toLowerCase() === expected.hash.toLowerCase()
    && datum.sender === expected.idaPaymentKeyHash
    && datum.receiver === expected.idaPaymentKeyHash
    && lovelace === expected.ticketCost
    && JSON.stringify(datum.desired_output.address) === JSON.stringify(expected.ticketScriptDataAddress)
    && datumMatches;
}

async function ensureHeadBIdaLock(
  input: { buyerAddress: string; htlcHash: string; timeoutMinutes: string },
): Promise<{ headBHtlcRef: string; action: "reused" | "created" }> {
  const idaAddressBech32 = loadIdaFundsAddressBech32();
  const idaPaymentKeyHash = paymentKeyHashFromAddress(idaAddressBech32);
  const { activeLottery, ticketCost } = await readActiveLotteryTicketCostFromHeadB();
  const buyerAddressBech32 = normalizeAddressToBech32(input.buyerAddress);
  const timeoutMinutes = Number(input.timeoutMinutes);
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
    throw new Error("timeoutMinutes must be a positive number");
  }

  const ticketInfo = getParameterizedTicketScriptInfo(activeLottery.policyId);
  const ticketScriptAddress = validatorToAddress(lucidNetworkName(), { type: "PlutusV3", script: ticketInfo.compiledCode });
  const ticketScriptDataAddress = bech32ToDataAddress(ticketScriptAddress) as any;
  const ticketDatumRaw: TicketDatumT = {
    lottery_id: activeLottery.tokenNameHex,
    desired_output: {
      address: bech32ToDataAddress(buyerAddressBech32) as any,
      datum: null,
    },
  };
  // Mirror offchain/lottery/buy_ticket.ts exactly: first build inline datum with TicketDatum schema.
  const ticketInlineDatum = Data.to(ticketDatumRaw, TicketDatum);
  // HTLC desired_output.datum expects generic Data, so decode that CBOR into Data value for nesting.
  const ticketDatumData = Data.from(ticketInlineDatum);
  const { lucid: headBLucid, handler: headBHandler } = await makeLucidForHead("headB");
  const htlcInfo = getHtlcScriptInfo();
  const htlcScriptAddress = validatorToAddress(lucidNetworkName(), { type: "PlutusV3", script: htlcInfo.compiledCode });
  const htlcUtxos = await headBLucid.utxosAt({ type: "Script", hash: htlcInfo.hash });

  for (const utxo of htlcUtxos) {
    try {
      const datum = Data.from<HtlcDatumT>(utxo.datum ?? Data.void(), HtlcDatum);
      if (matchesExpectedHeadBDatum(datum, {
        hash: input.htlcHash,
        idaPaymentKeyHash,
        ticketScriptDataAddress,
        ticketCost,
        ticketInlineDatum,
      })) {
        return {
          headBHtlcRef: `headB_${utxo.txHash}`,
          action: "reused",
        };
      }
    } catch {
      // ignore non-HTLC-like script outputs
    }
  }

  const headBHtlcDatum: HtlcDatumT = {
    hash: input.htlcHash.toLowerCase(),
    timeout: BigInt(Date.now() + timeoutMinutes * 60_000),
    sender: idaPaymentKeyHash,
    receiver: idaPaymentKeyHash,
    desired_output: {
      address: ticketScriptDataAddress,
      value: assetsToDataPairs({ lovelace: ticketCost }) as any,
      datum: ticketDatumData as any,
    },
  };
  const headBInlineDatum = Data.to<HtlcDatumT>(headBHtlcDatum, HtlcDatum);
  headBLucid.selectWallet.fromPrivateKey(loadIdaFundsPrivateKeyBech32());
  const headBTx = await headBLucid
    .newTx()
    .pay.ToContract(
      htlcScriptAddress,
      { kind: "inline", value: headBInlineDatum },
      { lovelace: ticketCost },
    )
    .complete();
  const headBSigned = await headBTx.sign.withWallet().complete();
  const headBSignedCbor = headBSigned.toCBOR();
  await headBHandler.sendTx(headBSignedCbor);
  const headBTxHash = txHashFromCbor(headBSignedCbor);
  return {
    headBHtlcRef: `headB_${headBTxHash}`,
    action: "created",
  };
}

function normalizePreimageHex(preimage: string): string {
  const preimageHex = preimage.trim().startsWith("0x") ? preimage.trim().slice(2) : preimage.trim();
  if (!/^[0-9a-fA-F]+$/.test(preimageHex)) {
    throw new Error("preimage must be a valid hex string");
  }
  return preimageHex.toLowerCase();
}

function htlcRefToTxHash(ref: string): string | null {
  const parts = ref.split("_");
  if (parts.length < 2) return null;
  return parts.slice(1).join("_").trim() || null;
}

async function claimIdaHtlcOnHead(
  head: "headA" | "headB" | "headC",
  utxo: { txHash: string; outputIndex: number; datum?: string | null },
  preimageHex: string,
  idaAddressBech32: string,
): Promise<string> {
  const { lucid, handler } = await makeLucidForHead(head);
  lucid.selectWallet.fromPrivateKey(loadIdaFundsPrivateKeyBech32());
  const htlcInfo = getHtlcScriptInfo();
  const datum = Data.from<HtlcDatumT>(utxo.datum ?? Data.void(), HtlcDatum);
  const desiredOutputAddress = dataAddressToBech32(lucid, datum.desired_output.address as any);
  const desiredOutputAssets = dataPairsToAssets(datum.desired_output.value as any);
  const timeoutNumber = Number(datum.timeout);
  const validTo = timeoutNumber - CLAIM_VALIDITY_OFFSET_MS;
  if (!Number.isFinite(validTo) || validTo <= 0) {
    throw new TicketServiceError(
      "BUY_TICKET_INVALID_TIMEOUT_RANGE",
      `Invalid timeout value for HTLC claim on ${head} (timeout=${String(datum.timeout)}, validTo=${String(validTo)})`,
      false,
    );
  }
  const claimRedeemer = Data.to<HtlcRedeemerT>({ Claim: [preimageHex] }, HtlcRedeemer);
  const txBuilder = lucid
    .newTx()
    .collectFrom([utxo as any], claimRedeemer)
    .addSigner(idaAddressBech32)
    .attach.Script({ type: "PlutusV3", script: htlcInfo.compiledCode });
  txBuilder.validTo(validTo);
  if (datum.desired_output.datum == null) {
    txBuilder.pay.ToAddress(desiredOutputAddress, desiredOutputAssets);
  } else {
    txBuilder.pay.ToAddressWithData(
      desiredOutputAddress,
      { kind: "inline", value: Data.to(datum.desired_output.datum as any) },
      desiredOutputAssets,
    );
  }
  const tx = await txBuilder.complete();
  const signed = await tx.sign.withWallet().complete();
  const signedCbor = signed.toCBOR();
  await handler.sendTx(signedCbor);
  return txHashFromCbor(signedCbor);
}

async function findSourceHeadHtlc(
  head: "headA" | "headC",
  sourceTxHash: string,
  htlcHash: string,
  idaPaymentKeyHash: string,
): Promise<{ txHash: string; outputIndex: number; datum?: string | null } | null> {
  const { lucid } = await makeLucidForHead(head);
  const htlcInfo = getHtlcScriptInfo();
  const htlcUtxos = await lucid.utxosAt({ type: "Script", hash: htlcInfo.hash });
  return htlcUtxos.find((utxo) => {
    if (utxo.txHash !== sourceTxHash) return false;
    try {
      const datum = Data.from<HtlcDatumT>(utxo.datum ?? Data.void(), HtlcDatum);
      return datum.hash.toLowerCase() === htlcHash.toLowerCase() && datum.receiver === idaPaymentKeyHash;
    } catch {
      return false;
    }
  }) ?? null;
}

async function findHeadBHtlc(
  txHash: string | null,
  htlcHash: string,
  idaPaymentKeyHash: string,
): Promise<{ txHash: string; outputIndex: number; datum?: string | null } | null> {
  const { lucid } = await makeLucidForHead("headB");
  const htlcInfo = getHtlcScriptInfo();
  const htlcUtxos = await lucid.utxosAt({ type: "Script", hash: htlcInfo.hash });
  return htlcUtxos.find((utxo) => {
    if (txHash && utxo.txHash !== txHash) return false;
    try {
      const datum = Data.from<HtlcDatumT>(utxo.datum ?? Data.void(), HtlcDatum);
      return datum.hash.toLowerCase() === htlcHash.toLowerCase() && datum.receiver === idaPaymentKeyHash;
    } catch {
      return false;
    }
  }) ?? null;
}

async function detectIdaHtlcPair(input: {
  sourceHead: "headA" | "headC";
  sourceTxHash: string;
  headBTxHash: string | null;
  htlcHash: string;
  idaPaymentKeyHash: string;
}) {
  const sourceHtlc = await findSourceHeadHtlc(
    input.sourceHead,
    input.sourceTxHash,
    input.htlcHash,
    input.idaPaymentKeyHash,
  );
  const headBHtlc = await findHeadBHtlc(
    input.headBTxHash,
    input.htlcHash,
    input.idaPaymentKeyHash,
  );
  return {
    sourceHtlc,
    headBHtlc,
    pairDetected: Boolean(sourceHtlc && headBHtlc),
  };
}

export async function buyTicket(payload: BuyTicketPayload, _ctx: BuyTicketContext): Promise<BuyTicketResult> {
  validatePayload(payload);
  if (!isRealHydraMode()) {
    throw new TicketServiceError(
      "BUY_TICKET_REAL_MODE_REQUIRED",
      "buy_ticket requires HYDRA_ADAPTER_MODE=real; mock fallback is disabled",
      false,
    );
  }

  if (isRealHydraMode()) {
    const sourceHead = payload.sourceHead;
    const sourceProbe = await fetchHydraSnapshot(sourceHead);
    if (!sourceProbe.ok) {
      throw new TicketServiceError(
        "BUY_TICKET_SOURCE_HEAD_UNAVAILABLE",
        `${sourceHead} is not reachable: ${sourceProbe.reason}`,
        true,
      );
    }
    const headBProbe = await fetchHydraSnapshot("headB");
    if (!headBProbe.ok) {
      throw new TicketServiceError(
        "BUY_TICKET_HEAD_B_UNAVAILABLE",
        `headB is not reachable: ${headBProbe.reason}`,
        true,
      );
    }
  }

  const submittedSourceHtlcRef = payload.submittedSourceHtlcRef?.trim() ?? "";
  const submittedSourceTxHash = payload.submittedSourceTxHash?.trim() ?? "";
  const preimage = payload.preimage?.trim() ?? "";
  if (!submittedSourceTxHash || !submittedSourceHtlcRef) {
    throw new TicketServiceError(
      "BUY_TICKET_REAL_ARTIFACTS_REQUIRED",
      "Waiting for persisted source submit artifacts (submittedSourceTxHash + submittedSourceHtlcRef)",
      true,
    );
  }
  if (!preimage) {
    throw new TicketServiceError(
      "BUY_TICKET_PREIMAGE_REQUIRED",
      "Waiting for persisted preimage before automated Ida claims",
      true,
    );
  }

  let headBAutomationResult: { headBHtlcRef: string; action: "reused" | "created" };
  try {
    headBAutomationResult = await ensureHeadBIdaLock({
      buyerAddress: payload.address,
      htlcHash: payload.htlcHash.trim().toLowerCase(),
      timeoutMinutes: payload.timeoutMinutes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TicketServiceError(
      "BUY_TICKET_IDA_AUTOMATION_FAILED",
      `Failed to automate Ida lock on headB: ${message}`,
      true,
    );
  }
  const idaAddressBech32 = loadIdaFundsAddressBech32();
  const idaPaymentKeyHash = paymentKeyHashFromAddress(idaAddressBech32);
  const preimageHex = normalizePreimageHex(preimage);
  const headBTxHash = htlcRefToTxHash(headBAutomationResult.headBHtlcRef);
  const htlcHash = payload.htlcHash.trim().toLowerCase();
  let pairState = await detectIdaHtlcPair({
    sourceHead: payload.sourceHead,
    sourceTxHash: submittedSourceTxHash,
    headBTxHash,
    htlcHash,
    idaPaymentKeyHash,
  });

  if (!pairState.sourceHtlc) {
    throw new TicketServiceError(
      "BUY_TICKET_SOURCE_HTLC_NOT_FOUND",
      "Waiting for source HTLC visibility on source head before Ida claim",
      true,
    );
  }

  // If target HTLC isn't visible yet, treat as transient and retry later.
  if (!pairState.headBHtlc) {
    throw new TicketServiceError(
      "BUY_TICKET_TARGET_HTLC_NOT_FOUND",
      "Waiting for matching headB HTLC visibility before Ida claim",
      true,
    );
  }

  // Follow src/client semantics: final/target claim first, intermediary/source claim second.
  const claimOrder: Array<"target_head_b" | "source_head"> = [];
  let headBClaimTxHash: string | null = null;
  let sourceClaimTxHash: string | null = null;
  let headBClaimAction: "claimed" | "already_claimed" = "already_claimed";
  let sourceClaimAction: "claimed" | "already_claimed" = "already_claimed";

  if (pairState.headBHtlc) {
    claimOrder.push("target_head_b");
    headBClaimTxHash = await claimIdaHtlcOnHead("headB", pairState.headBHtlc, preimageHex, idaAddressBech32);
    headBClaimAction = "claimed";
  }

  pairState = await detectIdaHtlcPair({
    sourceHead: payload.sourceHead,
    sourceTxHash: submittedSourceTxHash,
    headBTxHash,
    htlcHash,
    idaPaymentKeyHash,
  });
  if (pairState.sourceHtlc) {
    claimOrder.push("source_head");
    sourceClaimTxHash = await claimIdaHtlcOnHead(payload.sourceHead, pairState.sourceHtlc, preimageHex, idaAddressBech32);
    sourceClaimAction = "claimed";
  }

  return {
    sourceHead: payload.sourceHead,
    hashRef: payload.htlcHash.trim().toLowerCase(),
    sourceHtlcRef: submittedSourceHtlcRef,
    headBHtlcRef: headBAutomationResult.headBHtlcRef,
    headBAutomationAction: headBAutomationResult.action,
    amountLovelace: payload.amountLovelace,
    submittedSourceTxHash,
    sourceClaimAction,
    headBClaimAction,
    sourceClaimTxHash,
    headBClaimTxHash,
    pairDetected: pairState.pairDetected,
    claimOrder,
  };
}
