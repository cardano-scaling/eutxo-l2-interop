import { NextResponse } from "next/server";
import { upsertHeadState } from "@/lib/heads";

export async function POST() {
  await upsertHeadState("headA", "open", "Connected");
  await upsertHeadState("headB", "open", "Connected");
  await upsertHeadState("headC", "idle", "Ready");
  return NextResponse.json({ ok: true });
}
