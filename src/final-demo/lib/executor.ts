import { WorkflowStatus, WorkflowType, type Workflow } from "@prisma/client";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { logger } from "./logger";
import {
  appendEvent,
  markWorkflowDeferredLocked,
  markWorkflowFailedLocked,
  markWorkflowSucceededLocked,
  refreshWorkflowLock,
  setWorkflowDraftResultLocked,
  updateStep,
  updateStepWithEvent,
  WorkflowLockError,
} from "./workflows";
import { syncHeadSnapshotsHeartbeat, upsertHeadState } from "./heads";
import { RequestFundsError, requestFunds, type RequestFundsPayload } from "./services/request-funds";
import { TicketServiceError, buyTicket, type BuyTicketPayload } from "./services/ticket-service";
import {
  submitPayRandomLotteryWinnerOnHeadB,
  relayPayRandomLotteryWinnerOnHeadB,
  type PayRandomLotteryWinnerDraft,
} from "./hydra/ops-pay-random-winner";

type WorkflowExecutionError = {
  message: string;
  errorCode?: string;
  retryable?: boolean;
};

class WorkflowDeferredError extends Error {
  code: string;
  baseRetryDelaySec: number;
  stepName: "prepare" | "submit" | "confirm";
  constructor(
    message: string,
    code: string,
    baseRetryDelaySec: number,
    stepName: "prepare" | "submit" | "confirm",
  ) {
    super(message);
    this.name = "WorkflowDeferredError";
    this.code = code;
    this.baseRetryDelaySec = baseRetryDelaySec;
    this.stepName = stepName;
  }
}

function isDeferredPreconditionError(errorCode?: string): boolean {
  if (!errorCode) return false;
  return errorCode === "BUY_TICKET_REAL_ARTIFACTS_REQUIRED"
    || errorCode === "BUY_TICKET_TARGET_HTLC_NOT_FOUND"
    || errorCode === "BUY_TICKET_SOURCE_HTLC_NOT_FOUND"
    || errorCode === "BUY_TICKET_PREIMAGE_REQUIRED";
}

function asWorkflowExecutionError(error: unknown): WorkflowExecutionError {
  if (error instanceof HeadOperationExecutionError) {
    const detail = error.details ? ` ${JSON.stringify(error.details)}` : "";
    const message = `${error.message}${detail}`;
    const nonRetryable = message.includes("NoFuelUTXOFound")
      || message.includes("HEAD_C_COMMIT_PRECONDITION_FAILED");
    return { message, errorCode: error.code, retryable: !nonRetryable };
  }
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
    if (isDeferredPreconditionError(err.errorCode)) {
      await updateStepWithEvent(workflow.id, name, WorkflowStatus.pending, {
        level: "info",
        message: `Step ${name} waiting for prerequisites`,
        meta: {
          step: name,
          attempt,
          errorCode: err.errorCode ?? null,
          reason: err.message,
        },
      });
      // Keep retries lightweight for transient visibility races.
      throw new WorkflowDeferredError(
        err.message,
        err.errorCode ?? "WORKFLOW_WAITING_PREREQUISITES",
        2,
        name,
      );
    }
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
      await appendEvent(
        workflow.id,
        "info",
        serviceResult.headBAutomationAction === "reused"
          ? "head_b_automation_reused_existing_lock"
          : "head_b_automation_created_new_lock",
        {
          hashRef: serviceResult.hashRef,
          headBHtlcRef: serviceResult.headBHtlcRef,
          action: serviceResult.headBAutomationAction,
        },
      );
      await appendEvent(workflow.id, "info", "ida_lock", {
        action: serviceResult.headBAutomationAction,
        headBHtlcRef: serviceResult.headBHtlcRef,
      });
      await appendEvent(workflow.id, "info", "ida_claim_target", {
        action: serviceResult.headBClaimAction,
        txHash: serviceResult.headBClaimTxHash,
        pairDetected: serviceResult.pairDetected,
      });
      await appendEvent(workflow.id, "info", "ida_claim_source", {
        action: serviceResult.sourceClaimAction,
        txHash: serviceResult.sourceClaimTxHash,
        claimOrder: serviceResult.claimOrder,
      });
      await setWorkflowDraftResultLocked(workflow.id, result, workerId);
    });
  }

  if (!hasSucceededStep(workflow, "confirm")) {
    await executeWorkflowStep(workflow, "confirm", attempt, workerId, async () => {
      const sourceHead = payload.sourceHead!;
      await appendEvent(workflow.id, "info", "ida_claimed_both_htlcs", {
        sourceHead,
        hashRef: result.hashRef ?? payload.htlcHash ?? null,
        sourceHtlcRef: result.sourceHtlcRef ?? null,
        headBHtlcRef: result.headBHtlcRef ?? null,
        sourceClaimAction: result.sourceClaimAction ?? null,
        headBClaimAction: result.headBClaimAction ?? null,
        sourceClaimTxHash: result.sourceClaimTxHash ?? null,
        headBClaimTxHash: result.headBClaimTxHash ?? null,
      });
      result = {
        ...result,
        status: "confirmed_with_real_artifacts",
      };
      await setWorkflowDraftResultLocked(workflow.id, result, workerId);
      await upsertHeadState(sourceHead, "open", `HTLC created for buy ticket from ${sourceHead}`);
      await upsertHeadState(
        "headB",
        "open",
        `Buy ticket confirmed with sourceRef=${String(result.sourceHtlcRef ?? "n/a")}`,
      );
    });
  }

  await markWorkflowSucceededLocked(workflow.id, result, workerId);
}

