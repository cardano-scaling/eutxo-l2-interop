/**
 * Shared demo state — holds Hydra connections, L1 provider, and event bus.
 *
 * Designed as a singleton so the HTTP server, routes, and WebSocket
 * handlers all share the same connections and cached state.
 */

import {
  Addresses,
  type Assets,
  Crypto,
  Data,
  Lucid,
  type Provider,
  type Script,
  type Utxo,
} from "https://deno.land/x/lucid@0.20.14/mod.ts";

import { HydraHandler, type HeadStatus } from "../hydra_handler.ts";
import { HydraNodeProvider } from "../hydra_node_provider.ts";
import { CardanoCliProvider } from "../cardano_provider.ts";
import {
  AdhocLedgerV4WrappedDatum,
  AdhocLedgerV4WrappedSpend,
} from "../plutus.ts";

// ============================================================
// Configuration
// ============================================================

const CREDENTIALS_PATH = "../infra/credentials";
const UTXO_FILE = "../infra/l1-utxos.json";
const INFRA_READY_SENTINEL = "../infra/l1-utxos.ready";

// Hydra node API endpoints (must match docker-compose)
const HEAD_A_ALICE_API = "http://127.0.0.1:4011";
const HEAD_A_IDA_API = "http://127.0.0.1:4019";
const HEAD_B_BOB_API = "http://127.0.0.1:4022";
const HEAD_B_IDA_API = "http://127.0.0.1:4029";

// ============================================================
// Types
// ============================================================

export interface DemoEvent {
  type: "info" | "success" | "error" | "warn" | "action";
  message: string;
  timestamp: number;
  data?: unknown;
}

export interface ParticipantInfo {
  name: string;
  address: string;
  pkh: string; // payment key hash
}

export interface HeadState {
  status: HeadStatus | "Unknown" | "Connecting";
  utxos: Utxo[];
}

export interface DemoSnapshot {
  headA: HeadState;
  headB: HeadState;
  l1: {
    alice: Utxo[];
    ida: Utxo[];
    bob: Utxo[];
    script: Utxo[];
  };
  participants: {
    alice: ParticipantInfo;
    ida: ParticipantInfo;
    bob: ParticipantInfo;
  };
  wrappedAddress: string;
  phase: DemoPhase;
  busy: boolean;
  busyAction: string;
  infraReady: boolean;
}

export type DemoPhase =
  | "idle"           // infrastructure running, not connected
  | "initializing"   // connected, heads need init + commit
  | "heads_open"     // both heads open (after commit)
  | "wrapped"        // funds locked in validator in both heads
  | "disputed"       // UTXOs marked disputed in both heads
  | "closing"        // close & fanout in progress
  | "closed"         // heads closed, UTXOs on L1
  | "merged"         // disputed UTXOs merged on L1
  | "unwrapped";     // funds unwrapped (happy path)

// ============================================================
// DemoState singleton
// ============================================================

export class DemoState {
  // Hydra handlers
  handlerA: HydraHandler | null = null;
  handlerB: HydraHandler | null = null;

  // Providers
  providerA: HydraNodeProvider | null = null;
  providerB: HydraNodeProvider | null = null;
  l1Provider: CardanoCliProvider;

  // Lucid instances
  lucidAliceA: Lucid | null = null;
  lucidIdaB: Lucid | null = null;

  // Credentials
  privateKeyAlice = "";
  privateKeyIda = "";
  privateKeyBob = "";
  addressAlice = "";
  addressIda = "";
  addressBob = "";

  // Validator
  wrappedValidator: Script | null = null;
  wrappedAddress = "";
  wrappedDatumA: AdhocLedgerV4WrappedDatum | null = null;
  wrappedDatumB: AdhocLedgerV4WrappedDatum | null = null;

  // State
  phase: DemoPhase = "idle";
  busy = false; // prevents concurrent actions
  busySince = 0; // timestamp when busy was set (for stale-lock expiry)
  busyAction = ""; // which action is currently running (for UI display)

  // Event bus
  private listeners: Set<(event: DemoEvent) => void> = new Set();
  private eventHistory: DemoEvent[] = [];

  constructor() {
    this.l1Provider = new CardanoCliProvider();
  }

