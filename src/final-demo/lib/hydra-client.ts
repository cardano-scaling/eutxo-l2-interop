import { logger } from "./logger";

export type HydraHead = "headA" | "headB" | "headC";

type HydraMode = "mock" | "real";

const DEFAULT_OPERATION_TIMEOUT_MS = 20_000;

function normalizeUrl(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export function hydraMode(): HydraMode {
  return process.env.HYDRA_ADAPTER_MODE === "mock" ? "mock" : "real";
}

export function isRealHydraMode(): boolean {
  return hydraMode() === "real";
}

export function hydraOperationTimeoutMs(): number {
  const parsed = Number(process.env.HYDRA_OPERATION_TIMEOUT_MS ?? DEFAULT_OPERATION_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_OPERATION_TIMEOUT_MS;
}

export function hydraHeadApiUrl(head: HydraHead): string | null {
  if (head === "headA") return normalizeUrl(process.env.HYDRA_HEAD_A_API_URL);
  if (head === "headB") return normalizeUrl(process.env.HYDRA_HEAD_B_API_URL);
  return normalizeUrl(process.env.HYDRA_HEAD_C_API_URL);
}

export async function fetchHydraSnapshot(head: HydraHead): Promise<{ ok: true } | { ok: false; reason: string }> {
  const baseUrl = hydraHeadApiUrl(head);
  if (!baseUrl) {
    return { ok: false, reason: `${head} API URL is not configured` };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), hydraOperationTimeoutMs());
  try {
    const candidates = ["/snapshot/utxo", "/protocol-parameters"];
    for (const path of candidates) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "GET",
        signal: controller.signal,
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) {
        continue;
      }
      // Validate payload can be parsed; shape is intentionally loose because Hydra versions vary.
      await response.json();
      return { ok: true };
    }
    return { ok: false, reason: `${head} probe endpoints returned non-2xx` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ head, err: error }, "hydra snapshot probe failed");
    return { ok: false, reason: message };
  } finally {
    clearTimeout(timeout);
  }
}
