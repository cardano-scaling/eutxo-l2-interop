import { NextResponse } from "next/server";
import { retryWorkflowNow } from "@/lib/workflows";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await retryWorkflowNow(id);
  return NextResponse.json({ ok: true, workflowId: id });
}
