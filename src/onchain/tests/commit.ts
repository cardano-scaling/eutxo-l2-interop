/**
 * Commit transaction flow for BOTH Hydra heads using real nodes and Cardano L1.
 *
 * Head A: Alice + Ida
 * Head B: Bob + Ida
 *
 * Flow per head:
 *   1. Connect to both participants' Hydra nodes via WebSocket
 *   2. Init the head (or skip if already initialized)
 *   3. Each participant commits (real UTXO or empty)
 *   4. Sign with Lucid, submit to L1 via cardano-submit-api
 *   5. Wait for HeadIsOpen
 *
 * Run: deno run --allow-net --allow-read commit.ts
 */

import {
  type Assets,
  type Utxo,
  fromHex,
  toHex,
} from "https://deno.land/x/lucid@0.20.14/mod.ts";
import { blake2b } from "https://esm.sh/@noble/hashes@1.3.3/blake2b";
import { ed25519 } from "https://esm.sh/@noble/curves@1.3.0/ed25519";

// ============================================================
// Configuration
// ============================================================

const CARDANO_SUBMIT_API = "http://127.0.0.1:8090/api/submit/tx";
const CREDENTIALS_PATH = "./infra/credentials";

interface ParticipantConfig {
  name: string;
  api: string;
  skPath: string;
  addrPath: string;
}

const HEAD_A: { p1: ParticipantConfig; p2: ParticipantConfig } = {
  p1: { name: "alice", api: "http://127.0.0.1:4011", skPath: `${CREDENTIALS_PATH}/alice/alice-funds.sk`, addrPath: `${CREDENTIALS_PATH}/alice/alice-funds.addr` },
  p2: { name: "ida",   api: "http://127.0.0.1:4019", skPath: `${CREDENTIALS_PATH}/ida/ida-funds.sk`,     addrPath: `${CREDENTIALS_PATH}/ida/ida-funds.addr` },
};

const HEAD_B: { p1: ParticipantConfig; p2: ParticipantConfig } = {
  p1: { name: "bob", api: "http://127.0.0.1:4022", skPath: `${CREDENTIALS_PATH}/bob/bob-funds.sk`, addrPath: `${CREDENTIALS_PATH}/bob/bob-funds.addr` },
  p2: { name: "ida", api: "http://127.0.0.1:4029", skPath: `${CREDENTIALS_PATH}/ida/ida-funds.sk`, addrPath: `${CREDENTIALS_PATH}/ida/ida-funds.addr` },
};

// ============================================================
// L1 UTxOs — loaded from file written by cardano-node entrypoint
// File: src/onchain/tests/infra/initial-l1-utxos.json (mounted as /devnet/initial-l1-utxos.json)
// Format per participant: { "txHash#idx": { "address": "...", "value": { "lovelace": N } } }
// ============================================================

const UTXO_FILE = "./infra/initial-l1-utxos.json";

interface CardanoCliUtxo {
  address: string;
  value: { lovelace: number };
}

/**
 * Load initial L1 UTXOs from the JSON file written by the cardano-node entrypoint.
 * Returns sorted by lovelace ascending so the smallest UTXO is first (used for commit,
 * while the larger UTXO stays as Hydra fuel).
 */
async function loadL1Utxos(name: "alice" | "bob" | "ida"): Promise<Utxo[]> {
  const raw = JSON.parse(await Deno.readTextFile(UTXO_FILE));
  const entries: Record<string, CardanoCliUtxo> = raw[name];
  const utxos: Utxo[] = Object.entries(entries).map(([outRef, out]) => {
    const [txHash, idx] = outRef.split("#");
    return {
      txHash,
      outputIndex: Number(idx),
      address: out.address,
      assets: { lovelace: BigInt(out.value.lovelace) },
    };
  });
  // Sort ascending by lovelace so utxos[0] is the smallest (commit candidate)
  utxos.sort((a, b) => Number(a.assets.lovelace - b.assets.lovelace));
  return utxos;
}

/**
 * Pick the commit UTXO for a participant.
 * If they have 2+ UTXOs, commit the SMALLEST — the larger UTXO stays as Hydra
 * fuel (the node needs it to cover on-chain Init/Commit tx fees).
 * If they have only 1 UTXO, return null (empty commit — the single UTXO is Hydra fuel).
 */
