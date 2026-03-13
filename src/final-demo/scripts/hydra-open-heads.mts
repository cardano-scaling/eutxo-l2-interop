/**
 * Open both Hydra heads for final-demo topology.
 *
 * This script intentionally lives in src/final-demo and does not modify
 * src/onchain/tests/commit.ts.
 *
 * Run from src/final-demo:
 *   deno run --allow-net --allow-read scripts/hydra-open-heads.mts
 */

import type { Utxo } from "https://deno.land/x/lucid@0.20.14/mod.ts";
import { HydraHandler } from "../../onchain/tests/hydra_handler.ts";
import {
  COMMIT_BACKOFFS,
  COMMIT_RETRIES,
  MIN_COMMIT_LOVELACE,
  commitParticipant,
  loadPrivateKeyHex,
  pickCommitUtxo,
} from "../../onchain/tests/commit.ts";

type Participant = {
  name: "alice" | "bob" | "ida" | "jon";
  api: string;
  skPath: string;
};

const finalDemoRoot = new URL("../", import.meta.url);
const runtimeRoot = new URL("./runtime/", finalDemoRoot);
const l1UtxoFile = new URL("./l1-utxos.json", runtimeRoot).pathname;
const l1ReadyFile = new URL("./l1-utxos.ready", runtimeRoot).pathname;

const infraRoot = new URL("../../infra/", import.meta.url);
const credentialsRoot = new URL("./credentials/", infraRoot).pathname;

const CARDANO_QUERY_API = "http://127.0.0.1:1442";

async function queryAddressUtxos(address: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${CARDANO_QUERY_API}/utxo?address=${encodeURIComponent(address)}`);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`UTxO query failed for ${address}: HTTP ${response.status} ${body.slice(0, 300)}`);
  }
  const data = await response.json();
  return data as Record<string, unknown>;
}

async function refreshL1Utxos(reason: string): Promise<void> {
  console.log(`[l1-utxos] Refreshing from live chain (${reason})...`);

  const aliceAddress = (await Deno.readTextFile(`${credentialsRoot}/alice/alice-funds.addr`)).trim();
  const bobAddress = (await Deno.readTextFile(`${credentialsRoot}/bob/bob-funds.addr`)).trim();
  const idaAddress = (await Deno.readTextFile(`${credentialsRoot}/ida/ida-funds.addr`)).trim();
  const jonAddress = (await Deno.readTextFile(`${credentialsRoot}/jon/jon-funds.addr`)).trim();

  const [alice, bob, ida, jon] = await Promise.all([
    queryAddressUtxos(aliceAddress),
    queryAddressUtxos(bobAddress),
    queryAddressUtxos(idaAddress),
    queryAddressUtxos(jonAddress),
  ]);

  const data = { alice, bob, ida, jon };
  const tmp = `${l1UtxoFile}.tmp`;
  await Deno.writeTextFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
  await Deno.rename(tmp, l1UtxoFile);
  console.log("[l1-utxos] Refreshed runtime/l1-utxos.json");
}

let refreshInFlight: Promise<void> | null = null;
let shutdownInProgress = false;

async function refreshL1UtxosSafe(reason: string): Promise<void> {
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

function installLifecycleRefreshHooks(): void {
  const gracefulExit = (code: number, reason: string) => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    void (async () => {
      await refreshL1UtxosSafe(reason);
      Deno.exit(code);
    })();
  };

  Deno.addSignalListener("SIGINT", () => gracefulExit(130, "signal-SIGINT"));
  Deno.addSignalListener("SIGTERM", () => gracefulExit(143, "signal-SIGTERM"));

  globalThis.addEventListener("unhandledrejection", (event) => {
    event.preventDefault();
    console.error("[l1-utxos] Unhandled rejection", event.reason);
    gracefulExit(1, "unhandledrejection");
  });

  globalThis.addEventListener("error", (event) => {
    console.error("[l1-utxos] Unhandled error", event.error ?? event.message);
    gracefulExit(1, "error");
  });
}

async function loadParticipantUtxos(name: "alice" | "bob" | "ida" | "jon"): Promise<Utxo[]> {
  const raw = JSON.parse(await Deno.readTextFile(l1UtxoFile)) as Record<string, Record<string, { address: string; value: { lovelace: number } }>>;
  const entries = raw[name] ?? {};
  const utxos: Utxo[] = Object.entries(entries).map(([outRef, out]) => {
    const [txHash, idx] = outRef.split("#");
    return {
      txHash,
      outputIndex: Number(idx),
      address: out.address,
      assets: { lovelace: BigInt(out.value.lovelace) },
    };
  });
  utxos.sort((a, b) => Number(a.assets.lovelace - b.assets.lovelace));
  return utxos;
}

const headA = {
  p1: {
    name: "alice",
    api: "http://127.0.0.1:4311",
    skPath: `${credentialsRoot}/alice/alice-funds.sk`,
  } as Participant,
  p2: {
    name: "ida",
    api: "http://127.0.0.1:4319",
    skPath: `${credentialsRoot}/ida/ida-funds.sk`,
  } as Participant,
};

const headB = {
  p1: {
    name: "bob",
    api: "http://127.0.0.1:4322",
    skPath: `${credentialsRoot}/bob/bob-funds.sk`,
  } as Participant,
  p2: {
    name: "ida",
    api: "http://127.0.0.1:4329",
    skPath: `${credentialsRoot}/ida/ida-funds.sk`,
  } as Participant,
  p3: {
    name: "jon",
    api: "http://127.0.0.1:4328",
    skPath: `${credentialsRoot}/jon/jon-funds.sk`,
  } as Participant,
};

async function openHead(
  name: "A" | "B",
  participants: Participant[],
  commitUtxos: Array<Utxo | null>,
) {
  if (participants.length !== commitUtxos.length) {
    throw new Error(`participants (${participants.length}) and commitUtxos (${commitUtxos.length}) length mismatch`);
  }
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Opening final-demo head ${name}: ${participants.map((p) => p.name).join(" + ")}`);
  console.log("=".repeat(60));

  const skByName = new Map<string, string>();
  for (const p of participants) {
    skByName.set(p.name, await loadPrivateKeyHex(p.skPath));
  }

  const h1 = new HydraHandler(participants[0].api);
  const handlers = participants.slice(1).map((p) => new HydraHandler(p.api));
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const status = await h1.initIfNeeded();
  if (status === "Open") {
    console.log(`Head ${name} already open.`);
    h1.stop();
    for (const h of handlers) h.stop();
    return;
  }

  console.log(`[${name}] Committing participants (retries=${COMMIT_RETRIES + 1}, backoffs=${COMMIT_BACKOFFS.join(",")}ms)...`);
  for (let i = 0; i < participants.length; i++) {
    const p = participants[i];
    const skHex = skByName.get(p.name);
    if (!skHex) throw new Error(`Missing signing key for participant ${p.name}`);
    await commitParticipant(p.name, p.api, skHex, commitUtxos[i]);
  }

  console.log(`[${name}] Waiting for HeadIsOpen...`);
  await h1.listen("HeadIsOpen", 120000);
  console.log(`[${name}] HeadIsOpen.`);

  h1.stop();
  for (const h of handlers) h.stop();
}

