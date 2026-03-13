import { WorkflowStatus, WorkflowType, type Workflow } from "@prisma/client";
import { logger } from "./logger";
import {
  appendEvent,
  markWorkflowFailedLocked,
  markWorkflowSucceededLocked,
  refreshWorkflowLock,
  setWorkflowDraftResultLocked,
  updateStep,
  updateStepWithEvent,
  WorkflowLockError,
} from "./workflows";
import { upsertHeadState } from "./heads";
import { RequestFundsError, requestFunds, type RequestFundsPayload } from "./services/request-funds";
import { TicketServiceError, buyTicket, type BuyTicketPayload } from "./services/ticket-service";

type WorkflowExecutionError = {
  message: string;
  errorCode?: string;
  retryable?: boolean;
};

function asWorkflowExecutionError(error: unknown): WorkflowExecutionError {
  if (error instanceof RequestFundsError) {
    return { message: error.message, errorCode: error.code, retryable: error.retryable };
  }
  if (error instanceof TicketServiceError) {
    return { message: error.message, errorCode: error.code, retryable: error.retryable };
  }
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: String(error) };
}

type WorkflowWithSteps = Workflow & {
  steps?: Array<{ name: string; status: WorkflowStatus }>;
};

function hasSucceededStep(workflow: WorkflowWithSteps, name: "prepare" | "submit" | "confirm"): boolean {
  return workflow.steps?.some((step) => step.name === name && step.status === WorkflowStatus.succeeded) ?? false;
}

