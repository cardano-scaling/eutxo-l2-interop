import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Utxo } from "../node-hydra-handler";
import { CARDANO_QUERY_API, credentialsRoot, l1UtxoFile } from "./config";
import type { L1ChainUtxo, L1UtxoSnapshot } from "./types";

async function readTrimmed(path: string): Promise<string> {
  return (await readFile(path, "utf8")).trim();
}

async function queryAddressUtxos(address: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${CARDANO_QUERY_API}/utxo?address=${encodeURIComponent(address)}`);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`UTxO query failed for ${address}: HTTP ${response.status} ${body.slice(0, 300)}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

export async function refreshL1Utxos(reason: string): Promise<void> {
  console.log(`[l1-utxos] Refreshing from live chain (${reason})...`);

  const aliceAddress = await readTrimmed(join(credentialsRoot, "alice", "alice-funds.addr"));
  const bobAddress = await readTrimmed(join(credentialsRoot, "bob", "bob-funds.addr"));
  const idaAddress = await readTrimmed(join(credentialsRoot, "ida", "ida-funds.addr"));
  const jonAddress = await readTrimmed(join(credentialsRoot, "jon", "jon-funds.addr"));
  const charlieAddress = await readTrimmed(join(credentialsRoot, "charlie", "charlie-funds.addr"));

  const [alice, bob, ida, jon, charlie] = await Promise.all([
    queryAddressUtxos(aliceAddress),
    queryAddressUtxos(bobAddress),
    queryAddressUtxos(idaAddress),
    queryAddressUtxos(jonAddress),
    queryAddressUtxos(charlieAddress),
  ]);

  const data = { alice, bob, ida, jon, charlie };
  const tmp = `${l1UtxoFile}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmp, l1UtxoFile);
  console.log("[l1-utxos] Refreshed runtime/l1-utxos.json");
}

let refreshInFlight: Promise<void> | null = null;
let shutdownInProgress = false;

export async function refreshL1UtxosSafe(reason: string): Promise<void> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        await refreshL1Utxos(reason);
      } catch (error) {
        console.warn(`[l1-utxos] Best-effort refresh failed (${reason})`, error);
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  await refreshInFlight;
}

export function installLifecycleRefreshHooks(): void {
  const gracefulExit = (code: number, reason: string) => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    void (async () => {
      await refreshL1UtxosSafe(reason);
      process.exit(code);
    })();
  };

  process.on("SIGINT", () => gracefulExit(130, "signal-SIGINT"));
  process.on("SIGTERM", () => gracefulExit(143, "signal-SIGTERM"));
  process.on("unhandledRejection", (error) => {
    console.error("[l1-utxos] Unhandled rejection", error);
    gracefulExit(1, "unhandledRejection");
  });
  process.on("uncaughtException", (error) => {
    console.error("[l1-utxos] Unhandled error", error);
    gracefulExit(1, "uncaughtException");
  });
}

function isPlainKeyLovelaceOnlyUtxo(out: L1ChainUtxo): out is { address: string; value: { lovelace: number } } {
  if (typeof out.address !== "string") return false;
  if (!out.address.startsWith("addr_test1v")) return false;
  if (out.inlineDatum != null) return false;
  if (out.referenceScript != null) return false;
  if (!out.value || typeof out.value.lovelace !== "number") return false;
  const nonAdaAssets = Object.keys(out.value).filter((k) => k !== "lovelace");
  return nonAdaAssets.length === 0;
}

export async function loadParticipantUtxos(name: "alice" | "bob" | "ida" | "jon" | "charlie"): Promise<Utxo[]> {
  const raw = JSON.parse(await readFile(l1UtxoFile, "utf8")) as L1UtxoSnapshot;
  const entries = raw[name] ?? {};
  const utxos: Utxo[] = [];
  for (const [outRef, out] of Object.entries(entries)) {
    if (!isPlainKeyLovelaceOnlyUtxo(out)) continue;
    const [txHash, idx] = outRef.split("#");
    utxos.push({
      txHash,
      outputIndex: Number(idx),
      address: out.address,
      assets: { lovelace: BigInt(out.value.lovelace) },
    });
  }
  utxos.sort((a, b) => Number(a.assets.lovelace - b.assets.lovelace));
  return utxos;
}
