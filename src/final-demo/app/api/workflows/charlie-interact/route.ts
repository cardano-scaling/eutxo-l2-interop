import { NextResponse } from "next/server";
import { WorkflowType } from "@prisma/client";
import { z } from "zod";
import { createWorkflow } from "@/lib/workflows";

const schema = z.object({
  actor: z.string().min(1),
  idempotencyKey: z.string().min(1),
  address: z.string().min(8),
  action: z.enum(["init_head_c", "interact_head_b"]),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  const wf = await createWorkflow(
    WorkflowType.charlie_interact,
    parsed.data.actor,
    parsed.data.idempotencyKey,
    {
      address: parsed.data.address,
      action: parsed.data.action,
    },
  );
  return NextResponse.json({ workflowId: wf.id, status: wf.status }, { status: 202 });
}
