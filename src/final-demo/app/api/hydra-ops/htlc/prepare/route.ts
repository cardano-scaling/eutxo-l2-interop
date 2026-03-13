import { NextResponse } from "next/server";
import { apiError, readJsonBody } from "@/lib/api-error";
import { prepareBuyTicketDraft } from "@/lib/hydra/ops-buy-ticket";
import { prepareBuyTicketSchema } from "@/lib/hydra/ops-types";
import { logger } from "@/lib/logger";

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const bodyResult = await readJsonBody(req);
  if (!bodyResult.ok) {
    return apiError(400, requestId, "INVALID_JSON_BODY", "Request body must be valid JSON");
  }
  const parsed = prepareBuyTicketSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return apiError(400, requestId, "REQUEST_VALIDATION_FAILED", "Prepare payload validation failed", parsed.error.issues);
  }

  try {
    const draft = await prepareBuyTicketDraft(parsed.data);
    return NextResponse.json({
      requestId,
      draftId: draft.id,
      unsignedTxCborHex: draft.unsignedTxCborHex,
      txBodyHash: draft.txBodyHash,
      expiresAt: new Date(draft.expiresAtMs).toISOString(),
      summary: draft.summary,
    });
  } catch (error) {
    logger.error({ requestId, err: error }, "hydra buy-ticket prepare failed");
    const detail = error instanceof Error ? error.message : "unknown error";
    return apiError(500, requestId, "HYDRA_OPS_PREPARE_FAILED", `Failed to prepare buy-ticket transaction: ${detail}`);
  }
}