function parseDraftResult(workflow: Workflow): Record<string, unknown> | null {
  if (!workflow.resultJson) return null;
  try {
    return JSON.parse(workflow.resultJson) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function executeStep(workflowId: string, name: string) {
  await updateStep(workflowId, name, WorkflowStatus.running);
  await new Promise((r) => setTimeout(r, 250));
  await updateStep(workflowId, name, WorkflowStatus.succeeded);
}

async function executeWorkflowStep(
  workflow: Workflow,
  name: "prepare" | "submit" | "confirm",
  attempt: number,
  workerId: string,
  run: () => Promise<void>,
) {
  await refreshWorkflowLock(workflow.id, workerId);
  // Keep step status and event stream aligned so timeline can be rebuilt from DB only.
  await updateStepWithEvent(workflow.id, name, WorkflowStatus.running, {
    level: "info",
    message: `Step ${name} started`,
    meta: { step: name, attempt },
  });
  try {
    await run();
    await refreshWorkflowLock(workflow.id, workerId);
    await updateStepWithEvent(workflow.id, name, WorkflowStatus.succeeded, {
      level: "info",
      message: `Step ${name} succeeded`,
      meta: { step: name, attempt },
    });
  } catch (error) {
    if (error instanceof WorkflowLockError) {
      throw error;
    }
    const err = asWorkflowExecutionError(error);
    await updateStepWithEvent(
      workflow.id,
      name,
      WorkflowStatus.failed,
      {
        level: "error",
        message: `Step ${name} failed`,
        meta: {
          step: name,
          attempt,
          errorCode: err.errorCode ?? null,
          retryable: err.retryable ?? null,
          reason: err.message,
        },
      },
      err.message,
    );
    throw error;
  }
}

async function executeRequestFundsWorkflow(workflow: WorkflowWithSteps, workerId: string) {
  const payload = JSON.parse(workflow.payloadJson || "{}") as Partial<RequestFundsPayload>;
  const attempt = workflow.attemptCount + 1;

  // Fail fast on malformed payloads so these become terminal (non-retryable) errors.
  if (!hasSucceededStep(workflow, "prepare")) {
    await executeWorkflowStep(workflow, "prepare", attempt, workerId, async () => {
      if (!payload.address || !payload.amountLovelace || !payload.submittedTxHash) {
        throw new RequestFundsError("REQUEST_FUNDS_INVALID_INPUT", "request_funds payload is incomplete", false);
      }
    });
  }

  let result: Record<string, unknown> = parseDraftResult(workflow) ?? {};
  if (!hasSucceededStep(workflow, "submit")) {
    await executeWorkflowStep(workflow, "submit", attempt, workerId, async () => {
      const serviceResult = await requestFunds(
        {
          address: payload.address!,
          amountLovelace: payload.amountLovelace!,
          submittedTxHash: payload.submittedTxHash!,
        },
        {
          workflowId: workflow.id,
          correlationId: workflow.correlationId,
          attempt,
        },
      );
      result = { ...serviceResult };
      // Persist submit output before confirm, so retries can resume without replaying side effects.
      await setWorkflowDraftResultLocked(workflow.id, result, workerId);
    });
  }

  if (!hasSucceededStep(workflow, "confirm")) {
    await executeWorkflowStep(workflow, "confirm", attempt, workerId, async () => {
      await upsertHeadState("headA", "open", "Custodial funding workflow completed");
    });
  }

  await markWorkflowSucceededLocked(workflow.id, result, workerId);
}

async function executeBuyTicketWorkflow(workflow: WorkflowWithSteps, workerId: string) {
  const payload = JSON.parse(workflow.payloadJson || "{}") as Partial<BuyTicketPayload>;
  const attempt = workflow.attemptCount + 1;

  if (!hasSucceededStep(workflow, "prepare")) {
    await executeWorkflowStep(workflow, "prepare", attempt, workerId, async () => {
      if (
        !payload.address ||
        !payload.amountLovelace ||
        !payload.desiredOutput ||
        !payload.sourceHead ||
        !payload.htlcHash ||
        !payload.timeoutMinutes
      ) {
        throw new TicketServiceError("BUY_TICKET_INVALID_INPUT", "buy_ticket payload is incomplete", false);
      }
    });
  }

  let result: Record<string, unknown> = parseDraftResult(workflow) ?? {};
  if (!hasSucceededStep(workflow, "submit")) {
    await executeWorkflowStep(workflow, "submit", attempt, workerId, async () => {
      const serviceResult = await buyTicket(
        {
          address: payload.address!,
          amountLovelace: payload.amountLovelace!,
          sourceHead: payload.sourceHead!,
          desiredOutput: payload.desiredOutput!,
          htlcHash: payload.htlcHash!,
          timeoutMinutes: payload.timeoutMinutes!,
          preimage: payload.preimage,
          submittedSourceTxHash: payload.submittedSourceTxHash,
          submittedSourceHtlcRef: payload.submittedSourceHtlcRef,
          submittedHeadBHtlcRef: payload.submittedHeadBHtlcRef,
        },
        {
          workflowId: workflow.id,
          correlationId: workflow.correlationId,
          attempt,
        },
      );
      result = { ...serviceResult };
      await appendEvent(workflow.id, "info", "htlc_source_locked", {
        sourceHead: serviceResult.sourceHead,
        hashRef: serviceResult.hashRef,
        sourceHtlcRef: serviceResult.sourceHtlcRef,
      });
      await appendEvent(workflow.id, "info", "htlc_head_b_locked", {
        hashRef: serviceResult.hashRef,
        headBHtlcRef: serviceResult.headBHtlcRef,
      });
      await setWorkflowDraftResultLocked(workflow.id, result, workerId);
    });
  }

  if (!hasSucceededStep(workflow, "confirm")) {
    await executeWorkflowStep(workflow, "confirm", attempt, workerId, async () => {
      const sourceHead = payload.sourceHead!;
      const ticketOutputRef = `ticket_out_b_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
      await appendEvent(workflow.id, "info", "ida_claimed_both_htlcs", {
        sourceHead,
        hashRef: result.hashRef ?? payload.htlcHash ?? null,
        sourceHtlcRef: result.sourceHtlcRef ?? null,
        headBHtlcRef: result.headBHtlcRef ?? null,
      });
      result = {
        ...result,
        ticketOutputRef,
        status: "ticket_output_created_head_b",
      };
      await setWorkflowDraftResultLocked(workflow.id, result, workerId);
      await upsertHeadState(sourceHead, "open", `HTLC created for buy ticket from ${sourceHead}`);
      await upsertHeadState("headB", "open", `Ticket output created: ${ticketOutputRef}`);
    });
  }

  await markWorkflowSucceededLocked(workflow.id, result, workerId);
}

export async function executeWorkflow(workflow: WorkflowWithSteps, workerId: string) {
  try {
    if (workflow.type === WorkflowType.request_funds) {
      // Request funds uses an explicit branch with richer error metadata and step events.
      await executeRequestFundsWorkflow(workflow, workerId);
      return;
    }
    if (workflow.type === WorkflowType.buy_ticket) {
      await executeBuyTicketWorkflow(workflow, workerId);
      return;
    }

    const payload = JSON.parse(workflow.payloadJson || "{}") as Record<string, unknown>;
    let result: Record<string, unknown> = {};
    await executeStep(workflow.id, "prepare");
    await executeStep(workflow.id, "submit");

    await executeStep(workflow.id, "confirm");
    await markWorkflowSucceededLocked(workflow.id, result, workerId);
  } catch (error) {
    if (error instanceof WorkflowLockError) {
      logger.warn({ workflowId: workflow.id, workerId }, "workflow lock lost during execution; aborting");
      return;
    }
    const err = asWorkflowExecutionError(error);
    try {
      await markWorkflowFailedLocked(workflow.id, err.message, workerId, {
        errorCode: err.errorCode,
        retryable: err.retryable,
      });
    } catch (markErr) {
      if (markErr instanceof WorkflowLockError) {
        logger.warn({ workflowId: workflow.id, workerId }, "workflow lock lost before failure write; skipping");
        return;
      }
      throw markErr;
    }
  }
}
