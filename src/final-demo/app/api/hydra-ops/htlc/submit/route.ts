import { NextResponse } from "next/server";
import { WorkflowStatus, WorkflowType } from "@prisma/client";
import { apiError, readJsonBody } from "@/lib/api-error";
import { submitBuyTicketDraft } from "@/lib/hydra/ops-buy-ticket";
import { submitBuyTicketSchema } from "@/lib/hydra/ops-types";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const bodyResult = await readJsonBody(req);
  if (!bodyResult.ok) {
    return apiError(400, requestId, "INVALID_JSON_BODY", "Request body must be valid JSON");
  }
  const parsed = submitBuyTicketSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return apiError(400, requestId, "REQUEST_VALIDATION_FAILED", "Submit payload validation failed", parsed.error.issues);
  }

  try {
    const submitted = await submitBuyTicketDraft(parsed.data);
    if (parsed.data.idempotencyKey) {
      const workflow = await prisma.workflow.findFirst({
        where: {
          type: WorkflowType.buy_ticket,
          idempotencyKey: parsed.data.idempotencyKey,
        },
      });
      if (workflow) {
        const existingPayload = JSON.parse(workflow.payloadJson || "{}") as Record<string, unknown>;
        const nextPreimage = parsed.data.preimage?.trim() || null;
        const needsPatch = (
          existingPayload.submittedSourceTxHash !== submitted.txHash
          || existingPayload.submittedSourceHtlcRef !== submitted.sourceHtlcRef
          || (nextPreimage != null && existingPayload.preimage !== nextPreimage)
        );
        if (needsPatch) {
          const patchedPayload = {
            ...existingPayload,
            submittedSourceTxHash: submitted.txHash,
            submittedSourceHtlcRef: submitted.sourceHtlcRef,
            preimage: nextPreimage ?? existingPayload.preimage ?? null,
          };
          await prisma.$transaction(async (tx) => {
            await tx.workflow.update({
              where: { id: workflow.id },
              data: workflow.status === WorkflowStatus.running
                ? { payloadJson: JSON.stringify(patchedPayload) }
                : {
                  payloadJson: JSON.stringify(patchedPayload),
                  status: WorkflowStatus.pending,
                  nextRetryAt: null,
                  lockExpiresAt: null,
                  lockedBy: null,
                  completedAt: null,
                  errorMessage: null,
                  lastErrorCode: null,
                },
            });
            if (workflow.status !== WorkflowStatus.running) {
              await tx.workflowStep.updateMany({
                where: {
                  workflowId: workflow.id,
                  name: { in: ["submit", "confirm"] },
                },
                data: {
                  status: WorkflowStatus.pending,
                  finishedAt: null,
                  errorDetail: null,
                },
              });
            }
            await tx.workflowEvent.create({
              data: {
                workflowId: workflow.id,
                level: "info",
                message: "buy_ticket submit persisted source artifacts",
                metaJson: JSON.stringify({
                  submittedSourceTxHash: submitted.txHash,
                  submittedSourceHtlcRef: submitted.sourceHtlcRef,
                  persistedPreimage: Boolean(nextPreimage),
                }),
              },
            });
          });
        }
      } else {
        logger.warn({ requestId, idempotencyKey: parsed.data.idempotencyKey }, "buy-ticket submit: workflow not found for idempotency key");
      }
    }
    return NextResponse.json({
      requestId,
      ...submitted,
    });
  } catch (error) {
    logger.error({ requestId, err: error }, "hydra buy-ticket submit failed");
    const detail = error instanceof Error ? error.message : "unknown error";
    return apiError(500, requestId, "HYDRA_OPS_SUBMIT_FAILED", `Failed to submit buy-ticket transaction: ${detail}`);
  }
}
