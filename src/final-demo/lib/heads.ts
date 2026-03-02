import { prisma } from "./db";
import type { HeadsState } from "./types";

const DEFAULT_HEADS: HeadsState = {
  headA: { status: "disconnected", detail: "Not connected yet" },
  headB: { status: "disconnected", detail: "Not connected yet" },
  headC: { status: "disconnected", detail: "Not connected yet" },
  updatedAt: new Date().toISOString(),
};

export async function getHeadsState(): Promise<HeadsState> {
  const rows = await prisma.headSnapshot.findMany();
  if (rows.length === 0) return DEFAULT_HEADS;
  const byHead = new Map(rows.map((r) => [r.headName, r]));
  return {
    headA: {
      status: (byHead.get("headA")?.status as HeadsState["headA"]["status"]) || "disconnected",
      detail: byHead.get("headA")?.detail || "",
    },
    headB: {
      status: (byHead.get("headB")?.status as HeadsState["headB"]["status"]) || "disconnected",
      detail: byHead.get("headB")?.detail || "",
    },
    headC: {
      status: (byHead.get("headC")?.status as HeadsState["headC"]["status"]) || "disconnected",
      detail: byHead.get("headC")?.detail || "",
    },
    updatedAt: new Date().toISOString(),
  };
}

export async function upsertHeadState(headName: "headA" | "headB" | "headC", status: string, detail = "") {
  await prisma.headSnapshot.upsert({
    where: { headName },
    create: { headName, status, detail },
    update: { status, detail },
  });
}