function pickCommitUtxo(utxos: Utxo[]): Utxo | null {
  if (utxos.length >= 2) return utxos[0]; // smallest (sorted ascending)
  return null; // single UTXO reserved as fuel
}

// ============================================================
// HydraHandler — Deno port of src/client/lib/hydra/handler.ts
// ============================================================

const ERROR_TAGS = [
  "PeerHandshakeFailure", "TxInvalid", "InvalidInput",
  "CommandFailed", "DecommitInvalid",
];

type HeadStatus = "Idle" | "Initial" | "Open" | "Closed" | "FanoutPossible" | "Final";

interface GreetingsMessage {
  tag: "Greetings";
  headStatus: HeadStatus;
  hydraNodeVersion: string;
  me: { vkey: string };
  snapshotUtxo: Record<string, any> | null;
  timestamp: string;
}

class HydraHandler {
  private connection: WebSocket;
  private url: URL;
  private isReady = false;
  private greetingsPromise: Promise<GreetingsMessage>;
  private resolveGreetings!: (msg: GreetingsMessage) => void;

  constructor(url: string) {
    const wsURL = new URL(url);
    wsURL.protocol = wsURL.protocol.replace("http", "ws");
    this.url = wsURL;
    this.greetingsPromise = new Promise((resolve) => {
      this.resolveGreetings = resolve;
    });
    this.connection = new WebSocket(wsURL + "?history=no");
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.connection.onopen = () => {
      this.isReady = true;
    };
    this.connection.onerror = () => console.error("  Error on Hydra websocket");
    this.connection.onclose = () => { this.isReady = false; };
    this.connection.onmessage = (msg: MessageEvent) => {
      const data = JSON.parse(msg.data);
      if (data.tag === "Greetings") {
        this.resolveGreetings(data as GreetingsMessage);
        console.log(`  [WS] Greetings - status: ${data.headStatus}`);
      }
    };
  }

  private async ensureReady(): Promise<void> {
    if (!this.isReady) {
      await new Promise<void>((resolve) => {
        const orig = this.connection.onopen;
        this.connection.onopen = (ev) => {
          this.isReady = true;
          if (orig) (orig as (ev: Event) => void)(ev);
          resolve();
        };
      });
    }
  }

  async getHeadStatus(): Promise<HeadStatus> {
    await this.ensureReady();
    return (await this.greetingsPromise).headStatus;
  }

  async listen(tag: string, timeout = 60000): Promise<any> {
    return new Promise((resolve, reject) => {
      const tid = setTimeout(() => reject(new Error(`Timeout waiting for ${tag}`)), timeout);
      this.connection.onmessage = (msg: MessageEvent) => {
        const data = JSON.parse(msg.data);
        console.log(`  [WS] Received: ${data.tag}`);
        if (data.tag === tag) { clearTimeout(tid); resolve(data); }
        else if (data.tag === "PostTxOnChainFailed") {
          // Hydra node retries automatically — log and keep waiting
          console.log(`  [WS] ⚠ PostTxOnChainFailed (node will retry): ${data.postTxError?.tag || "unknown"}`);
        }
        else if (ERROR_TAGS.includes(data.tag)) { clearTimeout(tid); reject(new Error(`Error: ${data.tag} - ${JSON.stringify(data)}`)); }
      };
    });
  }

  async initIfNeeded(): Promise<HeadStatus> {
    const status = await this.getHeadStatus();
    if (status === "Idle") {
      console.log("  Head is Idle, sending Init...");
      this.connection.send(JSON.stringify({ tag: "Init" }));
      await this.listen("HeadIsInitializing");
      return "Initial";
    }
    console.log(`  Head is already ${status}`);
    return status;
  }

  async getSnapshot(): Promise<Utxo[]> {
    const apiURL = `${this.url.origin.replace("ws", "http")}/snapshot/utxo`;
    const response = await fetch(apiURL);
    const data = await response.json();
    return Object.entries(data).map(([outRef, output]: [string, any]) => {
      const [hash, idx] = outRef.split("#");
      return hydraUtxoToLucidUtxo(hash, Number(idx), output);
    });
  }

  stop() { this.connection.close(); }
}

