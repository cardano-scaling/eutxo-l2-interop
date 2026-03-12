import { prisma } from "./db";
import { fetchHydraSnapshot, isRealHydraMode } from "./hydra-client";
import { logger } from "./logger";
import type { HeadReadModel, HeadStatus, HeadsStateReadModel } from "./types";

const NEVER_UPDATED_AT = new Date(0).toISOString();
export const STALE_THRESHOLD_MS = Number(process.env.HEAD_STATE_STALE_MS ?? 60_000);
const HEAD_NAMES = ["headA", "headB", "headC"] as const;

function asHeadStatus(value: string | undefined): HeadStatus {
  if (value === "connected" || value === "disconnected" || value === "idle" || value === "open" || value === "closed") {
    return value;
  }
  logger.error({ value }, "unexpected head status");
  return "disconnected";
}

function buildHeadReadModel(
  row: { status: string; detail: string | null; updatedAt: Date } | undefined,
  fallbackUpdatedAt: string,
  nowMs: number,
): HeadReadModel {
  const updatedAt = row?.updatedAt.toISOString() ?? fallbackUpdatedAt;
  const ageMs = Math.max(0, nowMs - new Date(updatedAt).getTime());
  return {
    status: asHeadStatus(row?.status),
    detail: row?.detail ?? "Not connected yet",
    updatedAt,
    ageMs,
    isStale: ageMs > STALE_THRESHOLD_MS,
  };
}

export async function getHeadsState(): Promise<HeadsStateReadModel> {
  const rows = await prisma.headSnapshot.findMany();
  const nowMs = Date.now();
  const byHead = new Map(rows.map((r) => [r.headName, r]));
  const latestRowMs = rows.length > 0
    ? Math.max(...rows.map((r) => r.updatedAt.getTime()))
    : new Date(NEVER_UPDATED_AT).getTime();
  const latestUpdatedAt = new Date(latestRowMs).toISOString();

  const headA = buildHeadReadModel(byHead.get("headA"), latestUpdatedAt, nowMs);
  const headB = buildHeadReadModel(byHead.get("headB"), latestUpdatedAt, nowMs);
  const headC = buildHeadReadModel(byHead.get("headC"), latestUpdatedAt, nowMs);
  const ageMs = Math.max(0, nowMs - latestRowMs);

  return {
    headA,
    headB,
    headC,
    updatedAt: latestUpdatedAt,
    ageMs,
    isStale: ageMs > STALE_THRESHOLD_MS,
    staleThresholdMs: STALE_THRESHOLD_MS,
  };
}

export async function upsertHeadState(headName: "headA" | "headB" | "headC", status: string, detail = "") {
  await prisma.headSnapshot.upsert({
    where: { headName },
    create: { headName, status, detail },
    update: { status, detail },
  });
}

export async function syncHeadSnapshotsHeartbeat() {
  if (isRealHydraMode()) {
    // In real mode, heartbeat is a live probe against Hydra APIs so stale/open state reflects topology health.
    for (const headName of HEAD_NAMES) {
      const probe = await fetchHydraSnapshot(headName);
      if (probe.ok) {
        await upsertHeadState(headName, "open", "Hydra snapshot endpoint reachable");
      } else {
        await upsertHeadState(headName, "disconnected", probe.reason);
      }
    }
    return;
  }

  const rows = await prisma.headSnapshot.findMany({
    where: { headName: { in: [...HEAD_NAMES] } },
  });
  const byHead = new Map(rows.map((r) => [r.headName, r]));

  for (const headName of HEAD_NAMES) {
    const row = byHead.get(headName);
    await upsertHeadState(
      headName,
      asHeadStatus(row?.status),
      row?.detail ?? "Not connected yet",
    );
  }
}
