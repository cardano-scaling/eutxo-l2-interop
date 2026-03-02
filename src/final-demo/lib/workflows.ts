import { WorkflowStatus, WorkflowType } from "@prisma/client";
import { prisma } from "./db";
import { logger } from "./logger";

type JsonObj = Record<string, unknown>;

function asJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function deriveErrorCode(reason: string): string {
  const match = reason.match(/[A-Z][A-Z0-9_]{2,}/);
  return match?.[0] ?? "WORKFLOW_ERROR";
}

export async function appendEvent(
  workflowId: string,
  level: "info" | "warn" | "error",
  message: string,
  meta?: JsonObj,
) {
  await prisma.workflowEvent.create({
    data: { workflowId, level, message, metaJson: meta ? asJson(meta) : null },
  });
}

export async function createWorkflow(type: WorkflowType, actor: string, idempotencyKey: string, payload: JsonObj) {
  const existing = await prisma.workflow.findFirst({
    where: { type, idempotencyKey },
    include: { steps: true, events: { orderBy: { createdAt: "asc" } } },
  });
  if (existing) return existing;

  const created = await prisma.workflow.create({
    data: {
      type,
      actor,
      status: WorkflowStatus.pending,
      correlationId: crypto.randomUUID(),
      idempotencyKey,
      payloadJson: asJson(payload),
      steps: {
        create: [
          { name: "prepare", status: WorkflowStatus.pending },
          { name: "submit", status: WorkflowStatus.pending },
          { name: "confirm", status: WorkflowStatus.pending },
        ],
      },
    },
    include: { steps: true },
  });
  await appendEvent(created.id, "info", "Workflow created", { type, actor });
  return prisma.workflow.findUniqueOrThrow({
    where: { id: created.id },
    include: { steps: { orderBy: { createdAt: "asc" } }, events: { orderBy: { createdAt: "asc" } } },
  });
}

export async function getWorkflow(id: string) {
  return prisma.workflow.findUnique({
    where: { id },
    include: { steps: { orderBy: { createdAt: "asc" } }, events: { orderBy: { createdAt: "asc" } } },
  });
}

export async function retryWorkflowNow(id: string) {
  await prisma.workflow.update({
    where: { id },
    data: {
      status: WorkflowStatus.pending,
      nextRetryAt: null,
      lockExpiresAt: null,
      lockedBy: null,
      completedAt: null,
      errorMessage: null,
      lastErrorCode: null,
    },
  });
  await appendEvent(id, "warn", "Workflow manually re-queued");
}

export async function listPendingWorkflows(limit = 10) {
  return prisma.workflow.findMany({
    where: {
      OR: [
        { status: WorkflowStatus.pending },
        {
          status: WorkflowStatus.failed,
          nextRetryAt: { lte: new Date() },
        },
      ],
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: limit,
    include: { steps: { orderBy: { createdAt: "asc" } } },
  });
}

export async function updateStep(workflowId: string, name: string, status: WorkflowStatus, errorDetail?: string) {
  const step = await prisma.workflowStep.findFirst({ where: { workflowId, name } });
  if (!step) return;
  await prisma.workflowStep.update({
    where: { id: step.id },
    data: {
      status,
      attempt: step.attempt + (status === WorkflowStatus.running ? 1 : 0),
      startedAt: status === WorkflowStatus.running ? new Date() : step.startedAt,
      finishedAt: status === WorkflowStatus.succeeded || status === WorkflowStatus.failed ? new Date() : null,
      errorDetail: errorDetail || null,
    },
  });
}

export async function markWorkflowRunning(id: string, workerId = `worker-${process.pid}`) {
  const current = await prisma.workflow.findUniqueOrThrow({ where: { id } });
  const now = new Date();
  await prisma.workflow.update({
    where: { id },
    data: {
      status: WorkflowStatus.running,
      startedAt: current.startedAt ?? now,
      completedAt: null,
      lockExpiresAt: new Date(now.getTime() + 5 * 60 * 1000),
      lockedBy: workerId,
    },
  });
  await appendEvent(id, "info", "Workflow execution started");
}

export async function markWorkflowSucceeded(id: string, result: JsonObj) {
  await prisma.workflow.update({
    where: { id },
    data: {
      status: WorkflowStatus.succeeded,
      resultJson: asJson(result),
      nextRetryAt: null,
      errorMessage: null,
      lastErrorCode: null,
      lockExpiresAt: null,
      lockedBy: null,
      completedAt: new Date(),
    },
  });
  await appendEvent(id, "info", "Workflow execution completed", result);
}

export async function markWorkflowFailed(id: string, reason: string) {
  const current = await prisma.workflow.findUniqueOrThrow({ where: { id } });
  const attempt = current.attemptCount + 1;
  const canRetry = attempt < current.maxAttempts;
  const retryDelaySec = Math.min(60, Math.pow(2, attempt));
  await prisma.workflow.update({
    where: { id },
    data: {
      status: canRetry ? WorkflowStatus.failed : WorkflowStatus.cancelled,
      errorMessage: reason,
      lastErrorCode: deriveErrorCode(reason),
      attemptCount: attempt,
      nextRetryAt: canRetry ? new Date(Date.now() + retryDelaySec * 1000) : null,
      lockExpiresAt: null,
      lockedBy: null,
      completedAt: canRetry ? null : new Date(),
    },
  });
  await appendEvent(id, "error", "Workflow execution failed", {
    reason,
    attempt,
    retryDelaySec: canRetry ? retryDelaySec : null,
    canRetry,
    maxAttempts: current.maxAttempts,
  });
  logger.error({ workflowId: id, reason }, "workflow failed");
}
