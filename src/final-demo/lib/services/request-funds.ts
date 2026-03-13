import { fetchHydraSnapshot, isRealHydraMode } from "@/lib/hydra-client";

export interface RequestFundsPayload {
  address: string;
  amountLovelace: string;
  submittedTxHash: string;
}

export interface RequestFundsContext {
  workflowId: string;
  correlationId: string;
  attempt: number;
}

export interface RequestFundsResult {
  txHash: string;
  head: "A";
  amountLovelace: string;
}

type FailureMode = "none" | "retryable_once" | "retryable_always" | "non_retryable";
const REQUEST_FUNDS_FIXED_LOVELACE = "5000000";

export class RequestFundsError extends Error {
  code: string;
  retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "RequestFundsError";
    this.code = code;
    this.retryable = retryable;
  }
}

function mockTxHash(prefix: string): string {
  const rand = crypto.randomUUID().replaceAll("-", "");
  return `${prefix}${rand}`.slice(0, 64);
}

function getFailureMode(): FailureMode {
  const mode = process.env.REQUEST_FUNDS_MOCK_FAILURE_MODE;
  if (mode === "retryable_once" || mode === "retryable_always" || mode === "non_retryable") {
    return mode;
  }
  return "none";
}

function validatePayload(payload: RequestFundsPayload) {
  const amount = BigInt(payload.amountLovelace);
  if (amount <= 0n) {
    throw new RequestFundsError("REQUEST_FUNDS_INVALID_INPUT", "amountLovelace must be positive", false);
  }
}

function maybeFail(ctx: RequestFundsContext) {
  const mode = getFailureMode();
  if (mode === "retryable_always") {
    throw new RequestFundsError("REQUEST_FUNDS_UNAVAILABLE", "Request funds provider temporarily unavailable", true);
  }
  if (mode === "retryable_once" && ctx.attempt <= 1) {
    throw new RequestFundsError("REQUEST_FUNDS_RETRYABLE", "Temporary issue while preparing request funds", true);
  }
  if (mode === "non_retryable") {
    throw new RequestFundsError("REQUEST_FUNDS_INVALID_INPUT", "Request funds rejected by policy", false);
  }
}

export async function requestFunds(payload: RequestFundsPayload, ctx: RequestFundsContext): Promise<RequestFundsResult> {
  validatePayload(payload);
  if (!isRealHydraMode()) {
    maybeFail(ctx);
    await new Promise(resolve => setTimeout(resolve, 5000));

    return {
      txHash: mockTxHash("fund"),
      head: "A",
      amountLovelace: REQUEST_FUNDS_FIXED_LOVELACE,
    };
  }

  const probe = await fetchHydraSnapshot("headA");
  if (!probe.ok) {
    throw new RequestFundsError(
      "REQUEST_FUNDS_HYDRA_UNAVAILABLE",
      `Head A is not reachable: ${probe.reason}`,
      true,
    );
  }

  try {
    return {
      txHash: payload.submittedTxHash,
      head: "A",
      amountLovelace: REQUEST_FUNDS_FIXED_LOVELACE,
    };
  } catch (error) {
    if (error instanceof RequestFundsError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new RequestFundsError("REQUEST_FUNDS_SUBMIT_FAILED", message, true);
  }
}