// ============================================================
// UTxO Conversion
// ============================================================

type HydraUtxo = {
  address: string;
  datum: string | null;
  inlineDatum: any;
  inlineDatumhash: string | null;
  referenceScript: any | null;
  value: Record<string, number | Record<string, number>>;
};

function lucidUtxoToHydraUtxo(utxo: Utxo): HydraUtxo {
  const value: Record<string, number | Record<string, number>> = {};
  for (const [unit, amount] of Object.entries(utxo.assets)) {
    if (unit === "lovelace") {
      value["lovelace"] = Number(amount);
    } else {
      const pid = unit.slice(0, 56);
      const an = unit.slice(56);
      const cur = (value[pid] as Record<string, number>) || {};
      cur[an] = Number(amount);
      value[pid] = cur;
    }
  }
  return {
    address: utxo.address,
    value,
    datum: null,
    inlineDatum: utxo.datum || null,
    inlineDatumhash: utxo.datumHash || null,
    referenceScript: utxo.scriptRef || null,
  };
}

function hydraUtxoToLucidUtxo(hash: string, idx: number, output: any): Utxo {
  const assets: Assets = {};
  for (const [policy, value] of Object.entries(output.value)) {
    if (policy === "lovelace") {
      assets[policy] = BigInt(value as number);
    } else {
      for (const [an, amount] of Object.entries(value as any)) {
        assets[`${policy}${an}`] = BigInt(amount as number);
      }
    }
  }
  return {
    txHash: hash,
    outputIndex: idx,
    assets,
    address: output.address,
    datum: output.inlineDatumRaw || undefined,
  };
}

// ============================================================
// Key Loading & Lucid
// ============================================================

async function loadPrivateKeyHex(skPath: string): Promise<string> {
  const skJson = JSON.parse(await Deno.readTextFile(skPath));
  return skJson.cborHex.slice(4); // skip CBOR prefix 5820
}

// ============================================================
// Raw tx signing (Lucid re-serializes the body, breaking the hash)
// ============================================================

/** Skip one CBOR element and return the byte offset after it. */
function cborSkip(data: Uint8Array, offset: number): number {
  const ib = data[offset];
  const mt = ib >> 5;
  const ai = ib & 0x1f;
  let pos = offset + 1;

  let val: number;
  if (ai < 24) {
    val = ai;
  } else if (ai === 24) {
    val = data[pos++];
  } else if (ai === 25) {
    val = (data[pos] << 8) | data[pos + 1];
    pos += 2;
  } else if (ai === 26) {
    val = ((data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3]) >>> 0;
    pos += 4;
  } else if (ai === 27) {
    val = 0;
    for (let i = 0; i < 8; i++) val = val * 256 + data[pos++];
  } else if (ai === 31) {
    if (mt === 4 || mt === 2 || mt === 3) {
      while (data[pos] !== 0xff) pos = cborSkip(data, pos);
      return pos + 1;
    } else if (mt === 5) {
      while (data[pos] !== 0xff) { pos = cborSkip(data, pos); pos = cborSkip(data, pos); }
      return pos + 1;
    }
    return pos;
  } else {
    throw new Error(`Invalid CBOR additional info: ${ai}`);
  }

  switch (mt) {
    case 0: case 1: case 7: return pos;
    case 2: case 3: return pos + val;
    case 4:
      for (let i = 0; i < val; i++) pos = cborSkip(data, pos);
      return pos;
    case 5:
      for (let i = 0; i < val; i++) { pos = cborSkip(data, pos); pos = cborSkip(data, pos); }
      return pos;
    case 6: return cborSkip(data, pos);
    default: throw new Error(`Unknown CBOR major type: ${mt}`);
  }
}

