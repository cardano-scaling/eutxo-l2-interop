import { HydraHandler, type Utxo } from "../node-hydra-handler";
import {
  COMMIT_BACKOFFS,
  COMMIT_RETRIES,
  commitParticipant,
  loadPrivateKeyHex,
} from "../node-commit-utils";
import { OPEN_HEAD_INVARIANT } from "./constants";
import { assertAllHydraPeersReachable, assertCommitSnapshotReadyForInit } from "./guards";
import { headOpenWaitMs } from "./config";
import { loadHydraVkeyHex } from "./loadHydraKeys";
import type { Participant } from "./types";

export async function openHead(name: "A" | "B", participants: Participant[], commitUtxos: Array<Utxo | null>): Promise<void> {
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
  const hydraVkByName = new Map<string, string>();
  for (const p of participants) {
    hydraVkByName.set(p.name, await loadHydraVkeyHex(p.name));
  }

  const h1 = new HydraHandler(participants[0].api);
  const handlers = participants.slice(1).map((p) => new HydraHandler(p.api));
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    await assertAllHydraPeersReachable(name, participants, h1, handlers);
  } catch (e) {
    h1.stop();
    for (const h of handlers) h.stop();
    throw e;
  }

  const committedVkeys = new Set<string>();
  const unsub = h1.subscribe((data: any) => {
    const tag = typeof data?.tag === "string" ? data.tag : "";
    if (tag !== "Committed" && tag !== "CommittedUTxO") return;
    const vkey = typeof data?.party?.vkey === "string" ? data.party.vkey.trim().toLowerCase() : null;
    if (!vkey) return;
    committedVkeys.add(vkey);
  });

  const coordinatorPre = await h1.getHeadStatus();
  if (coordinatorPre === "Open") {
    console.log(`Head ${name} already open.`);
    unsub();
    h1.stop();
    for (const h of handlers) h.stop();
    return;
  }
  if (coordinatorPre === "Idle") {
    assertCommitSnapshotReadyForInit(name, participants, commitUtxos);
  }

  const status = await h1.initIfNeeded();
  if (status === "Open") {
    console.log(`Head ${name} already open.`);
    unsub();
    h1.stop();
    for (const h of handlers) h.stop();
    return;
  }

  const handlerByName = new Map<string, HydraHandler>();
  handlerByName.set(participants[0].name, h1);
  for (let i = 0; i < handlers.length; i++) {
    handlerByName.set(participants[i + 1]!.name, handlers[i]!);
  }

  const logStatuses = async (label: string) => {
    const statuses: Record<string, string> = {};
    for (const p of participants) {
      const ph = handlerByName.get(p.name);
      if (!ph) continue;
      try {
        statuses[p.name] = await ph.getHeadStatus();
      } catch (e) {
        statuses[p.name] = `unknown(${e instanceof Error ? e.message : String(e)})`;
      }
    }
    console.log(`[${name}] Head status ${label}:`, statuses);
  };

  const safeCommitParticipant = async (p: Participant, commitUtxo: Utxo | null) => {
    const skHex = skByName.get(p.name);
    if (!skHex) throw new Error(`Missing signing key for participant ${p.name}`);
    const hydraVk = hydraVkByName.get(p.name);
    if (!hydraVk) throw new Error(`Missing hydra vkey for participant ${p.name}`);

    if (committedVkeys.has(hydraVk.toLowerCase())) {
      console.log(`  ${p.name}: commit already observed; skipping commit.`);
      return;
    }

    const ph = handlerByName.get(p.name);
    if (ph) {
      try {
        const st = await ph.getHeadStatus();
        const h1St = await h1.getHeadStatus().catch(() => "unknown");
        if (h1St === "Initial" && st === "Idle") {
          throw new Error(
            `${OPEN_HEAD_INVARIANT}[${name}] ${p.name}: coordinator Initial but this node still Idle — refusing /commit. `
              + "Peers must observe the same InitTx before commits; check this node's L1 sync, persistence, and logs.",
          );
        }
        if (st === "Open") {
          console.log(`  ${p.name}: head already open; skipping commit.`);
          return;
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith(OPEN_HEAD_INVARIANT)) throw e;
      }
    }

    try {
      await commitParticipant(p.name, p.api, skHex, commitUtxo);
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (committedVkeys.has(hydraVk.toLowerCase())) return;
        const st = await h1.getHeadStatus().catch(() => "unknown");
        if (st === "Open") return;
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (error) {
      const st = ph ? await ph.getHeadStatus().catch(() => "unknown") : "unknown";
      if (st === "Initial" || st === "Open") {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`  ${p.name}: commit error while head is ${st}; skipping re-commit. Error: ${message.slice(0, 200)}`);
        return;
      }
      const h1Status = await h1.getHeadStatus().catch(() => "unknown");
      if (h1Status === "Initial" || h1Status === "Open") {
        const message = error instanceof Error ? error.message : String(error);
        console.log(
          `  ${p.name}: commit error and participant status unknown, but head is ${h1Status}; continuing without re-commit. `
            + `Error: ${message.slice(0, 200)}`,
        );
        return;
      }
      throw error;
    }
  };

  await logStatuses("before commits");
  console.log(`[${name}] Committing participants (retries=${COMMIT_RETRIES + 1}, backoffs=${COMMIT_BACKOFFS.join(",")}ms)...`);
  for (let i = 0; i < participants.length; i++) {
    const p = participants[i];
    await safeCommitParticipant(p, commitUtxos[i]);
  }
  await logStatuses("after commits (before open)");

  const coordAfter = await h1.getHeadStatus().catch(() => "unknown" as const);
  if (coordAfter === "Initial") {
    for (let i = 1; i < participants.length; i++) {
      const peer = participants[i]!;
      const ph = handlerByName.get(peer.name);
      if (!ph) continue;
      const peerSt = await ph.getHeadStatus().catch(() => "unknown");
      if (peerSt === "Idle") {
        throw new Error(
          `${OPEN_HEAD_INVARIANT}[${name}] ${peer.name} still Idle while coordinator is Initial after commit attempts. `
            + "The head cannot open; fix chain sync or persistence on that node and re-run (do not wait for HeadIsOpen).",
        );
      }
    }
  }

  const openMs = headOpenWaitMs();
  const coordinatorOpen = await h1.getHeadStatus().catch(() => "unknown" as const);
  if (coordinatorOpen === "Open") {
    console.log(`[${name}] Head already open (coordinator); skipping wait.`);
    unsub();
  } else {
    console.log(`[${name}] Waiting for HeadIsOpen (timeout ${openMs}ms)...`);
    try {
      await h1.listen("HeadIsOpen", openMs);
      console.log(`[${name}] HeadIsOpen.`);
    } finally {
      unsub();
    }
  }
  h1.stop();
  for (const h of handlers) h.stop();
}
