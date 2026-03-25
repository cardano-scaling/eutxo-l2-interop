import { NextResponse } from "next/server";
import { WorkflowStatus, WorkflowType } from "@prisma/client";
import { apiError } from "@/lib/api-error";
import { requireRole } from "@/lib/auth/role-guard";
import { prisma } from "@/lib/db";

const MAX_LIMIT = 100;

function parseStatus(value: string | null): WorkflowStatus | undefined {
  if (!value) return undefined;
  if (
    value === WorkflowStatus.pending
    || value === WorkflowStatus.running
    || value === WorkflowStatus.failed
    || value === WorkflowStatus.cancelled
    || value === WorkflowStatus.succeeded
  ) {
    return value;
  }
  return undefined;
}

function parseType(value: string | null): WorkflowType | undefined {
  if (!value) return undefined;
  if (
    value === WorkflowType.buy_ticket
    || value === WorkflowType.request_funds
    || value === WorkflowType.admin_head_operation
    || value === WorkflowType.pay_random_winner
  ) {
    return value;
  }
  return undefined;
}

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  const guard = requireRole(req, requestId, ["admin"]);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const status = parseStatus(url.searchParams.get("status"));
  const type = parseType(url.searchParams.get("type"));
  const actor = url.searchParams.get("actor")?.trim() || undefined;
  const idContains = url.searchParams.get("idContains")?.trim() || undefined;
  const idempotencyContains = url.searchParams.get("idempotencyContains")?.trim() || undefined;
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(url.searchParams.get("limit") || 25)));
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const includeCompleted = url.searchParams.get("includeCompleted") === "true";
  const skip = (page - 1) * limit;

  if (url.searchParams.get("status") && !status) {
    return apiError(400, requestId, "REQUEST_VALIDATION_FAILED", "Invalid status filter");
  }
  if (url.searchParams.get("type") && !type) {
    return apiError(400, requestId, "REQUEST_VALIDATION_FAILED", "Invalid type filter");
  }

  const where = {
    ...(status
      ? { status }
      : !includeCompleted
        ? { status: { not: WorkflowStatus.succeeded } }
        : {}),
    ...(type ? { type } : {}),
    ...(actor ? { actor: { contains: actor, mode: "insensitive" as const } } : {}),
    ...(idContains ? { id: { contains: idContains, mode: "insensitive" as const } } : {}),
    ...(idempotencyContains
      ? { idempotencyKey: { contains: idempotencyContains, mode: "insensitive" as const } }
      : {}),
  };

  const [total, workflows] = await Promise.all([
    prisma.workflow.count({ where }),
    prisma.workflow.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip,
      take: limit,
      include: {
        steps: { orderBy: { createdAt: "asc" } },
        events: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return NextResponse.json({
    requestId,
    page,
    limit,
    total,
    totalPages,
    hasPrevPage: page > 1,
    hasNextPage: page < totalPages,
    count: workflows.length,
    workflows,
  });
}