  // ── Infra readiness ───────────────────────────────────────

  /** Check if the sentinel file exists (written by cardano-node entrypoint after L1 UTXOs are ready) */
  async isInfraReady(): Promise<boolean> {
    try {
      await Deno.stat(INFRA_READY_SENTINEL);
      return true;
    } catch {
      return false;
    }
  }

  // ── Credentials ────────────────────────────────────────────

  async loadCredentials(): Promise<void> {
    const loadSk = async (path: string) => {
      const json = JSON.parse(await Deno.readTextFile(path));
      return json.cborHex.slice(4); // skip CBOR prefix 5820
    };

    this.privateKeyAlice = await loadSk(`${CREDENTIALS_PATH}/alice/alice-funds.sk`);
    this.privateKeyIda = await loadSk(`${CREDENTIALS_PATH}/ida/ida-funds.sk`);
    this.privateKeyBob = await loadSk(`${CREDENTIALS_PATH}/bob/bob-funds.sk`);

    this.addressAlice = (await Deno.readTextFile(`${CREDENTIALS_PATH}/alice/alice-funds.addr`)).trim();
    this.addressIda = (await Deno.readTextFile(`${CREDENTIALS_PATH}/ida/ida-funds.addr`)).trim();
    this.addressBob = (await Deno.readTextFile(`${CREDENTIALS_PATH}/bob/bob-funds.addr`)).trim();

    this.emit("info", "Credentials loaded");
  }

  // ── Hydra connections ──────────────────────────────────────

