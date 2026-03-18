import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  blake2b,
  deriveEd25519PublicKey_sync,
  getEd25519Signature_sync,
} from "@harmoniclabs/crypto";
import { lucidUtxoToHydraUtxo, type HydraUtxo, type Utxo } from "./node-hydra-handler";

const isDockerRuntime = existsSync("/.dockerenv");

function runtimeUrl(localUrl: string, dockerUrl: string): string {
  return isDockerRuntime ? dockerUrl : localUrl;
}

const CARDANO_SUBMIT_API = process.env.CARDANO_SUBMIT_API_URL
  ?? runtimeUrl("http://127.0.0.1:8090/api/submit/tx", "http://cardano-submit-api:8090/api/submit/tx");

export const COMMIT_RETRIES = 3;
export const COMMIT_BACKOFFS = [5000, 10000, 20000];
export const MIN_COMMIT_LOVELACE = 10_000_000n;

function fromHex(hex: string): Uint8Array {
  const normalized = hex.trim().toLowerCase();
  if (normalized.length % 2 !== 0) throw new Error("Invalid hex length");
  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    out[i / 2] = Number.parseInt(normalized.slice(i, i + 2), 16);
  }
  return out;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function pickCommitUtxo(utxos: Utxo[]): Utxo | null {
  if (utxos.length < 2) return null;
  const eligible = utxos.filter((u) => u.assets.lovelace >= MIN_COMMIT_LOVELACE);
  if (eligible.length >= 2) return eligible[0];
  return null;
}

export async function loadPrivateKeyHex(skPath: string): Promise<string> {
  const skJson = JSON.parse(await readFile(skPath, "utf8")) as { cborHex: string };
  return skJson.cborHex.slice(4);
}

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
    }
    if (mt === 5) {
      while (data[pos] !== 0xff) {
        pos = cborSkip(data, pos);
        pos = cborSkip(data, pos);
      }
      return pos + 1;
    }
    return pos;
  } else {
    throw new Error(`Invalid CBOR additional info: ${ai}`);
  }

  switch (mt) {
    case 0:
    case 1:
    case 7:
      return pos;
    case 2:
    case 3:
      return pos + val;
    case 4:
      for (let i = 0; i < val; i++) pos = cborSkip(data, pos);
      return pos;
    case 5:
      for (let i = 0; i < val; i++) {
        pos = cborSkip(data, pos);
        pos = cborSkip(data, pos);
      }
      return pos;
    case 6:
      return cborSkip(data, pos);
    default:
      throw new Error(`Unknown CBOR major type: ${mt}`);
  }
}

