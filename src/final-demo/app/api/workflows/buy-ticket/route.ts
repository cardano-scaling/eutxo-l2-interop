import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { WorkflowType } from "@prisma/client";
import { z } from "zod";
import { logger } from "@/lib/logger";
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
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    logger.warn({ requestId, issues: parsed.error.issues }, "buy-ticket validation failed");
    return NextResponse.json({ error: parsed.error.issues, requestId }, { status: 400 });
  }

  const amount = BigInt(parsed.data.amountLovelace);
  if (amount <= 0n || amount > MAX_AMOUNT_LOVELACE) {
    logger.warn({ requestId, amountLovelace: parsed.data.amountLovelace }, "buy-ticket invalid amount");
    return NextResponse.json(
      {
        error: "amountLovelace must be a positive numeric string within bounds",
        requestId,
      },
      { status: 400 },
    );
  }
  const desiredOutput = parsed.data.desiredOutput.trim();
  if (!desiredOutput) {
    logger.warn({ requestId }, "buy-ticket desired output missing");
    return NextResponse.json(
      {
        error: "desiredOutput is required",
        requestId,
      },
      { status: 400 },
    );
  }
  const timeoutMinutes = Number(parsed.data.timeoutMinutes);
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
    logger.warn({ requestId, timeoutMinutes: parsed.data.timeoutMinutes }, "buy-ticket invalid timeout");
    return NextResponse.json(
      {
        error: "timeoutMinutes must be a positive integer string",
        requestId,
      },
      { status: 400 },
    );
  }

  if (!validateBuyTicketActor(parsed.data.actor)) {
    logger.warn({ requestId, actor: parsed.data.actor }, "buy-ticket actor not allowed");
    return NextResponse.json(
      {
        errorCode: "BUY_TICKET_FORBIDDEN_ACTOR",
        message: "buy_ticket is only allowed for user and charlie wallets",
        requestId,
      },
      { status: 403 },
    );
  }

  const resolvedActor = resolveActorByAddress(parsed.data.address);
  if (!resolvedActor) {
    logger.warn({ requestId, address: parsed.data.address }, "buy-ticket unknown wallet address");
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
      "buy-ticket actor/address mismatch",
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

  const sourceHead = deriveSourceHead(parsed.data.actor);
  const requiredHeads = requiredHeadsForBuyTicket(parsed.data.actor);
  const closedHeads = await getClosedRequiredHeads(requiredHeads);
  if (closedHeads.length > 0) {
    logger.warn({ requestId, actor: parsed.data.actor, closedHeads }, "buy-ticket blocked by closed heads");
    return NextResponse.json(
      {
        errorCode: "HEADS_NOT_OPEN",
        message: "Required heads are not open",
        requiredHeads,
        closedHeads,
        requestId,
      },
      { status: 409 },
    );
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
