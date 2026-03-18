import { NextResponse } from "next/server";
import { WorkflowStatus, WorkflowType } from "@prisma/client";
import { z } from "zod";
import { apiError, readJsonBody } from "@/lib/api-error";
import { requireRole } from "@/lib/auth/role-guard";
import { createWorkflow } from "@/lib/workflows";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

const schema = z.object({
  operation: z.enum(["open_head_a", "open_head_b", "open_heads_ab", "commit_head_c_charlie", "commit_head_c_admin"]),
  idempotencyKey: z.string().min(8).optional(),
});

async function findInFlightHeadOperation(operation: z.infer<typeof schema>["operation"]) {
  const rows = await prisma.workflow.findMany({
    where: {
      type: WorkflowType.admin_head_operation,
      status: { in: [WorkflowStatus.pending, WorkflowStatus.running] },
    },
    orderBy: [{ createdAt: "desc" }],
    take: 50,
  });
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payloadJson || "{}") as { operation?: string };
      if (payload.operation === operation) return row;
    } catch {
      // Ignore malformed legacy payloads.
    }
  }
  return null;
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const guard = requireRole(req, requestId, ["admin", "charlie"]);
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(req);
  if (!body.ok) {
    return apiError(400, requestId, "INVALID_JSON_BODY", "Request body must be valid JSON");
  }
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    return apiError(400, requestId, "REQUEST_VALIDATION_FAILED", "Head operation payload validation failed", parsed.error.issues);
  }
  if (
    guard.role === "charlie"
    && parsed.data.operation !== "commit_head_c_charlie"
  ) {
    return apiError(
      403,
      requestId,
      "ROLE_FORBIDDEN_OPERATION",
      "Charlie can only run commit_head_c_charlie",
      { operation: parsed.data.operation },
    );
  }

  try {
    const existing = await findInFlightHeadOperation(parsed.data.operation);
    if (existing) {
      return NextResponse.json({
        requestId,
        ok: true,
        operation: parsed.data.operation,
        workflowId: existing.id,
        workflowStatus: existing.status,
        idempotencyKey: existing.idempotencyKey,
        queuedAt: existing.createdAt.toISOString(),
        deduplicated: true,
      });
    }

    const idempotencyKey = parsed.data.idempotencyKey
      ?? `${guard.role}:head_op:${parsed.data.operation}:${crypto.randomUUID()}`;
    const workflow = await createWorkflow(
      WorkflowType.admin_head_operation,
      guard.role,
      idempotencyKey,
      { operation: parsed.data.operation },
    );
    return NextResponse.json({
      requestId,
      ok: true,
      operation: parsed.data.operation,
      workflowId: workflow.id,
      workflowStatus: workflow.status,
      idempotencyKey,
      queuedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ requestId, err: error, operation: parsed.data.operation }, "admin head operation failed");
    const message = error instanceof Error ? error.message : "Unknown error";
    return apiError(500, requestId, "ADMIN_HEAD_OPERATION_FAILED", "Failed to run head operation", { operation: parsed.data.operation, message });
  }
}