async function executePayRandomWinnerWorkflow(workflow: WorkflowWithSteps, workerId: string) {
  const attempt = workflow.attemptCount + 1;
  let result: Record<string, unknown> = parseDraftResult(workflow) ?? {};

  if (!hasSucceededStep(workflow, "prepare")) {
    await executeWorkflowStep(workflow, "prepare", attempt, workerId, async () => {
      // No-op: payload is intentionally empty; workflow.resultJson is populated after submit.
    });
  }

  if (!hasSucceededStep(workflow, "submit")) {
    await executeWorkflowStep(workflow, "submit", attempt, workerId, async () => {
      const draft = await submitPayRandomLotteryWinnerOnHeadB();
      result = { ...draft };
      await appendEvent(workflow.id, "info", "pay_random_winner_submitted", {
        hashRef: draft.hashRef,
        ticketCandidates: draft.ticketCandidates,
        txHash: draft.txHash,
      });
      await setWorkflowDraftResultLocked(workflow.id, result, workerId);
    });
  }

  if (!hasSucceededStep(workflow, "confirm")) {
    await executeWorkflowStep(workflow, "confirm", attempt, workerId, async () => {
      const draft = parseDraftResult(workflow) as PayRandomLotteryWinnerDraft | null;
      if (!draft?.hashRef) {
        throw new Error("pay_random_winner confirm missing draft result");
      }
      const finalResult = await relayPayRandomLotteryWinnerOnHeadB(draft);
      result = { ...finalResult };
      await appendEvent(workflow.id, "info", "pay_random_winner_relay_completed", {
        hashRef: finalResult.hashRef,
        targetHead: finalResult.targetHead,
        targetClaimTxHash: finalResult.targetClaimTxHash,
        sourceClaimTxHash: finalResult.sourceClaimTxHash,
      });
      await setWorkflowDraftResultLocked(workflow.id, result, workerId);
    });
  }

  await markWorkflowSucceededLocked(workflow.id, result, workerId);
}

type HeadOperation =
  | "open_head_a"
  | "open_head_b"
  | "open_heads_ab"
  | "commit_head_c_charlie"
  | "commit_head_c_admin";

class HeadOperationExecutionError extends Error {
  code: string;
  details?: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "HeadOperationExecutionError";
    this.code = code;
    this.details = details;
  }
}

function parseHeadOperation(raw: unknown): HeadOperation {
  if (
    raw === "open_head_a"
    || raw === "open_head_b"
    || raw === "open_heads_ab"
    || raw === "commit_head_c_charlie"
    || raw === "commit_head_c_admin"
  ) {
    return raw;
  }
  throw new Error("ADMIN_HEAD_OPERATION_INVALID");
}

function commandForHeadOperation(operation: HeadOperation): string[] {
  const args = ["scripts/hydra-open-heads.ts"];
  if (operation === "open_head_a") return [...args, "--open-head-a"];
  if (operation === "open_head_b") return [...args, "--open-head-b"];
  if (operation === "commit_head_c_admin") return [...args, "--commit-head-c-admin"];
  if (operation === "commit_head_c_charlie") return [...args, "--commit-head-c-charlie"];
  return args;
}

function resolveTsxExecutable(): string {
  const localTsx = join(process.cwd(), "node_modules", ".bin", "tsx");
  if (existsSync(localTsx)) return localTsx;
  return "tsx";
}

function tailForLogs(text: string, maxChars = 4000): string {
  if (text.length <= maxChars) return text;
  return text.slice(-maxChars);
}

function parseSubmittedTxHash(stdout: string): string | null {
  const matches = [...stdout.matchAll(/submitted -> ([0-9a-fA-F]{64})/g)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1];
  return last?.[1] ?? null;
}

