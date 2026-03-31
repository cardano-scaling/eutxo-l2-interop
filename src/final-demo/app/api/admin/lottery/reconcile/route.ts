import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, readJsonBody } from "@/lib/api-error";
import { requireRole } from "@/lib/auth/role-guard";
import { registerActiveLotteryForHead } from "@/lib/lottery-instances";
import { logger } from "@/lib/logger";

const schema = z.object({
  headName: z.literal("headB"),
  policyId: z.string().regex(/^[0-9a-fA-F]{56}$/),
  tokenNameHex: z.string().regex(/^[0-9a-fA-F]+$/),
  mintTxHash: z.string().regex(/^[0-9a-fA-F]+$/),
  contractAddress: z.string().min(8),
});

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const guard = requireRole(req, requestId, ["admin"]);
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(req);
  if (!body.ok) {
    return apiError(400, requestId, "INVALID_JSON_BODY", "Request body must be valid JSON");
  }

  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    return apiError(
      400,
      requestId,
      "REQUEST_VALIDATION_FAILED",
      "Lottery reconcile payload validation failed",
      parsed.error.issues,
    );
  }

  try {
    const active = await registerActiveLotteryForHead({
      headName: parsed.data.headName,
      policyId: parsed.data.policyId.toLowerCase(),
      tokenNameHex: parsed.data.tokenNameHex.toLowerCase(),
      mintTxHash: parsed.data.mintTxHash.toLowerCase(),
      contractAddress: parsed.data.contractAddress.trim(),
    });
    return NextResponse.json({
      requestId,
      ok: true,
      active,
      reconciledAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ requestId, err: error }, "lottery reconcile registration failed");
    const message = error instanceof Error ? error.message : "Failed to reconcile lottery registration";
    return apiError(500, requestId, "ADMIN_LOTTERY_RECONCILE_FAILED", message);
  }
}

