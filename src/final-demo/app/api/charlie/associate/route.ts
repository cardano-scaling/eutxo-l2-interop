import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role-guard";
import { syncHeadSnapshotsHeartbeat, upsertHeadState } from "@/lib/heads";
import { logger } from "@/lib/logger";

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const guard = requireRole(req, requestId, ["charlie", "admin"]);
  if (!guard.ok) return guard.response;

  try {
    await syncHeadSnapshotsHeartbeat();
    await upsertHeadState("headC", "connected", "Charlie hydra node associated to app");
    return NextResponse.json({
      requestId,
      ok: true,
      headName: "headC",
      status: "connected",
    });
  } catch (error) {
    logger.error({ requestId, err: error }, "charlie associate endpoint failed");
    return NextResponse.json(
      {
        requestId,
        ok: false,
        errorCode: "CHARLIE_ASSOCIATE_FAILED",
        message: "Failed to associate Charlie hydra node",
      },
      { status: 500 },
    );
  }
}