/** Add a VKey witness into a CBOR-encoded witness set. */
function addVKeyToWitnessSet(witBytes: Uint8Array, vkWitCbor: Uint8Array): Uint8Array {
  if (witBytes.length === 1 && witBytes[0] === 0xa0) {
    const r = new Uint8Array(6 + vkWitCbor.length);
    r[0] = 0xa1; r[1] = 0x00;
    r[2] = 0xd9; r[3] = 0x01; r[4] = 0x02;
    r[5] = 0x81;
    r.set(vkWitCbor, 6);
    return r;
  }

  const mapByte = witBytes[0];
  if ((mapByte >> 5) !== 5) throw new Error("Expected CBOR map for witness set");
  const mapAI = mapByte & 0x1f;
  let mapSize: number, headerEnd: number;
  if (mapAI < 24) { mapSize = mapAI; headerEnd = 1; }
  else if (mapAI === 24) { mapSize = witBytes[1]; headerEnd = 2; }
  else throw new Error(`Unexpected map AI: ${mapAI}`);

  let scanPos = headerEnd;
  let hasKey0 = false;
  for (let i = 0; i < mapSize; i++) {
    if (witBytes[scanPos] === 0x00) { hasKey0 = true; break; }
    scanPos = cborSkip(witBytes, scanPos);
    scanPos = cborSkip(witBytes, scanPos);
  }

  if (!hasKey0) {
    const ns = mapSize + 1;
    const newHdr = ns < 24 ? new Uint8Array([0xa0 | ns]) : new Uint8Array([0xb8, ns]);
    const entry = new Uint8Array(5 + vkWitCbor.length);
    entry[0] = 0x00; entry[1] = 0xd9; entry[2] = 0x01; entry[3] = 0x02; entry[4] = 0x81;
    entry.set(vkWitCbor, 5);
    const existing = witBytes.slice(headerEnd);
    const r = new Uint8Array(newHdr.length + entry.length + existing.length);
    r.set(newHdr, 0); r.set(entry, newHdr.length); r.set(existing, newHdr.length + entry.length);
    return r;
  }

  scanPos = headerEnd;
  for (let i = 0; i < mapSize; i++) {
    if (witBytes[scanPos] === 0x00) {
      scanPos++;
      let tagStart = scanPos;
      let hasTag258 = false;
      if (witBytes[scanPos] === 0xd9 && witBytes[scanPos + 1] === 0x01 && witBytes[scanPos + 2] === 0x02) {
        hasTag258 = true; scanPos += 3;
      }
      const arrByte = witBytes[scanPos];
      if ((arrByte >> 5) !== 4) throw new Error(`Expected array for vkey witnesses, got 0x${arrByte.toString(16)}`);
      const arrAI = arrByte & 0x1f;
      let arrSize: number, arrHeaderEnd: number;
      if (arrAI < 24) { arrSize = arrAI; arrHeaderEnd = scanPos + 1; }
      else if (arrAI === 24) { arrSize = witBytes[scanPos + 1]; arrHeaderEnd = scanPos + 2; }
      else throw new Error(`Unexpected array AI: ${arrAI}`);
      let arrEnd = arrHeaderEnd;
      for (let j = 0; j < arrSize; j++) arrEnd = cborSkip(witBytes, arrEnd);
      const ns = arrSize + 1;
      const newArr = ns < 24 ? new Uint8Array([0x80 | ns]) : new Uint8Array([0x98, ns]);
      const tagPrefix = hasTag258 ? new Uint8Array([0xd9, 0x01, 0x02]) : new Uint8Array(0);
      const before = witBytes.slice(0, tagStart);
      const elems = witBytes.slice(arrHeaderEnd, arrEnd);
      const after = witBytes.slice(arrEnd);
      const r = new Uint8Array(before.length + tagPrefix.length + newArr.length + elems.length + vkWitCbor.length + after.length);
      let p = 0;
      r.set(before, p); p += before.length;
      r.set(tagPrefix, p); p += tagPrefix.length;
      r.set(newArr, p); p += newArr.length;
      r.set(elems, p); p += elems.length;
      r.set(vkWitCbor, p); p += vkWitCbor.length;
      r.set(after, p);
      return r;
    }
    scanPos = cborSkip(witBytes, scanPos);
    scanPos = cborSkip(witBytes, scanPos);
  }
  throw new Error("Key 0 reported as existing but not found");
}