function addVKeyToWitnessSet(witBytes: Uint8Array, vkWitCbor: Uint8Array): Uint8Array {
  if (witBytes.length === 1 && witBytes[0] === 0xa0) {
    const r = new Uint8Array(6 + vkWitCbor.length);
    r[0] = 0xa1;
    r[1] = 0x00;
    r[2] = 0xd9;
    r[3] = 0x01;
    r[4] = 0x02;
    r[5] = 0x81;
    r.set(vkWitCbor, 6);
    return r;
  }

  const mapByte = witBytes[0];
  if ((mapByte >> 5) !== 5) throw new Error("Expected CBOR map for witness set");
  const mapAI = mapByte & 0x1f;
  let mapSize: number;
  let headerEnd: number;
  if (mapAI < 24) {
    mapSize = mapAI;
    headerEnd = 1;
  } else if (mapAI === 24) {
    mapSize = witBytes[1];
    headerEnd = 2;
  } else {
    throw new Error(`Unexpected map AI: ${mapAI}`);
  }

  let scanPos = headerEnd;
  let hasKey0 = false;
  for (let i = 0; i < mapSize; i++) {
    if (witBytes[scanPos] === 0x00) {
      hasKey0 = true;
      break;
    }
    scanPos = cborSkip(witBytes, scanPos);
    scanPos = cborSkip(witBytes, scanPos);
  }

  if (!hasKey0) {
    const ns = mapSize + 1;
    const newHdr = ns < 24 ? new Uint8Array([0xa0 | ns]) : new Uint8Array([0xb8, ns]);
    const entry = new Uint8Array(5 + vkWitCbor.length);
    entry[0] = 0x00;
    entry[1] = 0xd9;
    entry[2] = 0x01;
    entry[3] = 0x02;
    entry[4] = 0x81;
    entry.set(vkWitCbor, 5);
    const existing = witBytes.slice(headerEnd);
    const r = new Uint8Array(newHdr.length + entry.length + existing.length);
    r.set(newHdr, 0);
    r.set(entry, newHdr.length);
    r.set(existing, newHdr.length + entry.length);
    return r;
  }

  scanPos = headerEnd;
  for (let i = 0; i < mapSize; i++) {
    if (witBytes[scanPos] === 0x00) {
      scanPos++;
      const tagStart = scanPos;
      let hasTag258 = false;
      if (witBytes[scanPos] === 0xd9 && witBytes[scanPos + 1] === 0x01 && witBytes[scanPos + 2] === 0x02) {
        hasTag258 = true;
        scanPos += 3;
      }
      const arrByte = witBytes[scanPos];
      if ((arrByte >> 5) !== 4) throw new Error(`Expected array for vkey witnesses, got 0x${arrByte.toString(16)}`);
      const arrAI = arrByte & 0x1f;
      let arrSize: number;
      let arrHeaderEnd: number;
      if (arrAI < 24) {
        arrSize = arrAI;
        arrHeaderEnd = scanPos + 1;
      } else if (arrAI === 24) {
        arrSize = witBytes[scanPos + 1];
        arrHeaderEnd = scanPos + 2;
      } else {
        throw new Error(`Unexpected array AI: ${arrAI}`);
      }
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
      r.set(before, p);
      p += before.length;
      r.set(tagPrefix, p);
      p += tagPrefix.length;
      r.set(newArr, p);
      p += newArr.length;
      r.set(elems, p);
      p += elems.length;
      r.set(vkWitCbor, p);
      p += vkWitCbor.length;
      r.set(after, p);
      return r;
    }
    scanPos = cborSkip(witBytes, scanPos);
    scanPos = cborSkip(witBytes, scanPos);
  }
  throw new Error("Key 0 reported as existing but not found");
}

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
  const bodyHash = blake2b(bodyBytes, 32);
  const skBytes = fromHex(privateKeyHex);
  const pkBytes = deriveEd25519PublicKey_sync(skBytes);
  const sigBytes = getEd25519Signature_sync(bodyHash, skBytes);

  const vkWit = new Uint8Array(1 + 2 + 32 + 2 + 64);
  let w = 0;
  vkWit[w++] = 0x82;
  vkWit[w++] = 0x58;
  vkWit[w++] = 0x20;
  vkWit.set(pkBytes, w);
  w += 32;
  vkWit[w++] = 0x58;
  vkWit[w++] = 0x40;
  vkWit.set(sigBytes, w);

  const existingWit = tx.slice(witStart, witEnd);
  const newWit = addVKeyToWitnessSet(existingWit, vkWit);
  const rest = tx.slice(witEnd);
  const result = new Uint8Array(1 + bodyBytes.length + newWit.length + rest.length);
  let r = 0;
  result[r++] = header;
  result.set(bodyBytes, r);
  r += bodyBytes.length;
  result.set(newWit, r);
  r += newWit.length;
  result.set(rest, r);
  return toHex(result);
}

async function submitToL1(signedTxCborHex: string): Promise<string> {
  const txBytes = fromHex(signedTxCborHex);
  const response = await fetch(CARDANO_SUBMIT_API, {
    method: "POST",
    headers: { "Content-Type": "application/cbor" },
    body: Buffer.from(txBytes),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`L1 submit failed: ${response.status} - ${error}`);
  }
  const result = await response.text();
  return result.trim().replace(/"/g, "");
}

export async function commitParticipant(
  label: string,
  apiUrl: string,
  skHex: string,
  commitUtxo: Utxo | null,
): Promise<void> {
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
      const resp = await fetch(`${apiUrl}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Commit request failed for ${label}: ${resp.status} - ${err}`);
      }
      const { cborHex } = (await resp.json()) as { cborHex: string };
      const signedCbor = signTxCbor(cborHex, skHex);
      console.log(`  ${label}: commit tx signed`);
      const txHash = await submitToL1(signedCbor);
      console.log(`  ${label}: submitted -> ${txHash}`);
      return;
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

