import { Prisma, WorkflowStatus, WorkflowType } from "@prisma/client";
import { prisma } from "./db";
import { logger } from "./logger";
import { recordClaims, recordFailureOutcome, recordManualRetry, recordStaleLockRecovery } from "./queue-metrics";

type JsonObj = Record<string, unknown>;
const WORKFLOW_LOCK_MS = Number(process.env.WORKFLOW_LOCK_MS || 5 * 60 * 1000);
// Over-fetch candidates because some rows can be lost to concurrent workers before claim.
const CLAIM_CANDIDATE_MULTIPLIER = 3;

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

type StepTransitionEvent = {
  level: "info" | "warn" | "error";
  message: string;
  meta?: JsonObj;
};

export async function updateStepWithEvent(
  workflowId: string,
  name: string,
  status: WorkflowStatus,
  event: StepTransitionEvent,
  errorDetail?: string,
) {
  await prisma.$transaction(async (tx) => {
    const step = await tx.workflowStep.findUnique({ where: { workflowId_name: { workflowId, name } } });
    if (!step) return;
    await tx.workflowStep.update({
      where: { id: step.id },
      data: {
        status,
        attempt: step.attempt + (status === WorkflowStatus.running ? 1 : 0),
        startedAt: status === WorkflowStatus.running ? new Date() : step.startedAt,
        finishedAt: status === WorkflowStatus.succeeded || status === WorkflowStatus.failed ? new Date() : null,
        errorDetail: errorDetail || null,
      },
    });
    await tx.workflowEvent.create({
      data: {
        workflowId,
        level: event.level,
        message: event.message,
        metaJson: event.meta ? asJson(event.meta) : null,
      },
    });
  });
}

export async function createWorkflow(type: WorkflowType, actor: string, idempotencyKey: string, payload: JsonObj) {
  // Idempotency is scoped by (type, idempotencyKey): create once, replay by lookup.
  const existing = await findWorkflowByIdempotency(type, idempotencyKey);
  if (existing) return existing;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const wf = await tx.workflow.create({
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
      });
      await tx.workflowEvent.create({
        data: {
          workflowId: wf.id,
          level: "info",
          message: "Workflow created",
          metaJson: asJson({ type, actor }),
        },
      });
      return wf.id;
    });
    return prisma.workflow.findUniqueOrThrow({
      where: { id: created },
      include: { steps: { orderBy: { createdAt: "asc" } }, events: { orderBy: { createdAt: "asc" } } },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }
    // Race-safe replay: if another request created it first, return that row.
    return prisma.workflow.findFirstOrThrow({
      where: { type, idempotencyKey },
      include: { steps: { orderBy: { createdAt: "asc" } }, events: { orderBy: { createdAt: "asc" } } },
    });
  }
}

export async function setWorkflowDraftResult(id: string, result: JsonObj) {
  await prisma.workflow.update({
    where: { id },
    data: { resultJson: asJson(result) },
  });
}

export class WorkflowLockError extends Error {
  code: string;
  constructor(message = "WORKFLOW_LOCK_OWNERSHIP_LOST") {
    super(message);
    this.name = "WorkflowLockError";
    this.code = "WORKFLOW_LOCK_OWNERSHIP_LOST";
  }
}

export async function refreshWorkflowLock(id: string, workerId: string) {
  const now = new Date();
  const count = await prisma.workflow.updateMany({
    where: {
      id,
      status: WorkflowStatus.running,
      lockedBy: workerId,
      lockExpiresAt: { gt: now },
    },
    data: { lockExpiresAt: new Date(now.getTime() + WORKFLOW_LOCK_MS) },
  });
  if (count.count !== 1) {
    throw new WorkflowLockError();
  }
}

export async function setWorkflowDraftResultLocked(id: string, result: JsonObj, workerId: string) {
  const count = await prisma.workflow.updateMany({
    where: { id, status: WorkflowStatus.running, lockedBy: workerId },
    data: { resultJson: asJson(result) },
  });
  if (count.count !== 1) {
    throw new WorkflowLockError();
  }
}