async function main() {
  installLifecycleRefreshHooks();
  try {
    await Deno.stat(l1ReadyFile);
  } catch {
    console.error(`Infrastructure not ready — missing sentinel ${l1ReadyFile}`);
    Deno.exit(1);
  }

  try {
    await refreshL1Utxos("startup");

    const runOnce = async () => {
      const aliceUtxos = await loadParticipantUtxos("alice");
      const bobUtxos = await loadParticipantUtxos("bob");
      const idaUtxos = await loadParticipantUtxos("ida");
      const jonUtxos = await loadParticipantUtxos("jon");

      const idaEligible = idaUtxos.filter((u) => u.assets.lovelace >= MIN_COMMIT_LOVELACE);
      const idaCommitA = idaEligible.length >= 2 ? idaEligible[0] : pickCommitUtxo(idaUtxos);
      const idaCommitB = idaEligible.length >= 2 ? idaEligible[1] : null;

      const aliceCommit = pickCommitUtxo(aliceUtxos);
      const bobCommit = pickCommitUtxo(bobUtxos);
      const jonCommit = pickCommitUtxo(jonUtxos);

      await openHead("A", [headA.p1, headA.p2], [aliceCommit, idaCommitA]);
      await openHead("B", [headB.p1, headB.p2, headB.p3], [bobCommit, idaCommitB, jonCommit]);
    };

    try {
      await runOnce();
    } catch (error) {
      console.warn("[retry] Opening heads failed on first attempt. Refreshing l1-utxos and retrying once...");
      console.warn(error);
      await refreshL1Utxos("retry-after-failure");
      await runOnce();
    }

    console.log("\nBoth final-demo heads are open.");
  } finally {
    await refreshL1UtxosSafe("main-finally");
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Failed to open final-demo heads:", error);
    Deno.exit(1);
  });
}
