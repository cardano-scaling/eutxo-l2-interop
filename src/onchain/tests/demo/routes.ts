/**
 * REST API route handlers for the demo backend.
 *
 * Each action is async and guarded by state.busy to prevent concurrency.
 */

import {
  Crypto,
  Data,
  Lucid,
  type Utxo,
} from "https://deno.land/x/lucid@0.20.14/mod.ts";

import { state, type DemoSnapshot } from "./state.ts";
import {
  AdhocLedgerV4WrappedDatum,
  AdhocLedgerV4WrappedSpend,
} from "../plutus.ts";
import { HydraNodeProvider } from "../hydra_node_provider.ts";
import { mergeOnL1 } from "../merge.ts";

// ============================================================
// Helpers
// ============================================================

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, (_k, v) =>
    typeof v === "bigint" ? v.toString() : v
  ), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status);
}

const BUSY_TIMEOUT_MS = 120_000; // auto-release lock after 2 min

async function withBusy(actionName: string, fn: () => Promise<Response>): Promise<Response> {
  // Auto-expire stale locks (e.g. previous action hung and never resolved)
  if (state.busy && state.busySince && Date.now() - state.busySince > BUSY_TIMEOUT_MS) {
    state.emit("warn", "Previous action timed out — releasing lock");
    state.busy = false;
  }
  if (state.busy) return err(`Another action is in progress: ${state.busyAction}`, 409);
  state.busy = true;
  state.busySince = Date.now();
  state.busyAction = actionName;
  try {
    return await fn();
  } catch (e) {
    state.emit("error", `Action failed: ${(e as Error).message}`);
    return err((e as Error).message, 500);
  } finally {
    state.busy = false;
    state.busySince = 0;
    state.busyAction = "";
  }
}

// ============================================================
// GET routes
// ============================================================

export async function getStatus(): Promise<Response> {
  try {
    const snapshot = await state.getSnapshot();
    return json(snapshot);
  } catch (e) {
    return err(`Status query failed: ${(e as Error).message}`, 500);
  }
}

export function getEvents(): Response {
  return json(state.getHistory());
}

// ============================================================
// POST actions
// ============================================================

/** Initialize: load credentials and connect to heads */
export async function actionConnect(): Promise<Response> {
  return withBusy("connect", async () => {
    if (!await state.isInfraReady()) {
      throw new Error("Infrastructure not ready — waiting for L1 UTXOs (is docker compose up?)");
    }
    await state.loadCredentials();
    await state.connectHeads();
    const snapshot = await state.getSnapshot();
    return json({ ok: true, snapshot });
  });
}

/** Init + Commit: open both Hydra heads with L1 funds */
export async function actionCommit(): Promise<Response> {
  return withBusy("commit", async () => {
    if (!state.handlerA || !state.handlerB) {
      throw new Error("Not connected to heads — click Connect first");
    }
    state.emit("action", "Starting Init + Commit flow...");
    await state.initAndCommitHeads();
    const snapshot = await state.getSnapshot();
    return json({ ok: true, snapshot });
  });
}

/** Wrap 5 ADA in both heads */
export async function actionWrap(): Promise<Response> {
  return withBusy("wrap", async () => {
    if (!state.lucidAliceA || !state.lucidIdaB) {
      throw new Error("Not connected to heads");
    }
    if (!state.wrappedValidator) {
      throw new Error("Validator not initialized");
    }

    state.emit("action", "Wrapping 5 ADA in Head A (Alice)...");

    // Wrap in Head A: Alice locks 5 ADA, Ida as intermediary
    const wrappedDatumA: AdhocLedgerV4WrappedDatum = {
      owner: Crypto.privateKeyToDetails(state.privateKeyAlice).credential.hash,
      intermediaries: new Map([
        [Crypto.privateKeyToDetails(state.privateKeyIda).credential.hash, 5_000_000n],
      ]),
      nonce: { transactionId: "", outputIndex: 0n },
      disputed: false,
      timeout: 1000000n,
    };

    const wrapTxA = await state.lucidAliceA.newTx()
      .payToContract(
        state.wrappedAddress,
        { Inline: Data.to(wrappedDatumA, AdhocLedgerV4WrappedSpend.datumOpt) },
        { lovelace: 5000000n },
      )
      .commit();
    const signedA = await wrapTxA.sign().commit();
    const hashA = await signedA.submit();
    await state.providerA!.awaitTx(hashA);
    state.wrappedDatumA = wrappedDatumA;
    state.emit("success", `Wrap TX A: ${hashA}`);

    // Wrap in Head B: Ida locks 5 ADA, Alice as intermediary
    state.emit("action", "Wrapping 5 ADA in Head B (Ida)...");

    const wrappedDatumB: AdhocLedgerV4WrappedDatum = {
      owner: Crypto.privateKeyToDetails(state.privateKeyIda).credential.hash,
      intermediaries: new Map([
        [Crypto.privateKeyToDetails(state.privateKeyAlice).credential.hash, 5_000_000n],
      ]),
      nonce: { transactionId: "", outputIndex: 0n },
      disputed: false,
      timeout: 1000000n,
    };

    const wrapTxB = await state.lucidIdaB.newTx()
      .payToContract(
        state.wrappedAddress,
        { Inline: Data.to(wrappedDatumB, AdhocLedgerV4WrappedSpend.datumOpt) },
        { lovelace: 5000000n },
      )
      .commit();
    const signedB = await wrapTxB.sign().commit();
    const hashB = await signedB.submit();
    await state.providerB!.awaitTx(hashB);
    state.wrappedDatumB = wrappedDatumB;
    state.emit("success", `Wrap TX B: ${hashB}`);

    state.phase = "wrapped";
    state.emit("success", "Both heads wrapped successfully");

    const snapshot = await state.getSnapshot();
    return json({ ok: true, txA: hashA, txB: hashB, snapshot });
  });
}

