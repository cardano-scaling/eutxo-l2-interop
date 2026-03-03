import { WorkflowStatus, WorkflowType, type Workflow } from "@prisma/client";
import { appendEvent, markWorkflowFailed, markWorkflowRunning, markWorkflowSucceeded, updateStep } from "./workflows";
import { upsertHeadState } from "./heads";
import { RequestFundsError, requestFunds, type RequestFundsPayload } from "./services/request-funds";

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
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: String(error) };
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
  await updateStep(workflow.id, name, WorkflowStatus.running);
  await appendEvent(workflow.id, "info", `Step ${name} started`, { step: name, attempt });
  try {
    await run();
    await updateStep(workflow.id, name, WorkflowStatus.succeeded);
    await appendEvent(workflow.id, "info", `Step ${name} succeeded`, { step: name, attempt });
  } catch (error) {
    const err = asWorkflowExecutionError(error);
    await updateStep(workflow.id, name, WorkflowStatus.failed, err.message);
    await appendEvent(workflow.id, "error", `Step ${name} failed`, {
      step: name,
      attempt,
      errorCode: err.errorCode ?? null,
      retryable: err.retryable ?? null,
      reason: err.message,
    });
    throw error;
  }
}

async function executeRequestFundsWorkflow(workflow: Workflow) {
  const payload = JSON.parse(workflow.payloadJson || "{}") as Partial<RequestFundsPayload>;
  const attempt = workflow.attemptCount + 1;

  // Fail fast on malformed payloads so these become terminal (non-retryable) errors.
  await executeRequestFundsStep(workflow, "prepare", attempt, async () => {
    if (!payload.address || !payload.amountLovelace) {
      throw new RequestFundsError("REQUEST_FUNDS_INVALID_INPUT", "request_funds payload is incomplete", false);
    }
  });

  let result: Record<string, unknown> = {};
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
  });

  await executeRequestFundsStep(workflow, "confirm", attempt, async () => {
    await upsertHeadState("headA", "open", "Custodial funding workflow completed");
  });

  await markWorkflowSucceeded(workflow.id, result);
}

export async function executeWorkflow(workflow: Workflow) {
  try {
    await markWorkflowRunning(workflow.id);
    if (workflow.type === WorkflowType.request_funds) {
      // Request funds uses an explicit branch with richer error metadata and step events.
      await executeRequestFundsWorkflow(workflow);
      return;
    }

    const payload = JSON.parse(workflow.payloadJson || "{}") as Record<string, unknown>;
    let result: Record<string, unknown> = {};
    await executeStep(workflow.id, "prepare");
    await executeStep(workflow.id, "submit");

    if (workflow.type === WorkflowType.buy_ticket) {
      await upsertHeadState("headB", "open", "Mock ticket purchase accepted");
      result = { txHash: fakeTxHash("tick"), head: "B", placeholderAddress: payload.placeholderAddress };
    } else if (workflow.type === WorkflowType.charlie_interact) {
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
