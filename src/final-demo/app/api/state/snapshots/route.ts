import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { validatorToAddress } from "@lucid-evolution/lucid";
import { fetchHydraHeadStatus, hydraHeadApiUrl, type HydraHead } from "@/lib/hydra-client";
import { getActiveLotteryForHead } from "@/lib/lottery-instances";
import { getHtlcScriptInfo, getLotteryScriptInfo } from "@/lib/hydra/ops-scripts";
import { credentialsPath } from "@/lib/runtime-paths";

type SnapshotRow = {
  ref: string;
  address: string;
  label: string;
  lovelace: string;
  assets: Array<{ unit: string; amount: string }>;
  hasInlineDatum: boolean;
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
    const htlcAddress = validatorToAddress("Custom", { type: "PlutusV3", script: htlc.compiledCode });
    map.set(htlcAddress, "htlc_script");
  } catch {
    // Ignore optional script mapping failures.
  }

  try {
    const lottery = getLotteryScriptInfo();
    const lotteryAddress = validatorToAddress("Custom", { type: "PlutusV3", script: lottery.compiledCode });
    map.set(lotteryAddress, "lottery_script");
  } catch {
    // Ignore optional script mapping failures.
  }

  let activeLottery: { contractAddress: string; assetUnit: string } | null = null;
  try {
    const record = await getActiveLotteryForHead("headB");
    if (record?.contractAddress && record?.assetUnit) {
      activeLottery = {
        contractAddress: record.contractAddress,
        assetUnit: record.assetUnit,
      };
    }
  } catch {
    // Ignore DB lookup failures and still return snapshots.
  }

  return { addressLabels: map, activeLottery };
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

function resolveSnapshotLabel(
  address: string,
  assets: Array<{ unit: string; amount: string }>,
  labels: LabelContext,
): string {
  if (labels.activeLottery && address === labels.activeLottery.contractAddress) {
    const hasActiveAsset = assets.some((asset) => asset.unit === labels.activeLottery?.assetUnit && asset.amount !== "0");
    return hasActiveAsset ? "lottery" : "lottery_ticket";
  }
  return labels.addressLabels.get(address) ?? (address.startsWith("addr_test1w") ? "script_unknown" : "some_user");
}

async function fetchHeadSnapshot(head: HydraHead, labels: LabelContext): Promise<HeadSnapshot> {
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
      return {
        ref,
        address,
        label: resolveSnapshotLabel(address, parsed.assets, labels),
        lovelace: parsed.lovelace,
        assets: parsed.assets,
        hasInlineDatum: Boolean(output?.inlineDatumRaw),
      } satisfies SnapshotRow;
    });
    return { head, status, error: null, utxos, fetchedAt: nowIso };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { head, status, error: message, utxos: [], fetchedAt: nowIso };
  }
}

export async function GET() {
  const labels = await getLabelContext();
  const [headA, headB, headC] = await Promise.all([
    fetchHeadSnapshot("headA", labels),
    fetchHeadSnapshot("headB", labels),
    fetchHeadSnapshot("headC", labels),
  ]);
  return NextResponse.json({
    updatedAt: new Date().toISOString(),
    heads: { headA, headB, headC },
  });
}

