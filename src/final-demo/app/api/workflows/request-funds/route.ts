import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { WorkflowType } from "@prisma/client";
import { z } from "zod";
import { logger } from "@/lib/logger";
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