/** Sign a Cardano tx preserving original body bytes. Returns signed CBOR hex. */
function signTxCbor(txCborHex: string, privateKeyHex: string): string {
  const tx = fromHex(txCborHex);
  let pos = 0;
  const header = tx[pos++];
  if ((header >> 5) !== 4) throw new Error(`Expected CBOR array, got mt ${header >> 5}`);

  const bodyStart = pos;
  pos = cborSkip(tx, pos);
  const bodyEnd = pos;
  const witStart = pos;
  pos = cborSkip(tx, pos);
  const witEnd = pos;

  const bodyBytes = tx.slice(bodyStart, bodyEnd);
  const bodyHash = blake2b(bodyBytes, { dkLen: 32 });
  const skBytes = fromHex(privateKeyHex);
  const pkBytes = ed25519.getPublicKey(skBytes);
  const sigBytes = ed25519.sign(bodyHash, skBytes);

  const vkWit = new Uint8Array(1 + 2 + 32 + 2 + 64);
  let w = 0;
  vkWit[w++] = 0x82;
  vkWit[w++] = 0x58; vkWit[w++] = 0x20;
  vkWit.set(pkBytes, w); w += 32;
  vkWit[w++] = 0x58; vkWit[w++] = 0x40;
  vkWit.set(sigBytes, w);

  const existingWit = tx.slice(witStart, witEnd);
  const newWit = addVKeyToWitnessSet(existingWit, vkWit);
  const rest = tx.slice(witEnd);
  const result = new Uint8Array(1 + bodyBytes.length + newWit.length + rest.length);
  let r = 0;
  result[r++] = header;
  result.set(bodyBytes, r); r += bodyBytes.length;
  result.set(newWit, r); r += newWit.length;
  result.set(rest, r);
  return toHex(result);
}

