import { existsSync } from "node:fs";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HydraHandler, type Utxo } from "./lib/node-hydra-handler";
import {
  COMMIT_BACKOFFS,
  COMMIT_RETRIES,
  MIN_COMMIT_LOVELACE,
  commitParticipant,
  loadPrivateKeyHex,
  pickCommitUtxo,
} from "./lib/node-commit-utils";

type Participant = {
  name: "alice" | "bob" | "ida" | "jon" | "charlie";
  api: string;
  skPath: string;
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const finalDemoRoot = dirname(scriptDir);
const runtimeRoot = join(finalDemoRoot, "runtime");
const l1UtxoFile = join(runtimeRoot, "l1-utxos.json");
const l1ReadyFile = join(runtimeRoot, "l1-utxos.ready");
const credentialsRoot = join(finalDemoRoot, "credentials");
const isDockerRuntime = existsSync("/.dockerenv");

function runtimeUrl(localUrl: string, dockerUrl: string): string {
  return isDockerRuntime ? dockerUrl : localUrl;
}

const CARDANO_QUERY_API = process.env.CARDANO_QUERY_API_URL
  ?? runtimeUrl("http://127.0.0.1:1442", "http://cardano-node:1442");

async function queryAddressUtxos(address: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${CARDANO_QUERY_API}/utxo?address=${encodeURIComponent(address)}`);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`UTxO query failed for ${address}: HTTP ${response.status} ${body.slice(0, 300)}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

async function readTrimmed(path: string): Promise<string> {
  return (await readFile(path, "utf8")).trim();
}

async function refreshL1Utxos(reason: string): Promise<void> {
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

type L1AddressUtxoMap = Record<string, { address: string; value: { lovelace: number } }>;
type L1UtxoSnapshot = Record<string, L1AddressUtxoMap>;

async function loadParticipantUtxos(name: "alice" | "bob" | "ida" | "jon" | "charlie"): Promise<Utxo[]> {
  const raw = JSON.parse(await readFile(l1UtxoFile, "utf8")) as L1UtxoSnapshot;
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
    api: process.env.HYDRA_HEAD_A_ALICE_API_URL ?? runtimeUrl("http://127.0.0.1:4311", "http://hydra-node-alice-lt:4311"),
    skPath: join(credentialsRoot, "alice", "alice-funds.sk"),
  } as Participant,
  p2: {
    name: "ida",
    api: process.env.HYDRA_HEAD_A_API_URL ?? runtimeUrl("http://127.0.0.1:4319", "http://hydra-node-ida-1-lt:4319"),
    skPath: join(credentialsRoot, "ida", "ida-funds.sk"),
  } as Participant,
};

const headB = {
  p1: {
    name: "bob",
    api: process.env.HYDRA_HEAD_B_BOB_API_URL ?? runtimeUrl("http://127.0.0.1:4322", "http://hydra-node-bob-lt:4322"),
    skPath: join(credentialsRoot, "bob", "bob-funds.sk"),
  } as Participant,
  p2: {
    name: "ida",
    api: process.env.HYDRA_HEAD_B_API_URL ?? runtimeUrl("http://127.0.0.1:4329", "http://hydra-node-ida-2-lt:4329"),
    skPath: join(credentialsRoot, "ida", "ida-funds.sk"),
  } as Participant,
  p3: {
    name: "jon",
    api: process.env.HYDRA_HEAD_B_JON_API_URL ?? runtimeUrl("http://127.0.0.1:4328", "http://hydra-node-jon-lt:4328"),
    skPath: join(credentialsRoot, "jon", "jon-funds.sk"),
  } as Participant,
};

const headC = {
  p1: {
    name: "charlie",
    api: process.env.HYDRA_HEAD_C_CHARLIE_API_URL ?? runtimeUrl("http://127.0.0.1:4333", "http://hydra-node-charlie-lt:4333"),
    skPath: join(credentialsRoot, "charlie", "charlie-funds.sk"),
  } as Participant,
  p2: {
    name: "ida",
    api: process.env.HYDRA_HEAD_C_IDA_API_URL ?? process.env.HYDRA_HEAD_C_API_URL ?? runtimeUrl("http://127.0.0.1:4339", "http://hydra-node-ida-3-lt:4339"),
    skPath: join(credentialsRoot, "ida", "ida-funds.sk"),
  } as Participant,
};

type Operation =
  | "open_head_a"
  | "open_head_b"
  | "open_heads_ab"
  | "commit_head_c_charlie"
  | "commit_head_c_admin";

function parseOperation(argv: string[]): Operation {
  if (argv.includes("--open-head-a")) return "open_head_a";
  if (argv.includes("--open-head-b")) return "open_head_b";
  if (argv.includes("--commit-head-c-admin")) return "commit_head_c_admin";
  if (argv.includes("--commit-head-c-charlie")) return "commit_head_c_charlie";
  return "open_heads_ab";
}

async function commitHeadCParticipant(
  participant: Participant,
  counterpart: Participant,
  commitUtxo: Utxo | null,
): Promise<void> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Partial init head C: committing ${participant.name} funds`);
  console.log("=".repeat(60));
  const statusHandler = new HydraHandler(participant.api);
  let status: "Idle" | "Initial" | "Open" | "Closed" | "FanoutPossible" | "Final";
  try {
    status = await statusHandler.initIfNeeded();
  } catch (error) {
    // Idempotent fallback: during concurrent retries, init transition may already be in-flight.
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Timeout waiting for HeadIsInitializing")) {
      statusHandler.stop();
      throw error;
    }
    const current = await statusHandler.getHeadStatus();
    if (current === "Initial" || current === "Open") {
      status = current;
      console.log(`Head C status already ${current}; continuing without re-init.`);
    } else {
      statusHandler.stop();
      throw error;
    }
  }
  if (status === "Open") {
    console.log("Head C already open.");
    statusHandler.stop();
    return;
  }
  // IMPORTANT: "Initial" does NOT imply this participant already committed.
  // It may only mean InitTx exists and the head is awaiting participant commits.
  // So we still continue and attempt the participant commit below.
  statusHandler.stop();
  if (!commitUtxo) {
    if (status === "Initial") {
      // Idempotent path for retried calls where commit input may have been consumed already.
      const openWatcher = new HydraHandler(counterpart.api);
      try {
        try {
          await openWatcher.listen("HeadIsOpen", 30_000);
          console.log("Head C is now open.");
          return;
        } catch {
          console.log(
            "Head C is initializing but no eligible commit UTxO was found for this participant. Waiting for counterpart/open completion.",
          );
          return;
        }
      } finally {
        openWatcher.stop();
      }
    }
    throw new Error(
      `HEAD_C_COMMIT_PRECONDITION_FAILED: ${participant.name} needs at least 2 eligible UTxOs (one kept as Hydra fuel, one for commit).`,
    );
  }
  const skHex = await loadPrivateKeyHex(participant.skPath);
  try {
    await commitParticipant(participant.name, participant.api, skHex, commitUtxo);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("NoFuelUTXOFound")) {
      throw error;
    }
    // Commit may already have been submitted/consumed by a prior successful attempt.
    const statusProbe = new HydraHandler(participant.api);
    try {
      const current = await statusProbe.getHeadStatus();
      if (current === "Initial" || current === "Open") {
        console.log(`Commit input already consumed; Head C status is ${current}. Treating as idempotent success.`);
      } else {
        throw error;
      }
    } finally {
      statusProbe.stop();
    }
  }

  // If counterpart already committed, this second commit should finalize opening.
  // Wait briefly to surface that in logs/output instead of forcing callers to poll.
  const openWatcher = new HydraHandler(counterpart.api);
  try {
    const counterpartStatus = await openWatcher.getHeadStatus();
    if (counterpartStatus === "Open") {
      console.log("Head C is now open.");
      return;
    }
    if (counterpartStatus === "Initial") {
      try {
        await openWatcher.listen("HeadIsOpen", 30_000);
        console.log("Head C is now open.");
        return;
      } catch {
        // Keep partial success semantics when counterpart has not committed yet.
      }
    }
  } finally {
    openWatcher.stop();
  }

  console.log(`Head C partial init complete (${participant.name} commit submitted). Waiting for counterpart commit.`);
}

async function openHead(name: "A" | "B", participants: Participant[], commitUtxos: Array<Utxo | null>): Promise<void> {
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
  await h1.listen("HeadIsOpen", 120_000);
  console.log(`[${name}] HeadIsOpen.`);

  h1.stop();
  for (const h of handlers) h.stop();
}

async function main(): Promise<void> {
  installLifecycleRefreshHooks();
  try {
    await stat(l1ReadyFile);
  } catch {
    console.error(`Infrastructure not ready - missing sentinel ${l1ReadyFile}`);
    process.exit(1);
  }

  try {
    await refreshL1Utxos("startup");

    const operation = parseOperation(process.argv.slice(2));
    const runOnce = async () => {
      const aliceUtxos = await loadParticipantUtxos("alice");
      const bobUtxos = await loadParticipantUtxos("bob");
      const idaUtxos = await loadParticipantUtxos("ida");
      const jonUtxos = await loadParticipantUtxos("jon");
      const charlieUtxos = await loadParticipantUtxos("charlie");

      const idaEligible = idaUtxos.filter((u) => u.assets.lovelace >= MIN_COMMIT_LOVELACE);
      const idaCommitA = idaEligible.length >= 2 ? idaEligible[0] : pickCommitUtxo(idaUtxos);
      const idaCommitB = idaEligible.length >= 2 ? idaEligible[1] : null;
      const idaCommitAny = pickCommitUtxo(idaUtxos);

      const aliceCommit = pickCommitUtxo(aliceUtxos);
      const bobCommit = pickCommitUtxo(bobUtxos);
      const jonCommit = pickCommitUtxo(jonUtxos);
      const charlieCommit = pickCommitUtxo(charlieUtxos);
      const idaCommitHeadC = pickCommitUtxo(idaUtxos);

      if (operation === "open_heads_ab") {
        await openHead("A", [headA.p1, headA.p2], [aliceCommit, idaCommitA]);
        await openHead("B", [headB.p1, headB.p2, headB.p3], [bobCommit, idaCommitB, jonCommit]);
        return;
      }
      if (operation === "open_head_a") {
        await openHead("A", [headA.p1, headA.p2], [aliceCommit, idaCommitAny]);
        return;
      }
      if (operation === "open_head_b") {
        await openHead("B", [headB.p1, headB.p2, headB.p3], [bobCommit, idaCommitAny, jonCommit]);
        return;
      }
      if (operation === "commit_head_c_charlie") {
        await commitHeadCParticipant(headC.p1, headC.p2, charlieCommit);
        return;
      }
      await commitHeadCParticipant(headC.p2, headC.p1, idaCommitHeadC);
    };

    try {
      await runOnce();
    } catch (error) {
      console.warn("[retry] Opening heads failed on first attempt. Refreshing l1-utxos and retrying once...");
      console.warn(error);
      await refreshL1Utxos("retry-after-failure");
      await runOnce();
    }

    if (operation === "open_heads_ab") {
      console.log("\nBoth final-demo heads are open.");
    } else if (operation === "open_head_a") {
      console.log("\nHead A open flow completed.");
    } else if (operation === "open_head_b") {
      console.log("\nHead B open flow completed.");
    } else if (operation === "commit_head_c_admin") {
      console.log("\nHead C admin partial init completed.");
    } else {
      console.log("\nHead C Charlie partial init completed.");
    }
  } finally {
    await refreshL1UtxosSafe("main-finally");
  }
}

main().catch((error) => {
  console.error("Failed to open final-demo heads:", error);
  process.exit(1);
});