/** Unwrap (happy path): owner reclaims funds in-head */
export async function actionUnwrap(): Promise<Response> {
  return withBusy("unwrap", async () => {
    if (!state.lucidAliceA || !state.lucidIdaB) {
      throw new Error("Not connected to heads");
    }
    if (!state.wrappedValidator) {
      throw new Error("Validator not initialized");
    }

    state.emit("action", "Unwrapping in Head A (Alice)...");

    const wrappedUtxosA = await state.lucidAliceA.utxosAt(state.wrappedAddress);
    if (wrappedUtxosA.length === 0) throw new Error("No wrapped UTXOs in Head A");

    const unwrapA = await state.lucidAliceA.newTx()
      .addSigner(Crypto.privateKeyToDetails(state.privateKeyAlice).credential.hash)
      .collectFrom(wrappedUtxosA, Data.to("Unwrap", AdhocLedgerV4WrappedSpend.redeemer))
      .attachScript(state.wrappedValidator)
      .commit();
    const signedA = await unwrapA.sign().commit();
    const hashA = await signedA.submit();
    await state.providerA!.awaitTx(hashA);
    state.emit("success", `Unwrap TX A: ${hashA}`);

    state.emit("action", "Unwrapping in Head B (Ida)...");

    const wrappedUtxosB = await state.lucidIdaB.utxosAt(state.wrappedAddress);
    if (wrappedUtxosB.length === 0) throw new Error("No wrapped UTXOs in Head B");

    const unwrapB = await state.lucidIdaB.newTx()
      .addSigner(Crypto.privateKeyToDetails(state.privateKeyIda).credential.hash)
      .collectFrom(wrappedUtxosB, Data.to("Unwrap", AdhocLedgerV4WrappedSpend.redeemer))
      .attachScript(state.wrappedValidator)
      .commit();
    const signedB = await unwrapB.sign().commit();
    const hashB = await signedB.submit();
    await state.providerB!.awaitTx(hashB);
    state.emit("success", `Unwrap TX B: ${hashB}`);

    state.phase = "heads_open";
    state.wrappedDatumA = null;
    state.wrappedDatumB = null;
    state.emit("success", "Both heads unwrapped — can wrap again!");

    const snapshot = await state.getSnapshot();
    return json({ ok: true, txA: hashA, txB: hashB, snapshot });
  });
}

