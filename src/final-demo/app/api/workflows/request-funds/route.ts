import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { WorkflowType } from "@prisma/client";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { apiError, readJsonBody } from "@/lib/api-error";
import {
  getClosedRequiredHeads,
  requiredHeadsForRequestFunds,
  resolveActorByAddress,
  validateRequestFundsActor,
} from "@/lib/interaction-policy";
import { createWorkflow, findWorkflowByIdempotency } from "@/lib/workflows";

const MAX_AMOUNT_LOVELACE = 10_000_000n;

const schema = z.object({
  actor: z.string().min(1),
  idempotencyKey: z.string().min(1),
  address: z.string().min(8),
  amountLovelace: z.string().regex(/^\d+$/),
});

function buildRequestFundsHash(actor: string, address: string, amountLovelace: string): string {
  const normalized = JSON.stringify({
    actor: actor.trim().toLowerCase(),
    address: address.trim(),
    amountLovelace: amountLovelace.trim(),
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
    logger.warn({ requestId, issues: parsed.error.issues }, "request-funds validation failed");
    return apiError(400, requestId, "REQUEST_VALIDATION_FAILED", "Request payload validation failed", parsed.error.issues);
  }

  const amount = BigInt(parsed.data.amountLovelace);
  if (amount <= 0n || amount > MAX_AMOUNT_LOVELACE) {
    logger.warn({ requestId, amountLovelace: parsed.data.amountLovelace }, "request-funds invalid amount");
    return apiError(
      400,
      requestId,
      "REQUEST_FUNDS_INVALID_AMOUNT",
      "amountLovelace must be a positive numeric string within bounds",
    );
  }

  if (!validateRequestFundsActor(parsed.data.actor)) {
    logger.warn({ requestId, actor: parsed.data.actor }, "request-funds actor not allowed");
    return apiError(403, requestId, "REQUEST_FUNDS_FORBIDDEN_ACTOR", "request_funds is only allowed for user wallets");
  }

  const resolvedActor = resolveActorByAddress(parsed.data.address);
  if (!resolvedActor) {
    logger.warn({ requestId, address: parsed.data.address }, "request-funds unknown wallet address");
    return apiError(403, requestId, "WALLET_ADDRESS_UNKNOWN", "address is not recognized by the demo wallet registry");
  }
  if (resolvedActor !== parsed.data.actor) {
    logger.warn(
      { requestId, actor: parsed.data.actor, resolvedActor, address: parsed.data.address },
      "request-funds actor/address mismatch",
    );
    return apiError(403, requestId, "ACTOR_ADDRESS_MISMATCH", "actor does not match the connected wallet address");
  }

  const closedHeads = await getClosedRequiredHeads(requiredHeadsForRequestFunds());
  if (closedHeads.length > 0) {
    logger.warn({ requestId, closedHeads }, "request-funds blocked by closed heads");
    return apiError(409, requestId, "HEADS_NOT_OPEN", "Required heads are not open", {
      requiredHeads: requiredHeadsForRequestFunds(),
      closedHeads,
    });
  }

  // idempotencyKey is the intent identifier. Retries reuse it; new intents rotate it.
  const idempotencyKey = parsed.data.idempotencyKey;
  const requestHash = buildRequestFundsHash(parsed.data.actor, parsed.data.address, parsed.data.amountLovelace);
  const existing = await findWorkflowByIdempotency(WorkflowType.request_funds, idempotencyKey);
  if (existing) {
    const existingPayload = JSON.parse(existing.payloadJson || "{}") as Record<string, unknown>;
    const existingHash = typeof existingPayload.requestHash === "string"
      ? existingPayload.requestHash
      : buildRequestFundsHash(
        existing.actor,
        String(existingPayload.address ?? ""),
        String(existingPayload.amountLovelace ?? ""),
      );

    if (existingHash !== requestHash) {
      logger.warn(
        {
          requestId,
          workflowId: existing.id,
          idempotencyKey,
          existingHash,
          incomingHash: requestHash,
        },
        "request-funds idempotency key payload mismatch",
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
    WorkflowType.request_funds,
    parsed.data.actor,
    idempotencyKey,
    {
      requestHash,
      address: parsed.data.address,
      amountLovelace: parsed.data.amountLovelace,
    },
  );
  const idempotencyReplay = Boolean(existing);
  logger.info(
    {
      requestId,
      workflowId: wf.id,
      idempotencyKey,
      idempotencyReplay,
    },
    "request-funds workflow accepted",
  );
  return NextResponse.json(
    {
      requestId,
      workflowId: wf.id,
      status: wf.status,
      idempotencyKey,
      idempotencyReplay,
    },
    { status: 202 },
  );
}
