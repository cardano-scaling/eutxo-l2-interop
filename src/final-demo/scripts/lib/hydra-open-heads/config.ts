import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isCustomNetworkMode } from "../../../lib/hydra/network";
import type { Participant } from "./types";

const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const finalDemoRoot = dirname(scriptsDir);
export const repoRoot = dirname(finalDemoRoot);
export const runtimeRoot = join(finalDemoRoot, "runtime");
export const l1UtxoFile = join(runtimeRoot, "l1-utxos.json");
export const l1ReadyFile = join(runtimeRoot, "l1-utxos.ready");
export const credentialsRoot = join(finalDemoRoot, "credentials");
export const infraCredentialsRoot = join(repoRoot, "infra", "credentials");

export const isDockerRuntime = existsSync("/.dockerenv");

export function runtimeUrl(localUrl: string, dockerUrl: string): string {
  return isDockerRuntime ? dockerUrl : localUrl;
}

/**
 * When HYDRA_HEAD_B_BOB_API_URL / HYDRA_HEAD_B_JON_API_URL are unset, infer host from HYDRA_HEAD_B_API_URL.
 * A generic Docker context (/.dockerenv) is not the same as being on the compose `hydra_net`; if ida is reached
 * via loopback or host.docker.internal, bob/jon must use that same host with their published ports.
 */
export function resolveHeadBPeerApi(
  explicitUrl: string | undefined,
  port: string,
  dockerHostname: string,
  idaApiUrl: string,
): string {
  const trimmed = explicitUrl?.trim();
  if (trimmed) return trimmed;
  try {
    const u = new URL(idaApiUrl);
    const h = u.hostname;
    if (h === "127.0.0.1" || h === "localhost" || h === "0.0.0.0") {
      return `http://${h}:${port}`;
    }
    if (h === "hydra-node-ida-2-lt") {
      return `http://${dockerHostname}:${port}`;
    }
    return `http://${h}:${port}`;
  } catch {
    return runtimeUrl(`http://127.0.0.1:${port}`, `http://${dockerHostname}:${port}`);
  }
}

export function headOpenWaitMs(): number {
  const raw = process.env.HYDRA_HEAD_OPEN_TIMEOUT_MS?.trim();
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 30_000;
}

export const headBIdaApi =
  process.env.HYDRA_HEAD_B_API_URL?.trim()
  || runtimeUrl("http://127.0.0.1:4329", "http://hydra-node-ida-2-lt:4329");

export const headA = {
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

export const headB = {
  p1: {
    name: "bob",
    api: resolveHeadBPeerApi(process.env.HYDRA_HEAD_B_BOB_API_URL, "4322", "hydra-node-bob-lt", headBIdaApi),
    skPath: join(credentialsRoot, "bob", "bob-funds.sk"),
  } as Participant,
  p2: {
    name: "ida",
    api: headBIdaApi,
    skPath: join(credentialsRoot, "ida", "ida-funds.sk"),
  } as Participant,
  p3: {
    name: "jon",
    api: resolveHeadBPeerApi(process.env.HYDRA_HEAD_B_JON_API_URL, "4328", "hydra-node-jon-lt", headBIdaApi),
    skPath: join(credentialsRoot, "jon", "jon-funds.sk"),
  } as Participant,
};

export const headC = {
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

export const CARDANO_QUERY_API = process.env.CARDANO_QUERY_API_URL
  ?? runtimeUrl("http://127.0.0.1:1442", "http://cardano-node:1442");

if (!isCustomNetworkMode() && !process.env.CARDANO_QUERY_API_URL?.trim()) {
  throw new Error("CARDANO_QUERY_API_URL must be configured for preprod/external mode");
}