async function runHeadOperation(operation: HeadOperation, timeoutMs = 8 * 60 * 1000): Promise<{ stdout: string; stderr: string }> {
  const args = commandForHeadOperation(operation);
  const tsxBin = resolveTsxExecutable();
  return new Promise((resolve, reject) => {
    const child = spawn(tsxBin, args, { cwd: process.cwd(), env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new HeadOperationExecutionError(
        "ADMIN_HEAD_OPERATION_TIMEOUT",
        `Head operation timed out after ${timeoutMs}ms`,
        { operation, timeoutMs },
      ));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new HeadOperationExecutionError(
        "ADMIN_HEAD_OPERATION_SPAWN_FAILED",
        error instanceof Error ? error.message : String(error),
        { operation },
      ));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const combined = `${stderr}\n${stdout}`.trim();
        reject(new HeadOperationExecutionError(
          "ADMIN_HEAD_OPERATION_SCRIPT_FAILED",
          `Head operation script failed with exit code ${String(code)}`,
          {
            operation,
            exitCode: code,
            outputTail: tailForLogs(combined),
          },
        ));
      }
    });
  });
}

async function executeAdminHeadOperationWorkflow(workflow: WorkflowWithSteps, workerId: string) {
  const payload = JSON.parse(workflow.payloadJson || "{}") as { operation?: unknown };
  const attempt = workflow.attemptCount + 1;
  const operation = parseHeadOperation(payload.operation);
  const operationTimeoutMs = Math.max(60_000, Number(process.env.HEAD_OPERATION_TIMEOUT_MS || 12 * 60 * 1000));

  if (!hasSucceededStep(workflow, "prepare")) {
    await executeWorkflowStep(workflow, "prepare", attempt, workerId, async () => {
      await appendEvent(workflow.id, "info", "admin_head_operation_validated", { operation });
    });
  }

  let result: Record<string, unknown> = parseDraftResult(workflow) ?? {};
  if (!hasSucceededStep(workflow, "submit")) {
    await executeWorkflowStep(workflow, "submit", attempt, workerId, async () => {
      const isHeadCOperation = operation === "commit_head_c_charlie" || operation === "commit_head_c_admin";
      if (isHeadCOperation) {
        await appendEvent(workflow.id, "info", "head_c_commit_script_started", {
          operation,
          actor: workflow.actor,
        });
      }
      const run = await runHeadOperation(operation, operationTimeoutMs);
      const stdout = run.stdout ?? "";
      const submittedTxHash = parseSubmittedTxHash(stdout);
      const headCOpened = isHeadCOperation && stdout.includes("Head C is now open.");
      result = {
        operation,
        stdout: run.stdout,
        stderr: run.stderr,
      };
      await setWorkflowDraftResultLocked(workflow.id, result, workerId);
      await appendEvent(workflow.id, "info", "admin_head_operation_submitted", { operation });
      if (isHeadCOperation) {
        await appendEvent(workflow.id, "info", "head_c_l1_utxos_refreshed_startup", {
          operation,
          actor: workflow.actor,
          observed: stdout.includes("[l1-utxos] Refreshing from live chain (startup)"),
        });
        if (stdout.includes("commit tx signed")) {
          await appendEvent(workflow.id, "info", "head_c_commit_tx_signed", {
            operation,
            actor: workflow.actor,
          });
        }
        await appendEvent(workflow.id, "info", "head_c_partial_commit_submitted", {
          operation,
          actor: workflow.actor,
        });
        if (submittedTxHash) {
          await appendEvent(workflow.id, "info", "head_c_commit_tx_submitted", {
            operation,
            actor: workflow.actor,
            txHash: submittedTxHash,
          });
        }
        await appendEvent(
          workflow.id,
          "info",
          headCOpened ? "head_c_open_completed" : "head_c_waiting_counterpart",
          {
            operation,
            actor: workflow.actor,
          },
        );
      }
    });
  }

  if (!hasSucceededStep(workflow, "confirm")) {
    await executeWorkflowStep(workflow, "confirm", attempt, workerId, async () => {
      // Pull fresh status from Hydra right after operation so UI reflects
      // transitions (e.g. connected -> open) without waiting for next heartbeat.
      await syncHeadSnapshotsHeartbeat();
      await appendEvent(workflow.id, "info", "admin_head_operation_confirmed", { operation });
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
    if (workflow.type === WorkflowType.admin_head_operation) {
      await executeAdminHeadOperationWorkflow(workflow, workerId);
      return;
    }
    if (workflow.type === WorkflowType.pay_random_winner) {
      await executePayRandomWinnerWorkflow(workflow, workerId);
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
    if (error instanceof WorkflowDeferredError) {
      try {
        await markWorkflowDeferredLocked(workflow.id, error.message, workerId, {
          errorCode: error.code,
          baseRetryDelaySec: error.baseRetryDelaySec,
          stepName: error.stepName,
        });
      } catch (deferErr) {
        if (deferErr instanceof WorkflowLockError) {
          logger.warn({ workflowId: workflow.id, workerId }, "workflow lock lost before defer write; skipping");
          return;
        }
        throw deferErr;
      }
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
