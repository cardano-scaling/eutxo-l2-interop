import { NextResponse } from "next/server";
import { apiError, readJsonBody } from "@/lib/api-error";
import { logger } from "@/lib/logger";
import { submitRequestFundsSchema } from "@/lib/hydra/ops-types";
import { submitRequestFundsDraft } from "@/lib/hydra/ops-request-funds";

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const bodyResult = await readJsonBody(req);
  if (!bodyResult.ok) {
    return apiError(400, requestId, "INVALID_JSON_BODY", "Request body must be valid JSON");
  }
  const parsed = submitRequestFundsSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return apiError(400, requestId, "REQUEST_VALIDATION_FAILED", "Submit payload validation failed", parsed.error.issues);
  }

  try {
    const submitted = await submitRequestFundsDraft(parsed.data);
    return NextResponse.json({
      requestId,
      ...submitted,
    });
  } catch (error) {
    logger.error({ requestId, err: error }, "hydra request-funds submit failed");
    const detail = error instanceof Error ? error.message : "unknown error";
    return apiError(500, requestId, "HYDRA_REQUEST_FUNDS_SUBMIT_FAILED", `Failed to submit request-funds transaction: ${detail}`);
  }
}

