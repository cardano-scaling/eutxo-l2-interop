import { fetchHydraSnapshot, isRealHydraMode } from "@/lib/hydra-client";

export interface BuyTicketPayload {
  address: string;
  amountLovelace: string;
  sourceHead: "headA" | "headC";
  desiredOutput: { address: string; datum?: string | null };
  htlcHash: string;
  timeoutMinutes: string;
  preimage?: string;
  submittedSourceTxHash?: string | null;
  submittedSourceHtlcRef?: string | null;
  submittedHeadBHtlcRef?: string | null;
}

export interface BuyTicketContext {
  workflowId: string;
  correlationId: string;
  attempt: number;
}

export interface BuyTicketResult {
  sourceHead: "headA" | "headC";
  hashRef: string;
  sourceHtlcRef: string;
  headBHtlcRef: string;
  desiredOutput: { address: string; datum?: string | null };
  amountLovelace: string;
  submittedSourceTxHash?: string | null;
}

type FailureMode = "none" | "retryable_once" | "retryable_always" | "non_retryable";

export class TicketServiceError extends Error {
  code: string;
  retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "TicketServiceError";
    this.code = code;
    this.retryable = retryable;
  }
}

function mockRef(prefix: string): string {
  const rand = crypto.randomUUID().replaceAll("-", "");
  return `${prefix}_${rand}`.slice(0, 64);
}

function getFailureMode(): FailureMode {
  const mode = process.env.BUY_TICKET_MOCK_FAILURE_MODE;
  if (mode === "retryable_once" || mode === "retryable_always" || mode === "non_retryable") {
    return mode;
  }
  return "none";
}

function validatePayload(payload: BuyTicketPayload) {
  const amount = BigInt(payload.amountLovelace);
  if (amount <= 0n) {
    throw new TicketServiceError("BUY_TICKET_INVALID_INPUT", "amountLovelace must be positive", false);
  }
  if (payload.sourceHead !== "headA" && payload.sourceHead !== "headC") {
    throw new TicketServiceError("BUY_TICKET_INVALID_INPUT", "sourceHead must be headA or headC", false);
  }
  if (!payload.desiredOutput?.address?.trim()) {
    throw new TicketServiceError("BUY_TICKET_INVALID_INPUT", "desiredOutput is required", false);
  }
  if (!/^[0-9a-fA-F]+$/.test(payload.htlcHash.trim())) {
    throw new TicketServiceError("BUY_TICKET_INVALID_INPUT", "htlcHash must be a hex string", false);
  }
  const timeoutMinutes = Number(payload.timeoutMinutes);
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
    throw new TicketServiceError("BUY_TICKET_INVALID_INPUT", "timeoutMinutes must be positive", false);
  }
}

function maybeFail(ctx: BuyTicketContext) {
  const mode = getFailureMode();
  if (mode === "retryable_always") {
    throw new TicketServiceError("BUY_TICKET_UNAVAILABLE", "Ticket service temporarily unavailable", true);
  }
  if (mode === "retryable_once" && ctx.attempt <= 1) {
    throw new TicketServiceError("BUY_TICKET_RETRYABLE", "Temporary issue while submitting buy ticket", true);
  }
  if (mode === "non_retryable") {
    throw new TicketServiceError("BUY_TICKET_INVALID_INPUT", "Buy ticket rejected by policy", false);
  }
}

export async function buyTicket(payload: BuyTicketPayload, ctx: BuyTicketContext): Promise<BuyTicketResult> {
  validatePayload(payload);
  if (!isRealHydraMode()) {
    maybeFail(ctx);
  }

  if (isRealHydraMode()) {
    const sourceHead = payload.sourceHead;
    const sourceProbe = await fetchHydraSnapshot(sourceHead);
    if (!sourceProbe.ok) {
      throw new TicketServiceError(
        "BUY_TICKET_SOURCE_HEAD_UNAVAILABLE",
        `${sourceHead} is not reachable: ${sourceProbe.reason}`,
        true,
      );
    }
    const headBProbe = await fetchHydraSnapshot("headB");
    if (!headBProbe.ok) {
      throw new TicketServiceError(
        "BUY_TICKET_HEAD_B_UNAVAILABLE",
        `headB is not reachable: ${headBProbe.reason}`,
        true,
      );
    }
  }

  const submittedSourceHtlcRef = payload.submittedSourceHtlcRef?.trim();
  const submittedHeadBHtlcRef = payload.submittedHeadBHtlcRef?.trim();
  if (submittedSourceHtlcRef && submittedHeadBHtlcRef) {
    return {
      sourceHead: payload.sourceHead,
      hashRef: payload.htlcHash.trim().toLowerCase(),
      sourceHtlcRef: submittedSourceHtlcRef,
      headBHtlcRef: submittedHeadBHtlcRef,
      desiredOutput: payload.desiredOutput,
      amountLovelace: payload.amountLovelace,
      submittedSourceTxHash: payload.submittedSourceTxHash ?? null,
    };
  }

  return {
    sourceHead: payload.sourceHead,
    hashRef: payload.htlcHash.trim().toLowerCase(),
    sourceHtlcRef: mockRef(payload.sourceHead === "headA" ? "htlc_a" : "htlc_c"),
    headBHtlcRef: mockRef("htlc_b"),
    desiredOutput: payload.desiredOutput,
    amountLovelace: payload.amountLovelace,
    submittedSourceTxHash: payload.submittedSourceTxHash ?? null,
  };
}
