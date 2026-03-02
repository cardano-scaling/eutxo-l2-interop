import { NextResponse } from "next/server";
import { getHeadsState } from "@/lib/heads";
import { logger } from "@/lib/logger";
import type { ApiErrorEnvelope } from "@/lib/types";

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const heads = await getHeadsState();
    logger.info({ requestId, updatedAt: heads.updatedAt, isStale: heads.isStale }, "state/heads read");
    return NextResponse.json(heads);
  } catch (error) {
    logger.error({ requestId, err: error }, "state/heads read failed");
    const body: ApiErrorEnvelope = {
      errorCode: "HEAD_STATE_READ_FAILED",
      message: "Failed to read head state",
      requestId,
    };
    return NextResponse.json(body, { status: 500 });
  }
}
