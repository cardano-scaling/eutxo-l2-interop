import { WorkflowStatus, WorkflowType, type Workflow } from "@prisma/client";
import { markWorkflowFailed, markWorkflowRunning, markWorkflowSucceeded, updateStep } from "./workflows";
import { upsertHeadState } from "./heads";

function fakeTxHash(prefix: string): string {
  const rand = crypto.randomUUID().replaceAll("-", "");
  return `${prefix}${rand}`.slice(0, 64);
}

async function executeStep(workflowId: string, name: string) {
  await updateStep(workflowId, name, WorkflowStatus.running);
  await new Promise((r) => setTimeout(r, 250));
  await updateStep(workflowId, name, WorkflowStatus.succeeded);
}

export async function executeWorkflow(workflow: Workflow) {
  try {
    await markWorkflowRunning(workflow.id);
    await executeStep(workflow.id, "prepare");
    await executeStep(workflow.id, "submit");

    const payload = JSON.parse(workflow.payloadJson || "{}") as Record<string, unknown>;
    let result: Record<string, unknown> = {};

    if (workflow.type === WorkflowType.request_funds) {
      await upsertHeadState("headA", "open", "Custodial funds workflow completed");
      result = { txHash: fakeTxHash("fund"), head: "A", amountLovelace: payload.amountLovelace };
    } else if (workflow.type === WorkflowType.buy_ticket) {
      await upsertHeadState("headB", "open", "Mock ticket purchase accepted");
      result = { txHash: fakeTxHash("tick"), head: "B", placeholderAddress: payload.placeholderAddress };
    } else if (workflow.type === WorkflowType.charlie_interact) {
      await upsertHeadState("headC", "open", "Charlie interaction completed");
      result = { txHash: fakeTxHash("char"), head: "C", action: payload.action };
    }

    await executeStep(workflow.id, "confirm");
    await markWorkflowSucceeded(workflow.id, result);
  } catch (error) {
    await markWorkflowFailed(workflow.id, error instanceof Error ? error.message : String(error));
  }
}
