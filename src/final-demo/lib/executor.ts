import { WorkflowStatus, WorkflowType, type Workflow } from "@prisma/client";
import { markWorkflowFailed, markWorkflowSucceeded, setWorkflowDraftResult, updateStep, updateStepWithEvent } from "./workflows";
import { upsertHeadState } from "./heads";
import { RequestFundsError, requestFunds, type RequestFundsPayload } from "./services/request-funds";
import { TicketServiceError, buyTicket, type BuyTicketPayload } from "./services/ticket-service";

function fakeTxHash(prefix: string): string {
  const rand = crypto.randomUUID().replaceAll("-", "");
  return `${prefix}${rand}`.slice(0, 64);
}

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

async function executeRequestFundsStep(
  workflow: Workflow,
  name: "prepare" | "submit" | "confirm",
  attempt: number,
  run: () => Promise<void>,
) {
  // Keep step status and event stream aligned so timeline can be rebuilt from DB only.
  await updateStepWithEvent(workflow.id, name, WorkflowStatus.running, {
    level: "info",
    message: `Step ${name} started`,
    meta: { step: name, attempt },
  });
  try {
    await run();
    await updateStepWithEvent(workflow.id, name, WorkflowStatus.succeeded, {
      level: "info",
      message: `Step ${name} succeeded`,
      meta: { step: name, attempt },
    });
  } catch (error) {
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

async function executeBuyTicketStep(
  workflow: Workflow,
  name: "prepare" | "submit" | "confirm",
  attempt: number,
  run: () => Promise<void>,
) {
  await updateStepWithEvent(workflow.id, name, WorkflowStatus.running, {
    level: "info",
    message: `Step ${name} started`,
    meta: { step: name, attempt },
  });
  try {
    await run();
    await updateStepWithEvent(workflow.id, name, WorkflowStatus.succeeded, {
      level: "info",
      message: `Step ${name} succeeded`,
      meta: { step: name, attempt },
    });
  } catch (error) {
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

async function executeRequestFundsWorkflow(workflow: WorkflowWithSteps) {
  const payload = JSON.parse(workflow.payloadJson || "{}") as Partial<RequestFundsPayload>;
  const attempt = workflow.attemptCount + 1;

  // Fail fast on malformed payloads so these become terminal (non-retryable) errors.
  if (!hasSucceededStep(workflow, "prepare")) {
    await executeRequestFundsStep(workflow, "prepare", attempt, async () => {
      if (!payload.address || !payload.amountLovelace) {
        throw new RequestFundsError("REQUEST_FUNDS_INVALID_INPUT", "request_funds payload is incomplete", false);
      }
    });
  }

  let result: Record<string, unknown> = parseDraftResult(workflow) ?? {};
  if (!hasSucceededStep(workflow, "submit")) {
    await executeRequestFundsStep(workflow, "submit", attempt, async () => {
      const serviceResult = await requestFunds(
        {
          address: payload.address!,
          amountLovelace: payload.amountLovelace!,
        },
        {
          workflowId: workflow.id,
          correlationId: workflow.correlationId,
          attempt,
        },
      );
      result = { ...serviceResult };
      // Persist submit output before confirm, so retries can resume without replaying side effects.
      await setWorkflowDraftResult(workflow.id, result);
    });
  }

  if (!hasSucceededStep(workflow, "confirm")) {
    await executeRequestFundsStep(workflow, "confirm", attempt, async () => {
      await upsertHeadState("headA", "open", "Custodial funding workflow completed");
    });
  }

  await markWorkflowSucceeded(workflow.id, result);
}

async function executeBuyTicketWorkflow(workflow: WorkflowWithSteps) {
  const payload = JSON.parse(workflow.payloadJson || "{}") as Partial<BuyTicketPayload>;
  const attempt = workflow.attemptCount + 1;

  if (!hasSucceededStep(workflow, "prepare")) {
    await executeBuyTicketStep(workflow, "prepare", attempt, async () => {
      if (!payload.address || !payload.amountLovelace || !payload.placeholderAddress) {
        throw new TicketServiceError("BUY_TICKET_INVALID_INPUT", "buy_ticket payload is incomplete", false);
      }
    });
  }

  let result: Record<string, unknown> = parseDraftResult(workflow) ?? {};
  if (!hasSucceededStep(workflow, "submit")) {
    await executeBuyTicketStep(workflow, "submit", attempt, async () => {
      const serviceResult = await buyTicket(
        {
          address: payload.address!,
          amountLovelace: payload.amountLovelace!,
          placeholderAddress: payload.placeholderAddress!,
        },
        {
          workflowId: workflow.id,
          correlationId: workflow.correlationId,
          attempt,
        },
      );
      result = { ...serviceResult };
      await setWorkflowDraftResult(workflow.id, result);
    });
  }

  if (!hasSucceededStep(workflow, "confirm")) {
    await executeBuyTicketStep(workflow, "confirm", attempt, async () => {
      await upsertHeadState("headB", "open", "Mock ticket purchase accepted");
    });
  }

  await markWorkflowSucceeded(workflow.id, result);
}

export async function executeWorkflow(workflow: WorkflowWithSteps) {
  try {
    if (workflow.type === WorkflowType.request_funds) {
      // Request funds uses an explicit branch with richer error metadata and step events.
      await executeRequestFundsWorkflow(workflow);
      return;
    }
    if (workflow.type === WorkflowType.buy_ticket) {
      await executeBuyTicketWorkflow(workflow);
      return;
    }

    const payload = JSON.parse(workflow.payloadJson || "{}") as Record<string, unknown>;
    let result: Record<string, unknown> = {};
    await executeStep(workflow.id, "prepare");
    await executeStep(workflow.id, "submit");

    if (workflow.type === WorkflowType.charlie_interact) {
      await upsertHeadState("headC", "open", "Charlie interaction completed");
      result = { txHash: fakeTxHash("char"), head: "C", action: payload.action };
    }

    await executeStep(workflow.id, "confirm");
    await markWorkflowSucceeded(workflow.id, result);
  } catch (error) {
    const err = asWorkflowExecutionError(error);
    await markWorkflowFailed(workflow.id, err.message, { errorCode: err.errorCode, retryable: err.retryable });
  }
}
