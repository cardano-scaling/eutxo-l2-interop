import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { WorkflowType } from "@prisma/client";
import { z } from "zod";
import { logger } from "@/lib/logger";
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
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    logger.warn({ requestId, issues: parsed.error.issues }, "request-funds validation failed");
    return NextResponse.json({ error: parsed.error.issues, requestId }, { status: 400 });
  }

  const amount = BigInt(parsed.data.amountLovelace);
  if (amount <= 0n || amount > MAX_AMOUNT_LOVELACE) {
    logger.warn({ requestId, amountLovelace: parsed.data.amountLovelace }, "request-funds invalid amount");
    return NextResponse.json(
      {
        error: "amountLovelace must be a positive numeric string within bounds",
        requestId,
      },
      { status: 400 },
    );
  }

  if (!validateRequestFundsActor(parsed.data.actor)) {
    logger.warn({ requestId, actor: parsed.data.actor }, "request-funds actor not allowed");
    return NextResponse.json(
      {
        errorCode: "REQUEST_FUNDS_FORBIDDEN_ACTOR",
        message: "request_funds is only allowed for user wallets",
        requestId,
      },
      { status: 403 },
    );
  }

  const resolvedActor = resolveActorByAddress(parsed.data.address);
  if (!resolvedActor) {
    logger.warn({ requestId, address: parsed.data.address }, "request-funds unknown wallet address");
    return NextResponse.json(
      {
        errorCode: "WALLET_ADDRESS_UNKNOWN",
        message: "address is not recognized by the demo wallet registry",
        requestId,
      },
      { status: 403 },
    );
  }
  if (resolvedActor !== parsed.data.actor) {
    logger.warn(
      { requestId, actor: parsed.data.actor, resolvedActor, address: parsed.data.address },
      "request-funds actor/address mismatch",
    );
    return NextResponse.json(
      {
        errorCode: "ACTOR_ADDRESS_MISMATCH",
        message: "actor does not match the connected wallet address",
        requestId,
      },
      { status: 403 },
    );
  }

  const closedHeads = await getClosedRequiredHeads(requiredHeadsForRequestFunds());
  if (closedHeads.length > 0) {
    logger.warn({ requestId, closedHeads }, "request-funds blocked by closed heads");
    return NextResponse.json(
      {
        errorCode: "HEADS_NOT_OPEN",
        message: "Required heads are not open",
        requiredHeads: requiredHeadsForRequestFunds(),
        closedHeads,
        requestId,
      },
      { status: 409 },
    );
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
      return NextResponse.json(
        {
          errorCode: "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH",
          message: "The idempotencyKey is already bound to a different request payload",
          requestId,
          workflowId: existing.id,
        },
        { status: 409 },
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
