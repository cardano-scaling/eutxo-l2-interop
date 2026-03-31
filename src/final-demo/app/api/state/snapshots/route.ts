import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { Data, credentialToAddress, validatorToAddress } from "@lucid-evolution/lucid";
import { fetchHydraHeadStatus, hydraHeadApiUrl, type HydraHead } from "@/lib/hydra-client";
import { getActiveLotteryForHead } from "@/lib/lottery-instances";
import { getHtlcScriptInfo, getLotteryScriptInfo, getParameterizedTicketScriptInfo } from "@/lib/hydra/ops-scripts";
import { TicketDatum, type TicketDatumT } from "@/lib/hydra/ops-lottery-types";
import { HtlcDatum, type HtlcDatumT } from "@/lib/hydra/ops-htlc-types";
import { lucidNetworkName } from "@/lib/hydra/network";
import { credentialsPath } from "@/lib/runtime-paths";

type SnapshotRow = {
  ref: string;
  address: string;
  label: string;
  lovelace: string;
  assets: Array<{ unit: string; amount: string }>;
  hasInlineDatum: boolean;
  inlineDatum: unknown | null;
};

type HeadSnapshot = {
  head: HydraHead;
  status: string;
  error: string | null;
  utxos: SnapshotRow[];
  fetchedAt: string;
};

type LabelContext = {
  addressLabels: Map<string, string>;
  activeLottery: { contractAddress: string; assetUnit: string } | null;
  ticketScriptAddress: string | null;
};

function readAddress(actor: "alice" | "bob" | "charlie" | "ida" | "jon"): string | null {
  try {
    return readFileSync(credentialsPath(actor, `${actor}-funds.addr`), "utf8").trim();
  } catch {
    return null;
  }
}

async function getLabelContext(): Promise<LabelContext> {
  const map = new Map<string, string>();
  const alice = readAddress("alice");
  const bob = readAddress("bob");
  const charlie = readAddress("charlie");
  const ida = readAddress("ida");
  const jon = readAddress("jon");
  if (alice) map.set(alice, "alice");
  if (bob) map.set(bob, "bob");
  if (charlie) map.set(charlie, "charlie");
  if (ida) map.set(ida, "ida");
  if (jon) map.set(jon, "jon");

  try {
    const htlc = getHtlcScriptInfo();
    const htlcAddress = validatorToAddress(lucidNetworkName(), { type: "PlutusV3", script: htlc.compiledCode });
    map.set(htlcAddress, "htlc_script");
  } catch {
    // Ignore optional script mapping failures.
  }

  try {
    const lottery = getLotteryScriptInfo();
    const lotteryAddress = validatorToAddress(lucidNetworkName(), { type: "PlutusV3", script: lottery.compiledCode });
    map.set(lotteryAddress, "lottery_script");
  } catch {
    // Ignore optional script mapping failures.
  }

  let activeLottery: { contractAddress: string; assetUnit: string } | null = null;
  let ticketScriptAddress: string | null = null;
  try {
    const record = await getActiveLotteryForHead("headB");
    if (record?.contractAddress && record?.assetUnit) {
      activeLottery = {
        contractAddress: record.contractAddress,
        assetUnit: record.assetUnit,
      };
      const ticket = getParameterizedTicketScriptInfo(record.policyId);
      ticketScriptAddress = validatorToAddress(lucidNetworkName(), { type: "PlutusV3", script: ticket.compiledCode });
    }
  } catch {
    // Ignore DB lookup failures and still return snapshots.
  }

  return { addressLabels: map, activeLottery, ticketScriptAddress };
}

function parseAssets(value: Record<string, unknown>): { lovelace: string; assets: Array<{ unit: string; amount: string }> } {
  const lovelaceRaw = (value?.lovelace as number | string | undefined) ?? 0;
  const lovelace = String(lovelaceRaw);
  const assets: Array<{ unit: string; amount: string }> = [];
  for (const [policy, nested] of Object.entries(value ?? {})) {
    if (policy === "lovelace") continue;
    if (!nested || typeof nested !== "object") continue;
    for (const [tokenNameHex, amount] of Object.entries(nested as Record<string, number | string>)) {
      assets.push({ unit: `${policy}${tokenNameHex}`, amount: String(amount) });
    }
  }
  return { lovelace, assets };
}

function addressesEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function resolveSnapshotLabel(
  address: string,
  assets: Array<{ unit: string; amount: string }>,
  labels: LabelContext,
  ownWalletAddress: string | null,
): string {
  if (labels.ticketScriptAddress && address === labels.ticketScriptAddress) {
    return "lottery_ticket";
  }
  if (labels.activeLottery && address === labels.activeLottery.contractAddress) {
    const hasActiveAsset = assets.some((asset) => asset.unit === labels.activeLottery?.assetUnit && asset.amount !== "0");
    return hasActiveAsset ? "lottery" : "lottery_script";
  }
  const known = labels.addressLabels.get(address);
  if (known) return known;
  if (ownWalletAddress && addressesEqual(address, ownWalletAddress)) {
    return "some_user (you)";
  }
  return "some_user";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function adminPkhToBech32Address(adminPkhHex: string): string {
  return credentialToAddress(lucidNetworkName(), { type: "Key", hash: adminPkhHex });
}

function dataCredentialToAddress(add: {
  payment_credential: { Verification_key_cred: { Key: string } } | { Script_cred: { Key: string } };
  stake_credential: { inline: { Verification_key_cred: { Key: string } } | { Script_cred: { Key: string } } } | null;
}): string {
  const extractCredential = (cred: { Verification_key_cred?: { Key: string }; Script_cred?: { Key: string } }) =>
    cred.Verification_key_cred
      ? { type: "Key" as const, hash: cred.Verification_key_cred.Key }
      : { type: "Script" as const, hash: cred.Script_cred!.Key };
  const payment = extractCredential(add.payment_credential);
  const stake = add.stake_credential?.inline ? extractCredential(add.stake_credential.inline) : undefined;
  return credentialToAddress(lucidNetworkName(), payment, stake);
}

function decorateLotteryTicketInlineDatum(inlineDatum: unknown, inlineDatumRaw: unknown): unknown {
  if (typeof inlineDatumRaw !== "string" || inlineDatumRaw.trim().length === 0) return inlineDatum;
  try {
    const parsed = Data.from<TicketDatumT>(inlineDatumRaw, TicketDatum);
    const desiredOutputAddress = dataCredentialToAddress(parsed.desired_output.address);
    let payoutHash: string | null = null;
    let payoutReceiverPkh: string | null = null;
    let payoutFinalAddress: string | null = null;
    try {
      if (parsed.desired_output.datum != null) {
        const nested = Data.from<HtlcDatumT>(Data.to(parsed.desired_output.datum as any), HtlcDatum);
        payoutHash = nested.hash;
        payoutReceiverPkh = nested.receiver;
        payoutFinalAddress = dataCredentialToAddress(nested.desired_output.address);
      }
    } catch {
      // Keep summary resilient for legacy ticket datum shapes.
    }
    const lotteryId = parsed.lottery_id;
    const root = asRecord(inlineDatum);
    return {
      ...(root ?? {}),
      __ticketSummary: {
        desiredOutputAddress,
        lotteryId,
        payoutHash,
        payoutReceiverPkh,
        payoutFinalAddress,
      },
    };
  } catch {
    return inlineDatum;
  }
}

function decorateHtlcInlineDatum(inlineDatum: unknown, inlineDatumRaw: unknown): unknown {
  if (typeof inlineDatumRaw !== "string" || inlineDatumRaw.trim().length === 0) return inlineDatum;
  try {
    const parsed = Data.from<HtlcDatumT>(inlineDatumRaw, HtlcDatum);
    const desiredOutputAddress = dataCredentialToAddress(parsed.desired_output.address);
    const desiredLovelace = parsed.desired_output.value.get("")?.get("") ?? 0n;
    const root = asRecord(inlineDatum);
    return {
      ...(root ?? {}),
      __htlcSummary: {
        hash: parsed.hash,
        timeoutMs: parsed.timeout.toString(),
        senderPkh: parsed.sender,
        receiverPkh: parsed.receiver,
        desiredOutputAddress,
        desiredLovelace: desiredLovelace.toString(),
        hasDesiredDatum: parsed.desired_output.datum != null,
      },
    };
  } catch {
    return inlineDatum;
  }
}

function decorateLotteryInlineDatum(inlineDatum: unknown): unknown {
  const root = asRecord(inlineDatum);
  if (!root) return inlineDatum;

  // Aiken JSON-like object shape: { fields: [prize, ticket_cost, paid_winner, close_timestamp, admin] }
  const fields = Array.isArray(root.fields) ? [...root.fields] : null;
  if (fields && fields.length >= 5) {
    const admin = asRecord(fields[4]);
    if (admin && typeof admin.bytes === "string") {
      try {
        const bech32 = adminPkhToBech32Address(admin.bytes);
        fields[4] = { ...admin, bech32 };
        return { ...root, fields };
      } catch {
        return inlineDatum;
      }
    }
  }

  // Direct object shape fallback: { admin: { bytes: "<pkh>" }, ... }
  if ("admin" in root) {
    const admin = asRecord(root.admin);
    if (admin && typeof admin.bytes === "string") {
      try {
        const bech32 = adminPkhToBech32Address(admin.bytes);
        return { ...root, admin: { ...admin, bech32 } };
      } catch {
        return inlineDatum;
      }
    }
  }

  return inlineDatum;
}

async function fetchHeadSnapshot(
  head: HydraHead,
  labels: LabelContext,
  ownWalletAddress: string | null,
): Promise<HeadSnapshot> {
  const nowIso = new Date().toISOString();
  const statusProbe = await fetchHydraHeadStatus(head);
  const status = statusProbe.ok ? statusProbe.status : "unreachable";
  const baseUrl = hydraHeadApiUrl(head);

  if (!baseUrl) {
    return { head, status, error: `${head} API URL is not configured`, utxos: [], fetchedAt: nowIso };
  }
  if (status !== "open") {
    return {
      head,
      status,
      error: statusProbe.ok ? null : statusProbe.reason,
      utxos: [],
      fetchedAt: nowIso,
    };
  }

  try {
    const response = await fetch(`${baseUrl}/snapshot/utxo`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return {
        head,
        status,
        error: `snapshot/utxo returned ${response.status}`,
        utxos: [],
        fetchedAt: nowIso,
      };
    }
    const snapshot = await response.json() as Record<string, any>;
    const utxos = Object.entries(snapshot).map(([ref, output]) => {
      const address = String(output?.address ?? "");
      const parsed = parseAssets((output?.value ?? {}) as Record<string, unknown>);
      const label = resolveSnapshotLabel(address, parsed.assets, labels, ownWalletAddress);
      return {
        ref,
        address,
        label,
        lovelace: parsed.lovelace,
        assets: parsed.assets,
        hasInlineDatum: Boolean(output?.inlineDatumRaw),
        inlineDatum: label === "lottery"
          ? decorateLotteryInlineDatum(output?.inlineDatum ?? null)
          : label === "lottery_ticket"
            ? decorateLotteryTicketInlineDatum(output?.inlineDatum ?? null, output?.inlineDatumRaw)
            : label === "htlc_script"
              ? decorateHtlcInlineDatum(output?.inlineDatum ?? null, output?.inlineDatumRaw)
            : (output?.inlineDatum ?? null),
      } satisfies SnapshotRow;
    });
    return { head, status, error: null, utxos, fetchedAt: nowIso };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { head, status, error: message, utxos: [], fetchedAt: nowIso };
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ownWalletAddress = url.searchParams.get("self")?.trim() || null;
  const labels = await getLabelContext();
  const [headA, headB, headC] = await Promise.all([
    fetchHeadSnapshot("headA", labels, ownWalletAddress),
    fetchHeadSnapshot("headB", labels, ownWalletAddress),
    fetchHeadSnapshot("headC", labels, ownWalletAddress),
  ]);
  return NextResponse.json({
    updatedAt: new Date().toISOString(),
    heads: { headA, headB, headC },
  });
}

