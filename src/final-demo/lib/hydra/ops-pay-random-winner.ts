/**
 * Pay a random lottery winner on Head B and relay prize via HTLC to target head.
 *
 * Flow:
 * 1) lottery PayWinner + ticket Win on headB creates winner HTLC output (from TicketDatum.desired_output)
 * 2) Ida automation ensures paired HTLC on target head (A or C)
 * 3) Ida claims target first, then source (headB)
 */

import { existsSync, readFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import {
  CML,
  Data,
  Lucid,
  credentialToAddress,
  getAddressDetails,
  type LucidEvolution,
  type SpendingValidator,
  type UTxO,
} from "@lucid-evolution/lucid";
import { prisma } from "@/lib/db";
import { getActiveLotteryForHead, type ActiveLotteryInstance } from "@/lib/lottery-instances";
import { HydraOpsHandler, txHashFromCbor } from "@/lib/hydra/ops-handler";
import { HydraOpsProvider } from "@/lib/hydra/ops-provider";
import { getHtlcScriptInfo, getLotteryScriptInfo, getParameterizedTicketScriptInfo } from "@/lib/hydra/ops-scripts";
import { ensureHydraSlotConfig } from "@/lib/hydra/slot-config";
import { lucidNetworkName } from "@/lib/hydra/network";
import {
  LotteryDatum,
  LotteryRedeemer,
  TicketDatum,
  TicketRedeemer,
  type LotteryDatumT,
  type LotteryRedeemerT,
  type OutputReferenceT,
  type TicketDatumT,
  type TicketRedeemerT,
} from "@/lib/hydra/ops-lottery-types";
import { HtlcDatum, HtlcRedeemer, type HtlcDatumT, type HtlcRedeemerT } from "@/lib/hydra/ops-htlc-types";
import { assetsToDataPairs, bech32ToDataAddress, dataAddressToBech32, dataPairsToAssets } from "@/lib/hydra/ops-utils";
import { normalizeAddressToBech32 } from "@/lib/hydra/ops-address";
import { credentialsPath } from "@/lib/runtime-paths";
import { logger } from "@/lib/logger";

type Head = "headA" | "headB" | "headC";

const CLAIM_VALIDITY_OFFSET_MS = 20 * 60 * 1000;

function runtimeUrl(localUrl: string, dockerUrl: string): string {
  return existsSync("/.dockerenv") ? dockerUrl : localUrl;
}

function headApiUrl(head: Head): string {
  if (head === "headA") {
    return process.env.HYDRA_HEAD_A_API_URL ?? runtimeUrl("http://127.0.0.1:4319", "http://hydra-node-ida-1-lt:4319");
  }
  if (head === "headB") {
    return process.env.HYDRA_HEAD_B_API_URL ?? runtimeUrl("http://127.0.0.1:4329", "http://hydra-node-ida-2-lt:4329");
  }
  return process.env.HYDRA_HEAD_C_API_URL ?? runtimeUrl("http://127.0.0.1:4339", "http://hydra-node-ida-3-lt:4339");
}

function headBJonApiUrl(): string {
  return (
    process.env.HYDRA_HEAD_B_JON_API_URL
    ?? runtimeUrl("http://127.0.0.1:4328", "http://hydra-node-jon-lt:4328")
  );
}

function loadKeyBech32(actor: "jon" | "ida"): string {
  const skPath = credentialsPath(actor, `${actor}-funds.sk`);
  const skJson = JSON.parse(readFileSync(skPath, "utf8")) as { cborHex: string };
  const skBytes = Buffer.from(skJson.cborHex, "hex");
  const sk = CML.PrivateKey.from_normal_bytes(skBytes.subarray(2));
  return sk.to_bech32();
}

function loadAddress(actor: "charlie" | "ida"): string {
  return readFileSync(credentialsPath(actor, `${actor}-funds.addr`), "utf8").trim();
}

function paymentKeyHashFromAddress(addressBech32: string): string {
  const details = getAddressDetails(addressBech32);
  const paymentCredential = details.paymentCredential;
  if (!paymentCredential || paymentCredential.type !== "Key") {
    throw new Error("Expected key-based payment address");
  }
  return paymentCredential.hash;
}

function normalizeHexId(s: string): string {
  return s.trim().replace(/^0x/i, "").toLowerCase();
}

function lotteryIdMatches(datumLotteryId: unknown, activeTokenNameHex: string): boolean {
  if (typeof datumLotteryId !== "string") return false;
  return normalizeHexId(datumLotteryId) === normalizeHexId(activeTokenNameHex);
}

async function makeLucidForHead(head: Head): Promise<{ lucid: LucidEvolution; handler: HydraOpsHandler }> {
  ensureHydraSlotConfig();
  const handler = new HydraOpsHandler(headApiUrl(head));
  const lucid = await Lucid(new HydraOpsProvider(handler), lucidNetworkName());
  return { lucid, handler };
}

async function makeLucidForJonHeadB(): Promise<{ lucid: LucidEvolution; handler: HydraOpsHandler }> {
  ensureHydraSlotConfig();
  const handler = new HydraOpsHandler(headBJonApiUrl());
  const lucid = await Lucid(new HydraOpsProvider(handler), lucidNetworkName());
  return { lucid, handler };
}

function pickRandomTicketUtxos(ticketUtxos: UTxO[], activeLottery: ActiveLotteryInstance): UTxO[] {
  const eligible: UTxO[] = [];
  for (const utxo of ticketUtxos) {
    try {
      const ticketDatum = Data.from<TicketDatumT>(utxo.datum ?? Data.void(), TicketDatum);
      if (!lotteryIdMatches(ticketDatum.lottery_id, activeLottery.tokenNameHex)) continue;
      eligible.push(utxo);
    } catch {
      // Ignore invalid ticket datum shapes.
    }
  }
  return eligible;
}

function decodeNestedHtlcDatum(value: unknown): HtlcDatumT {
  return Data.from<HtlcDatumT>(Data.to(value as any), HtlcDatum);
}

async function loadBuyTicketFlowArtifacts(htlcHash: string): Promise<{ preimageHex: string; buyerAddress: string }> {
  const wf = await prisma.workflow.findFirst({
    where: {
      type: "buy_ticket",
      payloadJson: { contains: htlcHash },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!wf?.payloadJson) {
    throw new Error(`Could not find buy_ticket workflow payload for htlcHash=${htlcHash}`);
  }
  const payload = JSON.parse(wf.payloadJson) as { htlcHash?: unknown; preimage?: unknown; address?: unknown };
  const hash = typeof payload.htlcHash === "string" ? payload.htlcHash.trim().toLowerCase() : "";
  const preimage = typeof payload.preimage === "string" ? payload.preimage.trim().toLowerCase() : "";
  const buyerAddressRaw = typeof payload.address === "string" ? payload.address.trim() : "";
  if (hash !== htlcHash.toLowerCase() || !/^[0-9a-f]+$/.test(preimage) || !buyerAddressRaw) {
    throw new Error(`Workflow payload artifacts for htlcHash=${htlcHash} are missing or invalid`);
  }
  return {
    preimageHex: preimage,
    buyerAddress: normalizeAddressToBech32(buyerAddressRaw),
  };
}

async function claimIdaHtlcOnHead(
  head: Head,
  utxo: UTxO,
  preimageHex: string,
  idaAddressBech32: string,
): Promise<string> {
  const { lucid, handler } = await makeLucidForHead(head);
  lucid.selectWallet.fromPrivateKey(loadKeyBech32("ida"));
  const htlcInfo = getHtlcScriptInfo();
  const datum = Data.from<HtlcDatumT>(utxo.datum ?? Data.void(), HtlcDatum);
  const desiredOutputAddress = dataAddressToBech32(lucid, datum.desired_output.address as any);
  const desiredOutputAssets = dataPairsToAssets(datum.desired_output.value as any);
  const timeoutNumber = Number(datum.timeout);
  const validTo = timeoutNumber - CLAIM_VALIDITY_OFFSET_MS;
  if (!Number.isFinite(validTo) || validTo <= 0) {
    throw new Error(`Invalid timeout range on ${head} HTLC claim (timeout=${String(datum.timeout)}, validTo=${String(validTo)})`);
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

async function findMatchingHtlcOnHead(
  head: Head,
  predicate: (datum: HtlcDatumT) => boolean,
): Promise<UTxO | null> {
  const { lucid } = await makeLucidForHead(head);
  const htlcInfo = getHtlcScriptInfo();
  const htlcUtxos = await lucid.utxosAt({ type: "Script", hash: htlcInfo.hash });
  for (const utxo of htlcUtxos) {
    try {
      const datum = Data.from<HtlcDatumT>(utxo.datum ?? Data.void(), HtlcDatum);
      if (predicate(datum)) return utxo;
    } catch {
      // ignore non-HTLC outputs
    }
  }
  return null;
}

function targetHeadFromBuyerAddress(buyerAddress: string, charlieAddress: string): "headA" | "headC" {
  return buyerAddress === charlieAddress ? "headC" : "headA";
}

export type PayRandomLotteryWinnerResult = {
  txHash: string;
  winnerRef: string;
  ticketCandidates: number;
  prizeLovelace: string;
  assetUnit: string;
  hashRef: string;
  sourceHead: "headB";
  targetHead: "headA" | "headC";
  targetHtlcRef: string;
  sourceHtlcRef: string;
  claimOrder: Array<"target_head" | "source_head_b">;
  targetClaimTxHash: string;
  sourceClaimTxHash: string;
};

export type PayRandomLotteryWinnerDraft = {
  txHash: string;
  winnerRef: string;
  ticketCandidates: number;
  prizeLovelace: string;
  assetUnit: string;
  hashRef: string;
};

export async function submitPayRandomLotteryWinnerOnHeadB(): Promise<PayRandomLotteryWinnerDraft> {
  const activeLottery = await getActiveLotteryForHead("headB");
  if (!activeLottery) {
    throw new Error("No active lottery registered for headB");
  }

  const lotteryInfo = getLotteryScriptInfo();
  const ticketInfo = getParameterizedTicketScriptInfo(lotteryInfo.hash);
  const { lucid: headBLucidJon, handler: headBJonHandler } = await makeLucidForJonHeadB();
  headBLucidJon.selectWallet.fromPrivateKey(loadKeyBech32("jon"));

  const lotteryScriptBytes = lotteryInfo.compiledCode;
  const ticketScriptBytes = ticketInfo.compiledCode;

  const lotteryUtxos = await headBLucidJon.utxosAt({ type: "Script", hash: lotteryInfo.hash });
  const lotteryUtxo = lotteryUtxos.find((utxo) => {
    const qty = utxo.assets[activeLottery.assetUnit];
    return qty !== undefined && qty >= 1n;
  });
  if (!lotteryUtxo) {
    throw new Error(`Cannot find lottery UTxO for asset ${activeLottery.assetUnit}`);
  }

  const lotteryDatum = Data.from<LotteryDatumT>(lotteryUtxo.datum ?? Data.void(), LotteryDatum);
  if (lotteryDatum.paid_winner) {
    throw new Error("Lottery already paid a winner (paid_winner is true)");
  }

  const { prize, close_timestamp, admin } = lotteryDatum;
  const closeMs = BigInt(close_timestamp);
  const payWinnerNotBeforeMs = closeMs + 120_000n;
  const nowMs = BigInt(Date.now());
  if (nowMs < payWinnerNotBeforeMs) {
    const closeIso = new Date(Number(closeMs)).toISOString();
    const openIso = new Date(Number(payWinnerNotBeforeMs)).toISOString();
    throw new Error(
      `PayWinner is not valid yet: lottery close_timestamp is ${closeIso} (POSIX ms in datum). `
        + `This build uses validFrom = close (${openIso}). `
        + `Create a lottery with an earlier close (e.g. admin "Close timestamp" near now) for demos, `
        + `or wait until after that instant.`,
    );
  }

  const ticketUtxosAll = await headBLucidJon.utxosAt({ type: "Script", hash: ticketInfo.hash });
  const ticketCandidates = pickRandomTicketUtxos(ticketUtxosAll, activeLottery);
  if (ticketCandidates.length === 0) {
    throw new Error(
      `No lottery ticket UTxOs at parameterized ticket script (hash=${ticketInfo.hash}) with valid TicketDatum for this lottery`,
    );
  }

  const idx = randomInt(0, ticketCandidates.length);
  const winnerUtxo = ticketCandidates[idx]!;
  const ticketDatum = Data.from<TicketDatumT>(winnerUtxo.datum ?? Data.void(), TicketDatum);
  if (ticketDatum.desired_output.datum == null) {
    throw new Error("Winning ticket desired_output.datum must be a full HtlcDatum");
  }
  const sourceHeadBHtlc = decodeNestedHtlcDatum(ticketDatum.desired_output.datum);

  const winnerRef: OutputReferenceT = {
    transaction_id: winnerUtxo.txHash,
    output_index: BigInt(winnerUtxo.outputIndex),
  };

  const lotteryRedeemer = Data.to<LotteryRedeemerT>({ PayWinner: [winnerRef] }, LotteryRedeemer);
  const ticketRedeemer = Data.to<TicketRedeemerT>({ Win: [] }, TicketRedeemer);
  const updatedDatum = Data.to<LotteryDatumT>({ ...lotteryDatum, paid_winner: true }, LotteryDatum);

  const lotteryScript: SpendingValidator = { type: "PlutusV3", script: lotteryScriptBytes };
  const ticketScript: SpendingValidator = { type: "PlutusV3", script: ticketScriptBytes };

  const validFrom = Number(payWinnerNotBeforeMs);
  // const winnerOutputAddress = dataAddressToBech32(headBLucidJon, ticketDatum.desired_output.address as any);
  const winnerPayout = { lovelace: BigInt(prize) };

  const htlcInfo = getHtlcScriptInfo();
  const htlcScriptAddress = credentialToAddress(lucidNetworkName(), { type: "Script", hash: htlcInfo.hash });

  const txBuilder = headBLucidJon
    .newTx()
    .collectFrom([lotteryUtxo], lotteryRedeemer)
    .collectFrom([winnerUtxo], ticketRedeemer)
    .attach.SpendingValidator(lotteryScript)
    .attach.SpendingValidator(ticketScript)
    .pay.ToContract(
      lotteryUtxo.address,
      { kind: "inline", value: updatedDatum },
      Object.fromEntries(
        Object.entries(lotteryUtxo.assets).map(([k, v]) =>
          k === "lovelace" ? [k, v - BigInt(prize)] : [k, v],
        ),
      ),
    )
    .addSignerKey(admin)
    .validFrom(validFrom)
    .pay.ToContract(
      htlcScriptAddress,
      { kind: "inline", value: Data.to<HtlcDatumT>(sourceHeadBHtlc, HtlcDatum) },
      winnerPayout,
    );

  // Debug logs for PayWinner validator failures.
  // lottery.ak checks `output_created` by strict equality against the winning ticket's
  // `TicketDatum.desired_output.address` (+ datum).
  // Here we log both:
  // - required address from the ticket datum
  // - actual created payout address (htlcScriptAddress)
  try {
    const requiredWinnerAddressBech32 = dataAddressToBech32(
      headBLucidJon,
      ticketDatum.desired_output.address as any,
    );
    const hasTicketDesiredOutputDatum = ticketDatum.desired_output.datum != null;
    const sourceHtlcDesiredOutputAddressBech32 = dataAddressToBech32(
      headBLucidJon,
      sourceHeadBHtlc.desired_output.address as any,
    );

    logger.info(
      {
        lotteryRedeemerWinnerRef: `${winnerUtxo.txHash}#${winnerUtxo.outputIndex}`,
        requiredWinnerAddressBech32,
        createdPayoutAddressBech32: htlcScriptAddress,
        ticketDesiredOutputHasDatum: hasTicketDesiredOutputDatum,
        sourceHtlcHash: sourceHeadBHtlc.hash,
        sourceHtlcReceiverPkh: sourceHeadBHtlc.receiver,
        sourceHtlcDesiredOutputAddressBech32: sourceHtlcDesiredOutputAddressBech32,
        validFrom,
      },
      "payRandomLotteryWinner: debug PayWinner output_created inputs",
    );
  } catch (e) {
    logger.warn(
      { err: e instanceof Error ? e.message : String(e) },
      "payRandomLotteryWinner: failed to compute debug addresses",
    );
  }

  const tx = await txBuilder.complete();
  const signed = await tx.sign.withWallet().complete();
  const cbor = signed.toCBOR();
  await headBJonHandler.sendTx(cbor);
  const txHash = txHashFromCbor(cbor);

  return {
    txHash,
    winnerRef: `${winnerUtxo.txHash}#${winnerUtxo.outputIndex}`,
    ticketCandidates: ticketCandidates.length,
    prizeLovelace: prize.toString(),
    assetUnit: activeLottery.assetUnit,
    hashRef: sourceHeadBHtlc.hash.toLowerCase(),
  };
}

export async function relayPayRandomLotteryWinnerOnHeadB(
  draft: PayRandomLotteryWinnerDraft,
): Promise<PayRandomLotteryWinnerResult> {
  const prize = BigInt(draft.prizeLovelace);
  const hashRef = draft.hashRef.toLowerCase();

  const idaAddress = loadAddress("ida");
  const idaPkh = paymentKeyHashFromAddress(idaAddress);
  const charlieAddress = normalizeAddressToBech32(loadAddress("charlie"));

  const { preimageHex, buyerAddress } = await loadBuyTicketFlowArtifacts(hashRef);
  const targetHead = targetHeadFromBuyerAddress(buyerAddress, charlieAddress);

  const sourceHtlc = await findMatchingHtlcOnHead("headB", (datum) =>
    datum.hash.toLowerCase() === hashRef
    && datum.receiver.toLowerCase() === idaPkh.toLowerCase(),
  );
  if (!sourceHtlc) {
    // Retryable visibility race: caller should retry this relay/confirm step.
    throw new Error("Winner payout source HTLC on headB is not visible yet");
  }

  // Use the timeout from the actual snapshot HTLC (outer datum) so the target HTLC matches validator expectations.
  const sourceHtlcDatum = Data.from<HtlcDatumT>(sourceHtlc.datum ?? Data.void(), HtlcDatum);

  const lotteryHtlcInfo = getHtlcScriptInfo();
  const htlcScriptAddress = credentialToAddress(lucidNetworkName(), { type: "Script", hash: lotteryHtlcInfo.hash });

  const targetHtlcDatum: HtlcDatumT = {
    hash: hashRef,
    timeout: sourceHtlcDatum.timeout,
    sender: idaPkh,
    receiver: idaPkh,
    desired_output: {
      address: bech32ToDataAddress(normalizeAddressToBech32(buyerAddress)) as any,
      value: assetsToDataPairs({ lovelace: prize }) as any,
      datum: null,
    },
  };

  let targetHtlc = await findMatchingHtlcOnHead(targetHead, (datum) =>
    datum.hash.toLowerCase() === hashRef
    && datum.receiver.toLowerCase() === idaPkh.toLowerCase()
    && (datum.desired_output.value.get("")?.get("") ?? 0n) === prize,
  );

  if (!targetHtlc) {
    const { lucid: targetLucid, handler: targetHandler } = await makeLucidForHead(targetHead);
    targetLucid.selectWallet.fromPrivateKey(loadKeyBech32("ida"));
    const inlineTargetDatum = Data.to<HtlcDatumT>(targetHtlcDatum, HtlcDatum);
    const lockTx = await targetLucid
      .newTx()
      .pay.ToContract(
        htlcScriptAddress,
        { kind: "inline", value: inlineTargetDatum },
        { lovelace: prize },
      )
      .complete();
    const lockSigned = await lockTx.sign.withWallet().complete();
    const lockCbor = lockSigned.toCBOR();
    await targetHandler.sendTx(lockCbor);

    targetHtlc = await findMatchingHtlcOnHead(targetHead, (datum) =>
      datum.hash.toLowerCase() === hashRef
      && datum.receiver.toLowerCase() === idaPkh.toLowerCase()
      && (datum.desired_output.value.get("")?.get("") ?? 0n) === prize,
    );
    if (!targetHtlc) {
      throw new Error(`Created target ${targetHead} HTLC but could not re-read it from snapshot`);
    }
  }

  // Mandatory order: claim target first, then source headB.
  const targetClaimTxHash = await claimIdaHtlcOnHead(targetHead, targetHtlc, preimageHex, idaAddress);
  const sourceClaimTxHash = await claimIdaHtlcOnHead("headB", sourceHtlc, preimageHex, idaAddress);

  logger.info(
    {
      winnerRef: draft.winnerRef,
      ticketCandidates: draft.ticketCandidates,
      prize: prize.toString(),
      sourceHead: "headB",
      targetHead,
      hashRef,
      targetClaimTxHash,
      sourceClaimTxHash,
    },
    "payRandomLotteryWinner: completed HTLC relay target->source",
  );

  return {
    txHash: draft.txHash,
    winnerRef: draft.winnerRef,
    ticketCandidates: draft.ticketCandidates,
    prizeLovelace: draft.prizeLovelace,
    assetUnit: draft.assetUnit,
    hashRef,
    sourceHead: "headB",
    targetHead,
    targetHtlcRef: `${targetHead}_${targetHtlc.txHash}`,
    sourceHtlcRef: `headB_${sourceHtlc.txHash}`,
    claimOrder: ["target_head", "source_head_b"],
    targetClaimTxHash,
    sourceClaimTxHash,
  };
}

export async function payRandomLotteryWinnerOnHeadB(): Promise<PayRandomLotteryWinnerResult> {
  const draft = await submitPayRandomLotteryWinnerOnHeadB();
  return relayPayRandomLotteryWinnerOnHeadB(draft);
}
