import { NextResponse } from "next/server";
import { WorkflowType } from "@prisma/client";
import { z } from "zod";
import { apiError, readJsonBody } from "@/lib/api-error";
import { requireRole } from "@/lib/auth/role-guard";
import { createWorkflow } from "@/lib/workflows";
import { logger } from "@/lib/logger";

const schema = z.object({
  operation: z.enum(["open_head_a", "open_head_b", "open_heads_ab", "commit_head_c_charlie"]),
  idempotencyKey: z.string().min(8).optional(),
});

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const guard = requireRole(req, requestId, ["admin"]);
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(req);
  if (!body.ok) {
    return apiError(400, requestId, "INVALID_JSON_BODY", "Request body must be valid JSON");
  }
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    return apiError(400, requestId, "REQUEST_VALIDATION_FAILED", "Head operation payload validation failed", parsed.error.issues);
  }

  try {
    const idempotencyKey = parsed.data.idempotencyKey
      ?? `admin:head_op:${parsed.data.operation}:${crypto.randomUUID()}`;
    const workflow = await createWorkflow(
      WorkflowType.admin_head_operation,
      "admin",
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

