import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { requireRole } from "@/lib/auth/role-guard";
import { logger } from "@/lib/logger";
import { createWorkflow } from "@/lib/workflows";
import { WorkflowStatus, WorkflowType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";

const schema = z.object({
  idempotencyKey: z.string().min(8).optional(),
});

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const guard = requireRole(req, requestId, ["admin"]);
  if (!guard.ok) return guard.response;

  try {
    const bodyResult = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(bodyResult ?? {});
    if (!parsed.success) {
      return apiError(400, requestId, "REQUEST_VALIDATION_FAILED", "pay-random-winner payload validation failed", parsed.error.issues);
    }

    // Dedupe in-flight workflows to avoid multiple random winners from rapid clicks.
    const inFlight = await prisma.workflow.findFirst({
      where: {
        type: WorkflowType.pay_random_winner,
        status: { in: [WorkflowStatus.pending, WorkflowStatus.running] },
      },
      orderBy: { createdAt: "desc" },
    });

    if (inFlight) {
      return NextResponse.json({
        requestId,
        ok: true,
        workflowId: inFlight.id,
        workflowStatus: inFlight.status,
        queuedAt: inFlight.createdAt.toISOString(),
        deduplicated: true,
      });
    }

    const idempotencyKey = parsed.data.idempotencyKey
      ?? `admin:pay_random_winner:${crypto.randomUUID()}`;

    const wf = await createWorkflow(
      WorkflowType.pay_random_winner,
      guard.role,
      idempotencyKey,
      {},
    );

    return NextResponse.json({
      requestId,
      ok: true,
      workflowId: wf.id,
      workflowStatus: wf.status,
      queuedAt: wf.createdAt.toISOString(),
      deduplicated: false,
    });
  } catch (error) {
    logger.error({ requestId, err: error }, "admin pay-random-winner failed");
    const message = error instanceof Error ? error.message : "Pay random winner failed";
    return apiError(500, requestId, "ADMIN_PAY_RANDOM_WINNER_FAILED", message);
  }
}
