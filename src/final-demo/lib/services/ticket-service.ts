export interface BuyTicketPayload {
  address: string;
  amountLovelace: string;
  placeholderAddress: string;
}

export interface BuyTicketContext {
  workflowId: string;
  correlationId: string;
  attempt: number;
}

export interface BuyTicketResult {
  txHash: string;
  head: "B";
  placeholderAddress: string;
  amountLovelace: string;
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

function mockTxHash(prefix: string): string {
  const rand = crypto.randomUUID().replaceAll("-", "");
  return `${prefix}${rand}`.slice(0, 64);
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
  if (!payload.placeholderAddress.trim()) {
    throw new TicketServiceError("BUY_TICKET_INVALID_INPUT", "placeholderAddress is required", false);
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
  maybeFail(ctx);

  return {
    txHash: mockTxHash("tick"),
    head: "B",
    placeholderAddress: payload.placeholderAddress,
    amountLovelace: payload.amountLovelace,
  };
}