export async function claimDueWorkflows(limit = 10, workerId = `worker-${process.pid}`) {
  const now = new Date();
  const lockUntil = new Date(now.getTime() + WORKFLOW_LOCK_MS);
  const candidates = await prisma.workflow.findMany({
    where: {
      OR: [
        { status: WorkflowStatus.pending },
        { status: WorkflowStatus.failed, nextRetryAt: { lte: now } },
        { status: WorkflowStatus.running, lockExpiresAt: { lte: now } },
      ],
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: limit * CLAIM_CANDIDATE_MULTIPLIER,
  });

  const claimedIds: string[] = [];
  let staleRecoveryCount = 0;
  for (const wf of candidates) {
    const claimed = await prisma.workflow.updateMany({
      where: {
        id: wf.id,
        OR: [
          { status: WorkflowStatus.pending },
          { status: WorkflowStatus.failed, nextRetryAt: { lte: now } },
          { status: WorkflowStatus.running, lockExpiresAt: { lte: now } },
        ],
      },
      data: {
        status: WorkflowStatus.running,
        startedAt: wf.startedAt ?? now,
        completedAt: null,
        lockExpiresAt: lockUntil,
        lockedBy: workerId,
      },
    });
    if (claimed.count !== 1) continue;
    claimedIds.push(wf.id);
    if (wf.status === WorkflowStatus.running) {
      staleRecoveryCount += 1;
    }
    await appendEvent(wf.id, "info", "Workflow execution started");
    if (claimedIds.length >= limit) break;
  }

  recordClaims(claimedIds.length);
  recordStaleLockRecovery(staleRecoveryCount);

  if (claimedIds.length === 0) return [];
  const claimed = await prisma.workflow.findMany({
    where: { id: { in: claimedIds } },
    include: { steps: { orderBy: { createdAt: "asc" } }, events: { orderBy: { createdAt: "asc" } } },
  });
  const byId = new Map(claimed.map((wf) => [wf.id, wf]));
  return claimedIds.map((id) => byId.get(id)).filter((wf): wf is NonNullable<typeof wf> => Boolean(wf));
}

export async function getWorkflow(id: string) {
  return prisma.workflow.findUnique({
    where: { id },
    include: { steps: { orderBy: { createdAt: "asc" } }, events: { orderBy: { createdAt: "asc" } } },
  });
}

type RetryWorkflowOptions = {
  force?: boolean;
  reason?: string;
};

export async function retryWorkflowNow(id: string, options?: RetryWorkflowOptions) {
  const current = await prisma.workflow.findUnique({ where: { id } });
  if (!current) {
    throw new Error("WORKFLOW_NOT_FOUND");
  }
  const force = options?.force === true;
  if (!force && current.status === WorkflowStatus.running) {
    throw new Error("WORKFLOW_RETRY_CONFLICT_RUNNING");
  }
  if (!force && current.status === WorkflowStatus.succeeded) {
    throw new Error("WORKFLOW_RETRY_CONFLICT_SUCCEEDED");
  }
  if (
    !force &&
    current.status !== WorkflowStatus.failed &&
    current.status !== WorkflowStatus.cancelled
  ) {
    throw new Error("WORKFLOW_RETRY_CONFLICT_INVALID_STATUS");
  }

  const forceResetsSucceededWorkflow = force && current.status === WorkflowStatus.succeeded;
  if (forceResetsSucceededWorkflow) {
    await prisma.$transaction(async (tx) => {
      await tx.workflow.update({
        where: { id },
        data: {
          status: WorkflowStatus.pending,
          nextRetryAt: null,
          lockExpiresAt: null,
          lockedBy: null,
          completedAt: null,
          errorMessage: null,
          lastErrorCode: null,
          attemptCount: 0,
          resultJson: null,
        },
      });
      await tx.workflowStep.updateMany({
        where: { workflowId: id },
        data: {
          status: WorkflowStatus.pending,
          attempt: 0,
          startedAt: null,
          finishedAt: null,
          errorDetail: null,
        },
      });
    });
  } else {
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
  }

  await appendEvent(id, "warn", force ? "Workflow manually force re-queued" : "Workflow manually re-queued", {
    force,
    previousStatus: current.status,
    reason: options?.reason ?? null,
  });
  recordManualRetry(force);
}

export async function findWorkflowByIdempotency(type: WorkflowType, idempotencyKey: string) {
  return prisma.workflow.findFirst({
    where: { type, idempotencyKey },
    include: { steps: { orderBy: { createdAt: "asc" } }, events: { orderBy: { createdAt: "asc" } } },
  });
}

export async function updateStep(workflowId: string, name: string, status: WorkflowStatus, errorDetail?: string) {
  const step = await prisma.workflowStep.findUnique({ where: { workflowId_name: { workflowId, name } } });
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

export async function markWorkflowSucceededLocked(id: string, result: JsonObj, workerId: string) {
  const count = await prisma.workflow.updateMany({
    where: { id, status: WorkflowStatus.running, lockedBy: workerId },
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
  if (count.count !== 1) {
    throw new WorkflowLockError();
  }
  await appendEvent(id, "info", "Workflow execution completed", result);
}

type FailureOptions = {
  errorCode?: string;
  retryable?: boolean;
};

export async function markWorkflowFailed(id: string, reason: string, options?: FailureOptions) {
  const current = await prisma.workflow.findUniqueOrThrow({ where: { id } });
  const attempt = current.attemptCount + 1;
  const retryable = options?.retryable !== false;
  // Non-retryable errors bypass backoff and become terminal immediately.
  const canRetry = retryable && attempt < current.maxAttempts;
  const retryDelaySec = Math.min(60, Math.pow(2, attempt));
  const errorCode = options?.errorCode ?? deriveErrorCode(reason);
  await prisma.workflow.update({
    where: { id },
    data: {
      status: canRetry ? WorkflowStatus.failed : WorkflowStatus.cancelled,
      errorMessage: reason,
      lastErrorCode: errorCode,
      attemptCount: attempt,
      nextRetryAt: canRetry ? new Date(Date.now() + retryDelaySec * 1000) : null,
      lockExpiresAt: null,
      lockedBy: null,
      completedAt: canRetry ? null : new Date(),
    },
  });
  await appendEvent(id, "error", "Workflow execution failed", {
    reason,
    errorCode,
    attempt,
    retryDelaySec: canRetry ? retryDelaySec : null,
    canRetry,
    retryable,
    maxAttempts: current.maxAttempts,
  });
  recordFailureOutcome(canRetry);
  logger.error({ workflowId: id, reason, errorCode, retryable, canRetry }, "workflow failed");
}

export async function markWorkflowFailedLocked(
  id: string,
  reason: string,
  workerId: string,
  options?: FailureOptions,
) {
  const current = await prisma.workflow.findFirst({
    where: { id, status: WorkflowStatus.running, lockedBy: workerId },
  });
  if (!current) {
    throw new WorkflowLockError();
  }
  const attempt = current.attemptCount + 1;
  const retryable = options?.retryable !== false;
  const canRetry = retryable && attempt < current.maxAttempts;
  const retryDelaySec = Math.min(60, Math.pow(2, attempt));
  const errorCode = options?.errorCode ?? deriveErrorCode(reason);

  const count = await prisma.workflow.updateMany({
    where: { id, status: WorkflowStatus.running, lockedBy: workerId },
    data: {
      status: canRetry ? WorkflowStatus.failed : WorkflowStatus.cancelled,
      errorMessage: reason,
      lastErrorCode: errorCode,
      attemptCount: attempt,
      nextRetryAt: canRetry ? new Date(Date.now() + retryDelaySec * 1000) : null,
      lockExpiresAt: null,
      lockedBy: null,
      completedAt: canRetry ? null : new Date(),
    },
  });
  if (count.count !== 1) {
    throw new WorkflowLockError();
  }
  await appendEvent(id, "error", "Workflow execution failed", {
    reason,
    errorCode,
    attempt,
    retryDelaySec: canRetry ? retryDelaySec : null,
    canRetry,
    retryable,
    maxAttempts: current.maxAttempts,
  });
  recordFailureOutcome(canRetry);
  logger.error({ workflowId: id, reason, errorCode, retryable, canRetry }, "workflow failed");
}

export async function getQueueHealthSnapshot() {
  const now = new Date();
  const [pending, running, failed, cancelled, succeeded, readyToClaim, staleRunning] = await Promise.all([
    prisma.workflow.count({ where: { status: WorkflowStatus.pending } }),
    prisma.workflow.count({ where: { status: WorkflowStatus.running } }),
    prisma.workflow.count({ where: { status: WorkflowStatus.failed } }),
    prisma.workflow.count({ where: { status: WorkflowStatus.cancelled } }),
    prisma.workflow.count({ where: { status: WorkflowStatus.succeeded } }),
    prisma.workflow.count({
      where: {
        OR: [
          { status: WorkflowStatus.pending },
          { status: WorkflowStatus.failed, nextRetryAt: { lte: now } },
          { status: WorkflowStatus.running, lockExpiresAt: { lte: now } },
        ],
      },
    }),
    prisma.workflow.count({ where: { status: WorkflowStatus.running, lockExpiresAt: { lte: now } } }),
  ]);

  return {
    pending,
    running,
    failed,
    cancelled,
    succeeded,
    readyToClaim,
    staleRunning,
  };
}
