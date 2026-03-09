import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { WorkflowType } from "@prisma/client";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { apiError, readJsonBody } from "@/lib/api-error";
import {
  deriveSourceHead,
  getClosedRequiredHeads,
  requiredHeadsForBuyTicket,
  resolveActorByAddress,
  validateBuyTicketActor,
} from "@/lib/interaction-policy";
import { createWorkflow, findWorkflowByIdempotency } from "@/lib/workflows";

const MAX_AMOUNT_LOVELACE = 10_000_000n;

const schema = z.object({
  actor: z.string().min(1),
  idempotencyKey: z.string().min(1),
  address: z.string().min(8),
  amountLovelace: z.string().regex(/^\d+$/),
  desiredOutput: z.string().min(8),
  htlcHash: z.string().regex(/^[0-9a-fA-F]+$/),
  timeoutMinutes: z.string().regex(/^\d+$/),
  preimage: z.string().optional(),
});

function buildBuyTicketHash(
  actor: string,
  address: string,
  amountLovelace: string,
  desiredOutput: string,
  htlcHash: string,
  timeoutMinutes: string,
  sourceHead: string,
): string {
  const normalized = JSON.stringify({
    actor: actor.trim().toLowerCase(),
    address: address.trim(),
    amountLovelace: amountLovelace.trim(),
    desiredOutput: desiredOutput.trim(),
    htlcHash: htlcHash.trim().toLowerCase(),
    timeoutMinutes: timeoutMinutes.trim(),
    sourceHead: sourceHead.trim().toLowerCase(),
  });
  return createHash("sha256").update(normalized).digest("hex");
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const bodyResult = await readJsonBody(req);
  if (!bodyResult.ok) {
    return apiError(400, requestId, "INVALID_JSON_BODY", "Request body must be valid JSON");
  }
  const body = bodyResult.data;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    logger.warn({ requestId, issues: parsed.error.issues }, "buy-ticket validation failed");
    return apiError(400, requestId, "REQUEST_VALIDATION_FAILED", "Request payload validation failed", parsed.error.issues);
  }

  const amount = BigInt(parsed.data.amountLovelace);
  if (amount <= 0n || amount > MAX_AMOUNT_LOVELACE) {
    logger.warn({ requestId, amountLovelace: parsed.data.amountLovelace }, "buy-ticket invalid amount");
    return apiError(
      400,
      requestId,
      "BUY_TICKET_INVALID_AMOUNT",
      "amountLovelace must be a positive numeric string within bounds",
    );
  }
  const desiredOutput = parsed.data.desiredOutput.trim();
  if (!desiredOutput) {
    logger.warn({ requestId }, "buy-ticket desired output missing");
    return apiError(400, requestId, "BUY_TICKET_MISSING_DESIRED_OUTPUT", "desiredOutput is required");
  }
  const timeoutMinutes = Number(parsed.data.timeoutMinutes);
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
    logger.warn({ requestId, timeoutMinutes: parsed.data.timeoutMinutes }, "buy-ticket invalid timeout");
    return apiError(400, requestId, "BUY_TICKET_INVALID_TIMEOUT", "timeoutMinutes must be a positive integer string");
  }

  if (!validateBuyTicketActor(parsed.data.actor)) {
    logger.warn({ requestId, actor: parsed.data.actor }, "buy-ticket actor not allowed");
    return apiError(
      403,
      requestId,
      "BUY_TICKET_FORBIDDEN_ACTOR",
      "buy_ticket is only allowed for user and charlie wallets",
    );
  }

  const resolvedActor = resolveActorByAddress(parsed.data.address);
  if (!resolvedActor) {
    logger.warn({ requestId, address: parsed.data.address }, "buy-ticket unknown wallet address");
    return apiError(403, requestId, "WALLET_ADDRESS_UNKNOWN", "address is not recognized by the demo wallet registry");
  }
  if (resolvedActor !== parsed.data.actor) {
    logger.warn(
      { requestId, actor: parsed.data.actor, resolvedActor, address: parsed.data.address },
      "buy-ticket actor/address mismatch",
    );
    return apiError(403, requestId, "ACTOR_ADDRESS_MISMATCH", "actor does not match the connected wallet address");
  }

  const sourceHead = deriveSourceHead(parsed.data.actor);
  const requiredHeads = requiredHeadsForBuyTicket(parsed.data.actor);
  const closedHeads = await getClosedRequiredHeads(requiredHeads);
  if (closedHeads.length > 0) {
    logger.warn({ requestId, actor: parsed.data.actor, closedHeads }, "buy-ticket blocked by closed heads");
    return apiError(409, requestId, "HEADS_NOT_OPEN", "Required heads are not open", { requiredHeads, closedHeads });
  }

  const requestHash = buildBuyTicketHash(
    parsed.data.actor,
    parsed.data.address,
    parsed.data.amountLovelace,
    desiredOutput,
    parsed.data.htlcHash,
    parsed.data.timeoutMinutes,
    sourceHead,
  );
  const existing = await findWorkflowByIdempotency(WorkflowType.buy_ticket, parsed.data.idempotencyKey);
  if (existing) {
    const existingPayload = JSON.parse(existing.payloadJson || "{}") as Record<string, unknown>;
    const existingHash = typeof existingPayload.requestHash === "string"
      ? existingPayload.requestHash
      : buildBuyTicketHash(
        existing.actor,
        String(existingPayload.address ?? ""),
        String(existingPayload.amountLovelace ?? ""),
        String(existingPayload.desiredOutput ?? ""),
        String(existingPayload.htlcHash ?? ""),
        String(existingPayload.timeoutMinutes ?? ""),
        String(existingPayload.sourceHead ?? deriveSourceHead(existing.actor as "user" | "charlie" | "ida")),
      );
    if (existingHash !== requestHash) {
      logger.warn(
        {
          requestId,
          workflowId: existing.id,
          idempotencyKey: parsed.data.idempotencyKey,
          existingHash,
          incomingHash: requestHash,
        },
        "buy-ticket idempotency key payload mismatch",
      );
      return apiError(
        409,
        requestId,
        "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH",
        "The idempotencyKey is already bound to a different request payload",
        { workflowId: existing.id },
      );
    }
  }

  const wf = existing ?? await createWorkflow(
    WorkflowType.buy_ticket,
    parsed.data.actor,
    parsed.data.idempotencyKey,
    {
      requestHash,
      address: parsed.data.address,
      amountLovelace: parsed.data.amountLovelace,
      desiredOutput,
      htlcHash: parsed.data.htlcHash.trim().toLowerCase(),
      timeoutMinutes: parsed.data.timeoutMinutes,
      preimage: parsed.data.preimage?.trim() || null,
      sourceHead,
    },
  );
  const idempotencyReplay = Boolean(existing);
  logger.info(
    {
      requestId,
      workflowId: wf.id,
      idempotencyKey: parsed.data.idempotencyKey,
      idempotencyReplay,
    },
    "buy-ticket workflow accepted",
  );
  return NextResponse.json(
    {
      requestId,
      workflowId: wf.id,
      status: wf.status,
      idempotencyKey: parsed.data.idempotencyKey,
      idempotencyReplay,
    },
    { status: 202 },
  );
}
