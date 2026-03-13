import { NextResponse } from "next/server";
import { apiError, readJsonBody } from "@/lib/api-error";
import { submitBuyTicketDraft } from "@/lib/hydra/ops-buy-ticket";
import { submitBuyTicketSchema } from "@/lib/hydra/ops-types";
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
    return NextResponse.json({
      requestId,
      ...submitted,
    });
  } catch (error) {
    logger.error({ requestId, err: error }, "hydra buy-ticket submit failed");
    return apiError(500, requestId, "HYDRA_OPS_SUBMIT_FAILED", "Failed to submit buy-ticket transaction");
  }
}
