import { NextResponse } from "next/server";
import { WorkflowType } from "@prisma/client";
import { z } from "zod";
import { createWorkflow } from "@/lib/workflows";

const schema = z.object({
  actor: z.string().min(1),
  idempotencyKey: z.string().min(1),
  wallet: z.string().min(8),
  amountLovelace: z.string().min(1),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  const wf = await createWorkflow(
    WorkflowType.request_funds,
    parsed.data.actor,
    parsed.data.idempotencyKey,
    {
      wallet: parsed.data.wallet,
      amountLovelace: parsed.data.amountLovelace,
    },
  );
  return NextResponse.json({ workflowId: wf.id, status: wf.status }, { status: 202 });
}