  async connectHeads(): Promise<void> {
    // Close old connections if reconnecting
    if (this.handlerA || this.handlerB) {
      this.handlerA?.stop();
      this.handlerB?.stop();
      this.handlerA = null;
      this.handlerB = null;
    }

    this.emit("info", "Connecting to Hydra heads...");

    this.handlerA = new HydraHandler(HEAD_A_ALICE_API, "HeadA");
    this.handlerB = new HydraHandler(HEAD_B_BOB_API, "HeadB");

    // Wait for WebSocket handshake (with timeout)
    const WS_CONNECT_TIMEOUT = 10_000;
    const deadline = Date.now() + WS_CONNECT_TIMEOUT;
    while (Date.now() < deadline) {
      try {
        // getHeadStatus will throw if WS isn't ready yet
        await this.handlerA.getHeadStatus();
        await this.handlerB.getHeadStatus();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (Date.now() >= deadline) {
      this.handlerA.stop();
      this.handlerB.stop();
      this.handlerA = null;
      this.handlerB = null;
      throw new Error("Timed out connecting to Hydra nodes — is the infrastructure running?");
    }

    this.providerA = new HydraNodeProvider(this.handlerA);
    this.providerB = new HydraNodeProvider(this.handlerB);

    const statusA = await this.handlerA.getHeadStatus();
    const statusB = await this.handlerB.getHeadStatus();

    this.emit("info", `Head A: ${statusA}, Head B: ${statusB}`);

    // Create Lucid instances
    this.lucidAliceA = new Lucid({
      provider: this.providerA,
      wallet: { PrivateKey: this.privateKeyAlice },
    });
    this.lucidIdaB = new Lucid({
      provider: this.providerB,
      wallet: { PrivateKey: this.privateKeyIda },
    });

    // Compute validator address
    const validator = new AdhocLedgerV4WrappedSpend();
    this.wrappedValidator = validator;
    this.wrappedAddress = this.lucidAliceA.newScript(validator).toAddress();

    // ── Detect phase from head state ──────────────────────────
    if (statusA === "Open" && statusB === "Open") {
      // Both open — figure out how far we are by inspecting UTXOs
      this.phase = await this.detectPhaseFromHeads();
    } else if (statusA === "Final" && statusB === "Final") {
      // Both finalized — check L1 for disputed UTXOs
      this.phase = await this.detectPhaseFromL1();
    } else {
      this.phase = "initializing";
    }

    this.emit("success", `Connected — phase: ${this.phase}`);
  }

  /**
   * Detect phase by inspecting UTXOs inside the open heads.
   * Reconstructs wrappedDatumA/B from on-chain data if found.
   */
  private async detectPhaseFromHeads(): Promise<DemoPhase> {
    try {
      const utxosA = await this.handlerA!.getSnapshot();
      const utxosB = await this.handlerB!.getSnapshot();
      const wrappedA = utxosA.filter((u) => u.address === this.wrappedAddress);
      const wrappedB = utxosB.filter((u) => u.address === this.wrappedAddress);

      if (wrappedA.length === 0 && wrappedB.length === 0) {
        this.emit("info", "Heads open, no wrapped UTXOs — ready for wrap");
        return "heads_open";
      }

      // Reconstruct datums from on-chain data
      let hasDisputed = false;
      for (const u of wrappedA) {
        if (u.datum) {
          try {
            const d = Data.from(u.datum, AdhocLedgerV4WrappedSpend.datumOpt);
            this.wrappedDatumA = d;
            if (d.disputed) hasDisputed = true;
          } catch { /* skip unparseable */ }
        }
      }
      for (const u of wrappedB) {
        if (u.datum) {
          try {
            const d = Data.from(u.datum, AdhocLedgerV4WrappedSpend.datumOpt);
            this.wrappedDatumB = d;
            if (d.disputed) hasDisputed = true;
          } catch { /* skip unparseable */ }
        }
      }

      if (hasDisputed) {
        this.emit("info", `Recovered state: disputed UTXOs in heads (A=${wrappedA.length}, B=${wrappedB.length})`);
        return "disputed";
      }
      this.emit("info", `Recovered state: wrapped UTXOs in heads (A=${wrappedA.length}, B=${wrappedB.length})`);
      return "wrapped";
    } catch (e) {
      this.emit("warn", `Phase detection failed: ${e}`);
      return "heads_open";
    }
  }

  /**
   * Detect phase from L1 state (after heads are finalized).
   */
  private async detectPhaseFromL1(): Promise<DemoPhase> {
    try {
      const scriptUtxos = await this.l1Provider.getUtxos(this.wrappedAddress);
      if (scriptUtxos.length > 0) {
        // Disputed UTXOs on L1 — needs merge
        this.emit("info", `Found ${scriptUtxos.length} script UTXOs on L1 — ready for merge`);
        return "closed";
      }
      this.emit("info", "Heads finalized, no script UTXOs on L1 — already merged");
      return "merged";
    } catch (e) {
      this.emit("warn", `L1 phase detection failed: ${e}`);
      return "closed";
    }
  }

  /**
   * Init + Commit: bring both heads from Idle/Initial → Open.
   * Uses the same commit flow as commit.ts (raw CBOR signing + L1 submit).
   */
  async initAndCommitHeads(): Promise<void> {
    if (!this.handlerA || !this.handlerB) {
      throw new Error("Not connected to heads — call connectHeads() first");
    }

    // Lazy-import commit functions (Deno resolves relative to this file)
    const {
      loadL1Utxos,
      pickCommitUtxo,
      commitParticipant,
      MIN_COMMIT_LOVELACE,
    } = await import("../commit.ts");

    // 1. Load L1 UTXOs
    this.emit("info", "Loading L1 UTXOs...");
    const aliceUtxos = await loadL1Utxos("alice", UTXO_FILE);
    const bobUtxos = await loadL1Utxos("bob", UTXO_FILE);
    const idaUtxos = await loadL1Utxos("ida", UTXO_FILE);
    this.emit("info", `L1 UTXOs — Alice: ${aliceUtxos.length}, Bob: ${bobUtxos.length}, Ida: ${idaUtxos.length}`);

    // 2. Pick commit UTXOs (Ida needs one per head)
    const idaEligible = idaUtxos.filter((u) => u.assets.lovelace >= MIN_COMMIT_LOVELACE);
    const idaCommitA = idaEligible.length >= 2 ? idaEligible[0] : pickCommitUtxo(idaUtxos);
    const idaCommitB = idaEligible.length >= 2 ? idaEligible[1] : null;
    const aliceCommit = pickCommitUtxo(aliceUtxos);
    const bobCommit = pickCommitUtxo(bobUtxos);

    // Reject if any participant would do an empty commit
    const missing: string[] = [];
    if (!aliceCommit) missing.push("Alice (Head A)");
    if (!bobCommit) missing.push("Bob (Head B)");
    if (!idaCommitA) missing.push("Ida (Head A)");
    if (!idaCommitB) missing.push("Ida (Head B)");
    if (missing.length > 0) {
      throw new Error(
        `No eligible commit UTXO for: ${missing.join(", ")}. ` +
        `Each participant needs at least 2 UTXOs on L1 (one for Hydra fuel, one to commit). ` +
        `Try restarting the devnet: docker compose down -v && docker compose up -d`
      );
    }

    this.emit("info",
      `Commit plan — Alice: ${Number(aliceCommit!.assets.lovelace) / 1e6} ADA, ` +
      `Bob: ${Number(bobCommit!.assets.lovelace) / 1e6} ADA, ` +
      `Ida(A): ${Number(idaCommitA!.assets.lovelace) / 1e6} ADA, ` +
      `Ida(B): ${Number(idaCommitB!.assets.lovelace) / 1e6} ADA`
    );

    // 3. Head A: Init → Commit → HeadIsOpen
    this.emit("action", "Initializing Head A...");
    console.log("[COMMIT] Head A: calling initIfNeeded...");
    const statusA = await this.handlerA.initIfNeeded();
    console.log(`[COMMIT] Head A: initIfNeeded returned "${statusA}"`);
    if (statusA !== "Open") {
      this.emit("action", "Committing Alice to Head A...");
      console.log("[COMMIT] Head A: committing alice...");
      await commitParticipant("alice", HEAD_A_ALICE_API, this.privateKeyAlice, aliceCommit);
      console.log("[COMMIT] Head A: committing ida...");
      this.emit("action", "Committing Ida to Head A...");
      await commitParticipant("ida", HEAD_A_IDA_API, this.privateKeyIda, idaCommitA);
      this.emit("info", "Waiting for Head A to open...");
      console.log("[COMMIT] Head A: waiting for HeadIsOpen...");
      await this.handlerA.listen("HeadIsOpen", 120000);
      console.log("[COMMIT] Head A: OPEN!");
      this.emit("success", "Head A is open!");
    } else {
      this.emit("info", "Head A already open — skipping commit");
    }

    // 4. Head B: Init → Commit → HeadIsOpen
    this.emit("action", "Initializing Head B...");
    console.log("[COMMIT] Head B: calling initIfNeeded...");
    const statusB = await this.handlerB.initIfNeeded();
    console.log(`[COMMIT] Head B: initIfNeeded returned "${statusB}"`);
    if (statusB !== "Open") {
      this.emit("action", "Committing Bob to Head B...");
      console.log("[COMMIT] Head B: committing bob...");
      await commitParticipant("bob", HEAD_B_BOB_API, this.privateKeyBob, bobCommit);
      console.log("[COMMIT] Head B: committing ida...");
      this.emit("action", "Committing Ida to Head B...");
      await commitParticipant("ida", HEAD_B_IDA_API, this.privateKeyIda, idaCommitB);
      this.emit("info", "Waiting for Head B to open...");
      console.log("[COMMIT] Head B: waiting for HeadIsOpen...");
      await this.handlerB.listen("HeadIsOpen", 120000);
      console.log("[COMMIT] Head B: OPEN!");
      this.emit("success", "Head B is open!");
    } else {
      this.emit("info", "Head B already open — skipping commit");
    }

    this.phase = "heads_open";
    this.emit("success", "Both heads are open and ready!");

    // Commit consumed L1 UTXOs — refresh the file for future runs
    await this.refreshL1UtxoFile();
  }

  /**
   * Refresh the l1-utxos.json file with current L1 state.
   * Must be called after any L1-mutating operation (commit, merge).
   */
  async refreshL1UtxoFile(): Promise<void> {
    if (!this.addressAlice || !this.addressIda || !this.addressBob) return;
    try {
      const [alice, ida, bob] = await Promise.all([
        this.l1Provider.getUtxos(this.addressAlice),
        this.l1Provider.getUtxos(this.addressIda),
        this.l1Provider.getUtxos(this.addressBob),
      ]);
      // Convert Lucid Utxo[] to the JSON format expected by commit.ts
      const toJson = (utxos: Utxo[]) => {
        const obj: Record<string, { address: string; value: { lovelace: number } }> = {};
        for (const u of utxos) {
          obj[`${u.txHash}#${u.outputIndex}`] = {
            address: u.address,
            value: { lovelace: Number(u.assets.lovelace) },
          };
        }
        return obj;
      };
      const data = { alice: toJson(alice), bob: toJson(bob), ida: toJson(ida) };
      const utxoFilePath = new URL(UTXO_FILE, import.meta.url).pathname;
      await Deno.writeTextFile(utxoFilePath, JSON.stringify(data, null, 2));
      this.emit("info", `Refreshed l1-utxos.json (Alice: ${alice.length}, Bob: ${bob.length}, Ida: ${ida.length})`);
    } catch (e) {
      this.emit("warn", `Failed to refresh l1-utxos.json: ${e}`);
    }
  }

  disconnectHeads(): void {
    this.handlerA?.stop();
    this.handlerB?.stop();
    this.handlerA = null;
    this.handlerB = null;
    this.providerA = null;
    this.providerB = null;
    this.lucidAliceA = null;
    this.lucidIdaB = null;
    this.emit("info", "Disconnected from Hydra heads");
  }

  // ── Snapshot ───────────────────────────────────────────────

  async getSnapshot(): Promise<DemoSnapshot> {
    let headA: HeadState = { status: "Unknown", utxos: [] };
    let headB: HeadState = { status: "Unknown", utxos: [] };

    if (this.handlerA) {
      try {
        const status = await this.handlerA.getHeadStatus();
        const utxos = status === "Open" ? await this.handlerA.getSnapshot() : [];
        headA = { status, utxos };
      } catch {
        headA = { status: "Unknown", utxos: [] };
      }
    }

    if (this.handlerB) {
      try {
        const status = await this.handlerB.getHeadStatus();
        const utxos = status === "Open" ? await this.handlerB.getSnapshot() : [];
        headB = { status, utxos };
      } catch {
        headB = { status: "Unknown", utxos: [] };
      }
    }

    // L1 UTXOs
    const l1 = { alice: [] as Utxo[], ida: [] as Utxo[], bob: [] as Utxo[], script: [] as Utxo[] };
    try {
      if (this.addressAlice) l1.alice = await this.l1Provider.getUtxos(this.addressAlice);
      if (this.addressIda) l1.ida = await this.l1Provider.getUtxos(this.addressIda);
      if (this.addressBob) l1.bob = await this.l1Provider.getUtxos(this.addressBob);
      if (this.wrappedAddress) l1.script = await this.l1Provider.getUtxos(this.wrappedAddress);
    } catch (e) {
      this.emit("warn", `L1 query failed: ${e}`);
    }

    return {
      headA,
      headB,
      l1,
      participants: {
        alice: {
          name: "Alice",
          address: this.addressAlice,
          pkh: this.privateKeyAlice ? Crypto.privateKeyToDetails(this.privateKeyAlice).credential.hash : "",
        },
        ida: {
          name: "Ida",
          address: this.addressIda,
          pkh: this.privateKeyIda ? Crypto.privateKeyToDetails(this.privateKeyIda).credential.hash : "",
        },
        bob: {
          name: "Bob",
          address: this.addressBob,
          pkh: this.privateKeyBob ? Crypto.privateKeyToDetails(this.privateKeyBob).credential.hash : "",
        },
      },
      wrappedAddress: this.wrappedAddress,
      phase: this.phase,
      busy: this.busy,
      busyAction: this.busyAction,
      infraReady: await this.isInfraReady(),
    };
  }

  // ── Event bus ──────────────────────────────────────────────

  emit(type: DemoEvent["type"], message: string, data?: unknown): void {
    const event: DemoEvent = { type, message, timestamp: Date.now(), data };
    this.eventHistory.push(event);
    if (this.eventHistory.length > 200) this.eventHistory.shift();
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* ignore */ }
    }
  }

  subscribe(listener: (event: DemoEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getHistory(): DemoEvent[] {
    return [...this.eventHistory];
  }
}

// Singleton
export const state = new DemoState();
