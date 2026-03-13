import { NextResponse } from "next/server";
import { apiError, readJsonBody } from "@/lib/api-error";
import { logger } from "@/lib/logger";
import { prepareRequestFundsSchema } from "@/lib/hydra/ops-types";
import { prepareRequestFundsDraft } from "@/lib/hydra/ops-request-funds";

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const bodyResult = await readJsonBody(req);
  if (!bodyResult.ok) {
    return apiError(400, requestId, "INVALID_JSON_BODY", "Request body must be valid JSON");
  }
  const parsed = prepareRequestFundsSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return apiError(400, requestId, "REQUEST_VALIDATION_FAILED", "Prepare payload validation failed", parsed.error.issues);
  }

  try {
    const draft = await prepareRequestFundsDraft(parsed.data);
    return NextResponse.json({
      requestId,
      unsignedTxCborHex: draft.unsignedTxCborHex,
      txBodyHash: draft.txBodyHash,
      amountLovelace: draft.amountLovelace,
    });
  } catch (error) {
    logger.error({ requestId, err: error }, "hydra request-funds prepare failed");
    const detail = error instanceof Error ? error.message : "unknown error";
    return apiError(500, requestId, "HYDRA_REQUEST_FUNDS_PREPARE_FAILED", `Failed to prepare request-funds transaction: ${detail}`);
  }
}