async function submitToL1(signedTxCborHex: string): Promise<string> {
  const txBytes = fromHex(signedTxCborHex);
  const response = await fetch(CARDANO_SUBMIT_API, {
    method: "POST",
    headers: { "Content-Type": "application/cbor" },
    body: txBytes,
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`L1 submit failed: ${response.status} - ${error}`);
  }
  const result = await response.text();
  return result.trim().replace(/"/g, "");
}

// ============================================================
// Commit a single participant
// ============================================================

const COMMIT_RETRIES = 3;
const COMMIT_BACKOFFS = [5000, 10000, 20000]; // 5s, 10s, 20s

async function commitParticipant(
  label: string,
  apiUrl: string,
  skHex: string,
  commitUtxo: Utxo | null,
): Promise<void> {
  // Build payload
  let payload: Record<string, HydraUtxo> = {};
  if (commitUtxo) {
    const outRef = `${commitUtxo.txHash}#${commitUtxo.outputIndex}`;
    payload = { [outRef]: lucidUtxoToHydraUtxo(commitUtxo) };
    console.log(`  ${label}: committing ${Number(commitUtxo.assets.lovelace) / 1_000_000} ADA (${outRef})`);
  } else {
    console.log(`  ${label}: empty commit (single UTXO reserved as Hydra fuel)`);
  }

  for (let attempt = 0; attempt <= COMMIT_RETRIES; attempt++) {
    try {
      // POST /commit — build the commit tx via Hydra API
      const resp = await fetch(`${apiUrl}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Commit request failed for ${label}: ${resp.status} - ${err}`);
      }
      const { cborHex } = await resp.json();

      // Sign raw (Lucid re-serializes CBOR, breaking the body hash)
      const signedCbor = signTxCbor(cborHex, skHex);
      console.log(`  ${label}: commit tx signed`);

      // Submit to L1
      const txHash = await submitToL1(signedCbor);
      console.log(`  ${label}: submitted → ${txHash}`);
      return; // success
    } catch (e) {
      const msg = (e as Error).message?.slice(0, 300) || String(e);
      if (attempt < COMMIT_RETRIES) {
        const delay = COMMIT_BACKOFFS[attempt];
        console.log(`  ${label}: attempt ${attempt + 1} failed: ${msg}`);
        console.log(`  ${label}: retrying in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        console.error(`  ${label}: ALL ${COMMIT_RETRIES + 1} attempts failed. Last error: ${msg}`);
        throw e;
      }
    }
  }
}

// ============================================================
// Open one head
// ============================================================

async function openHead(
  headName: string,
  p1: ParticipantConfig,
  p2: ParticipantConfig,
  p1CommitUtxo: Utxo | null,
  p2CommitUtxo: Utxo | null,
): Promise<void> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Opening Head ${headName}: ${p1.name} + ${p2.name}`);
  console.log("=".repeat(60));

  // Load keys
  const p1Sk = await loadPrivateKeyHex(p1.skPath);
  const p2Sk = await loadPrivateKeyHex(p2.skPath);

  // Connect
  console.log(`\n[1] Connecting to Hydra nodes...`);
  const h1 = new HydraHandler(p1.api);
  const h2 = new HydraHandler(p2.api);
  await new Promise((r) => setTimeout(r, 1000));

  // Init
  console.log(`\n[2] Initializing head...`);
  const status = await h1.initIfNeeded();
  if (status === "Open") {
    console.log("  Head already open!");
    const snap = await h1.getSnapshot();
    console.log(`  UTXOs: ${snap.length}`);
    for (const u of snap) console.log(`    ${u.txHash}#${u.outputIndex}: ${u.assets.lovelace} lovelace`);
    h1.stop(); h2.stop();
    return;
  }

  // Commit both participants (retries with exponential backoff; exits on failure)
  console.log(`\n[3] Committing...`);
  await commitParticipant(p1.name, p1.api, p1Sk, p1CommitUtxo);
  await commitParticipant(p2.name, p2.api, p2Sk, p2CommitUtxo);

  // Wait for open
  console.log(`\n[4] Waiting for HeadIsOpen...`);
  await h1.listen("HeadIsOpen", 120000);
  console.log(`  HEAD ${headName} IS OPEN!`);

  // Verify
  console.log(`\n[5] Head ${headName} Snapshot UTXOs:`);
  const snap = await h1.getSnapshot();
  for (const u of snap) console.log(`    ${u.txHash}#${u.outputIndex}: ${u.assets.lovelace} lovelace`);
  if (snap.length === 0) console.log("    (empty)");

  h1.stop();
  h2.stop();
}

// ============================================================
// Main
// ============================================================

async function main() {
  // Load initial L1 UTXOs from file (written by cardano-node entrypoint)
  console.log("Loading initial L1 UTXOs from", UTXO_FILE);
  const aliceUtxos = await loadL1Utxos("alice");
  const bobUtxos = await loadL1Utxos("bob");
  const idaUtxos = await loadL1Utxos("ida");
  console.log(`  Alice: ${aliceUtxos.length} UTXOs, Bob: ${bobUtxos.length} UTXOs, Ida: ${idaUtxos.length} UTXOs`);

  // Ida participates in both heads — she has 4 UTXOs (sorted ascending by lovelace):
  //   [1000 ADA, 1000 ADA, 9000 ADA, 9000 ADA]
  // Split: 1st commit for Head A, 2nd commit for Head B.
  // The Hydra nodes auto-select fuel from the larger UTXOs.
  const idaCommitA = idaUtxos.length >= 4 ? idaUtxos[0] : pickCommitUtxo(idaUtxos);
  const idaCommitB = idaUtxos.length >= 4 ? idaUtxos[1] : null;

  // Head A: Alice + Ida
  const aliceCommit = pickCommitUtxo(aliceUtxos);
  console.log(`\n  Planned commits:`);
  console.log(`    Head A: alice=${aliceCommit ? `${aliceCommit.assets.lovelace / 1000000n} ADA` : "empty"}, ida=${idaCommitA ? `${idaCommitA.assets.lovelace / 1000000n} ADA` : "empty"}`);
  console.log(`    Head B: bob=${pickCommitUtxo(bobUtxos) ? `${pickCommitUtxo(bobUtxos)!.assets.lovelace / 1000000n} ADA` : "empty"}, ida=${idaCommitB ? `${idaCommitB.assets.lovelace / 1000000n} ADA` : "empty"}`);
  await openHead("A", HEAD_A.p1, HEAD_A.p2, aliceCommit, idaCommitA);

  // Head B: Bob + Ida
  const bobCommit = pickCommitUtxo(bobUtxos);
  await openHead("B", HEAD_B.p1, HEAD_B.p2, bobCommit, idaCommitB);

  console.log(`\n${"=".repeat(60)}`);
  console.log("BOTH HEADS OPEN!");
  console.log("=".repeat(60));
}

main().catch((e) => {
  console.error("Error:", e);
  Deno.exit(1);
});
