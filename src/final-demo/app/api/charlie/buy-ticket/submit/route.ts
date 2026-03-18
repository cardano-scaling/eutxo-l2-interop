import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, readJsonBody } from "@/lib/api-error";
import { requireRole } from "@/lib/auth/role-guard";
import { submitBuyTicketForCharlie } from "@/lib/hydra/ops-buy-ticket";
import { logger } from "@/lib/logger";

const schema = z.object({
  htlcHash: z.string().regex(/^[0-9a-fA-F]+$/),
  timeoutMinutes: z.string().regex(/^\d+$/),
});

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const guard = requireRole(req, requestId, ["charlie", "admin"]);
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(req);
  if (!body.ok) {
    return apiError(400, requestId, "INVALID_JSON_BODY", "Request body must be valid JSON");
  }
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    return apiError(400, requestId, "REQUEST_VALIDATION_FAILED", "Charlie buy-ticket submit payload validation failed", parsed.error.issues);
  }

  try {
    const submitted = await submitBuyTicketForCharlie(parsed.data);
    return NextResponse.json({
      requestId,
      ...submitted,
    });
  } catch (error) {
    logger.error({ requestId, err: error }, "charlie buy-ticket submit failed");
    const detail = error instanceof Error ? error.message : "unknown error";
    return apiError(500, requestId, "CHARLIE_BUY_TICKET_SUBMIT_FAILED", `Failed to submit Charlie buy-ticket transaction: ${detail}`);
  }
}

