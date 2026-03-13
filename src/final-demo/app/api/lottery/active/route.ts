import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, readJsonBody } from "@/lib/api-error";
import {
  getActiveLotteryForHead,
  registerActiveLotteryForHead,
  type SupportedLotteryHead,
} from "@/lib/lottery-instances";
import { logger } from "@/lib/logger";

const registerSchema = z.object({
  headName: z.literal("headB"),
  policyId: z.string().regex(/^[0-9a-fA-F]{56}$/),
  tokenNameHex: z.string().regex(/^[0-9a-fA-F]+$/),
  mintTxHash: z.string().regex(/^[0-9a-fA-F]+$/),
  contractAddress: z.string().min(8),
});

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  const headName: SupportedLotteryHead = "headB";
  try {
    const active = await getActiveLotteryForHead(headName);
    return NextResponse.json({
      requestId,
      headName,
      active,
    });
  } catch (error) {
    logger.error({ requestId, err: error, headName }, "failed to fetch active lottery");
    return apiError(500, requestId, "LOTTERY_ACTIVE_FETCH_FAILED", "Failed to fetch active lottery");
  }
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const bodyResult = await readJsonBody(req);
  if (!bodyResult.ok) {
    return apiError(400, requestId, "INVALID_JSON_BODY", "Request body must be valid JSON");
  }
  const parsed = registerSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return apiError(400, requestId, "REQUEST_VALIDATION_FAILED", "Lottery register payload validation failed", parsed.error.issues);
  }

  try {
    const created = await registerActiveLotteryForHead({
      headName: parsed.data.headName,
      policyId: parsed.data.policyId.toLowerCase(),
      tokenNameHex: parsed.data.tokenNameHex.toLowerCase(),
      mintTxHash: parsed.data.mintTxHash.toLowerCase(),
      contractAddress: parsed.data.contractAddress.trim(),
    });
    return NextResponse.json({
      requestId,
      active: created,
    });
  } catch (error) {
    logger.error({ requestId, err: error }, "failed to register active lottery");
    return apiError(500, requestId, "LOTTERY_REGISTER_FAILED", "Failed to register active lottery");
  }
}

