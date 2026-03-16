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
  if (value === WorkflowType.buy_ticket || value === WorkflowType.request_funds) {
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

  if (url.searchParams.get("status") && !status) {
    return apiError(400, requestId, "REQUEST_VALIDATION_FAILED", "Invalid status filter");
  }
  if (url.searchParams.get("type") && !type) {
    return apiError(400, requestId, "REQUEST_VALIDATION_FAILED", "Invalid type filter");
  }

  const workflows = await prisma.workflow.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
      ...(actor ? { actor: { contains: actor, mode: "insensitive" } } : {}),
      ...(idContains ? { id: { contains: idContains, mode: "insensitive" } } : {}),
      ...(idempotencyContains
        ? { idempotencyKey: { contains: idempotencyContains, mode: "insensitive" } }
        : {}),
    },
    orderBy: [{ updatedAt: "desc" }],
    take: limit,
    include: {
      steps: { orderBy: { createdAt: "asc" } },
      events: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });

  return NextResponse.json({
    requestId,
    count: workflows.length,
    workflows,
  });
}

