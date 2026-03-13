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

function mapHydraHeadStatus(value: string): "open" | "closed" | "idle" | "connected" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "open") return "open";
  if (normalized === "closed" || normalized === "final") return "closed";
  if (normalized === "idle" || normalized === "initial") return "idle";
  return "connected";
}

export async function fetchHydraHeadStatus(
  head: HydraHead,
): Promise<{ ok: true; status: "open" | "closed" | "idle" | "connected"; detail: string } | { ok: false; reason: string }> {
  const baseUrl = hydraHeadApiUrl(head);
  if (!baseUrl) {
    return { ok: false, reason: `${head} API URL is not configured` };
  }
  const wsUrl = `${baseUrl.replace(/^http/, "ws")}?history=no`;
  const timeoutMs = hydraOperationTimeoutMs();
  const WebSocketCtor: any = typeof globalThis.WebSocket !== "undefined"
    ? globalThis.WebSocket
    : (await import("ws")).WebSocket;

  return new Promise((resolve) => {
    const websocket = new WebSocketCtor(wsUrl);
    let settled = false;

    const finish = (result: { ok: true; status: "open" | "closed" | "idle" | "connected"; detail: string } | { ok: false; reason: string }) => {
      if (settled) return;
      settled = true;
      try {
        websocket.close();
      } catch {
        // no-op
      }
      resolve(result);
    };

    const timeout = setTimeout(() => {
      finish({ ok: false, reason: `Timed out waiting for hydra greeting after ${timeoutMs}ms` });
    }, timeoutMs);

    websocket.onerror = (event: any) => {
      clearTimeout(timeout);
      finish({ ok: false, reason: `Hydra websocket error: ${String(event)}` });
    };

    websocket.onmessage = (event: any) => {
      try {
        const payload = JSON.parse(String(event.data)) as { tag?: string; headStatus?: string };
        if (!payload.headStatus) return;
        clearTimeout(timeout);
        const status = mapHydraHeadStatus(payload.headStatus);
        finish({
          ok: true,
          status,
          detail: `Hydra websocket status: ${payload.headStatus}`,
        });
      } catch (error) {
        clearTimeout(timeout);
        const message = error instanceof Error ? error.message : String(error);
        finish({ ok: false, reason: `Failed to parse hydra websocket message: ${message}` });
      }
    };
  });
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