/** Dispute wrapped UTXOs in both heads */
export async function actionDispute(): Promise<Response> {
  return withBusy("dispute", async () => {
    if (!state.lucidAliceA || !state.lucidIdaB) {
      throw new Error("Not connected to heads");
    }
    if (!state.wrappedValidator || !state.wrappedDatumA || !state.wrappedDatumB) {
      throw new Error("Must wrap before disputing");
    }

    state.emit("action", "Disputing in Head A (Alice)...");

    const wrappedUtxosA = await state.lucidAliceA.utxosAt(state.wrappedAddress);
    if (wrappedUtxosA.length === 0) throw new Error("No wrapped UTXOs in Head A");

    const disputedDatumA: AdhocLedgerV4WrappedDatum = {
      ...state.wrappedDatumA,
      disputed: true,
      timeout: 1000000n,
    };

    const disputeA = await state.lucidAliceA.newTx()
      .addSigner(Crypto.privateKeyToDetails(state.privateKeyAlice).credential.hash)
      .collectFrom(wrappedUtxosA, Data.to("Dispute", AdhocLedgerV4WrappedSpend.redeemer))
      .payToContract(
        state.wrappedAddress,
        { Inline: Data.to(disputedDatumA, AdhocLedgerV4WrappedSpend.datumOpt) },
        { lovelace: 5000000n },
      )
      .attachScript(state.wrappedValidator)
      .commit();
    const signedA = await disputeA.sign().commit();
    const hashA = await signedA.submit();
    await state.providerA!.awaitTx(hashA);
    state.emit("success", `Dispute TX A: ${hashA}`);

    state.emit("action", "Disputing in Head B (Ida)...");

    const wrappedUtxosB = await state.lucidIdaB.utxosAt(state.wrappedAddress);
    if (wrappedUtxosB.length === 0) throw new Error("No wrapped UTXOs in Head B");

    const disputedDatumB: AdhocLedgerV4WrappedDatum = {
      ...state.wrappedDatumB,
      disputed: true,
      timeout: 1000000n,
    };

    const disputeB = await state.lucidIdaB.newTx()
      .addSigner(Crypto.privateKeyToDetails(state.privateKeyIda).credential.hash)
      .collectFrom(wrappedUtxosB, Data.to("Dispute", AdhocLedgerV4WrappedSpend.redeemer))
      .payToContract(
        state.wrappedAddress,
        { Inline: Data.to(disputedDatumB, AdhocLedgerV4WrappedSpend.datumOpt) },
        { lovelace: 5000000n },
      )
      .attachScript(state.wrappedValidator)
      .commit();
    const signedB = await disputeB.sign().commit();
    const hashB = await signedB.submit();
    await state.providerB!.awaitTx(hashB);
    state.emit("success", `Dispute TX B: ${hashB}`);

    state.phase = "disputed";
    state.emit("success", "Both heads disputed");

    const snapshot = await state.getSnapshot();
    return json({ ok: true, txA: hashA, txB: hashB, snapshot });
  });
}

/** Close & fanout both heads */
export async function actionClose(): Promise<Response> {
  return withBusy("close", async () => {
    if (!state.handlerA || !state.handlerB) {
      throw new Error("Not connected to heads");
    }

    state.phase = "closing";
    state.emit("action", "Closing Head A...");
    await state.handlerA.closeAndFanout();
    state.emit("success", "Head A closed & fanned out");

    state.emit("action", "Closing Head B...");
    await state.handlerB.closeAndFanout();
    state.emit("success", "Head B closed & fanned out");

    // Wait for L1 settlement
    state.emit("action", "Waiting for L1 settlement...");
    const alicePkh = Crypto.privateKeyToDetails(state.privateKeyAlice).credential.hash;
    const idaPkh = Crypto.privateKeyToDetails(state.privateKeyIda).credential.hash;

    let settled = false;
    for (let i = 0; i < 30; i++) {
      try {
        const utxos = await state.l1Provider.getUtxos(state.wrappedAddress);
        const disputed = utxos.filter((u) => {
          if (!u.datum) return false;
          try {
            const d = Data.from(u.datum, AdhocLedgerV4WrappedSpend.datumOpt);
            return d.disputed === true;
          } catch { return false; }
        });
        const foundAlice = disputed.some((u) => {
          const d = Data.from(u.datum!, AdhocLedgerV4WrappedSpend.datumOpt);
          return d.owner === alicePkh;
        });
        const foundIda = disputed.some((u) => {
          const d = Data.from(u.datum!, AdhocLedgerV4WrappedSpend.datumOpt);
          return d.owner === idaPkh;
        });
        if (foundAlice && foundIda) {
          settled = true;
          state.emit("success", `Both disputed UTXOs settled on L1 (poll ${i + 1})`);
          break;
        }
        state.emit("info", `L1 poll ${i + 1}: disputed=${disputed.length}, Alice=${foundAlice}, Ida=${foundIda}`);
      } catch (e) {
        state.emit("warn", `L1 poll ${i + 1}: ${e}`);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }

    if (!settled) {
      throw new Error("Timed out waiting for L1 settlement");
    }

    state.phase = "closed";
    state.disconnectHeads();

    const snapshot = await state.getSnapshot();
    return json({ ok: true, snapshot });
  });
}

/** Merge disputed UTXOs on L1 */
export async function actionMerge(): Promise<Response> {
  return withBusy("merge", async () => {
    if (!state.wrappedValidator) {
      throw new Error("Validator not initialized");
    }

    state.emit("action", "Merging disputed UTXOs on L1...");

    const txHash = await mergeOnL1(
      state.l1Provider,
      state.wrappedValidator,
      state.wrappedAddress,
      state.privateKeyAlice,
      state.addressAlice,
      state.addressIda,
    );

    state.emit("success", `Merge TX: ${txHash}`);

    // Merge consumed script UTXOs — refresh the file for future runs
    await state.refreshL1UtxoFile();

    state.wrappedDatumA = null;
    state.wrappedDatumB = null;

    // Reconnect to heads so the next Commit works without a manual Connect
    state.emit("info", "Reconnecting to heads for next run...");
    await state.connectHeads();
    state.emit("success", "Merge complete — click Commit to re-open heads");

    const snapshot = await state.getSnapshot();
    return json({ ok: true, txHash, snapshot });
  });
}
