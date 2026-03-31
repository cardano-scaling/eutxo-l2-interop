import { NextResponse } from "next/server";
import { apiError, readJsonBody } from "@/lib/api-error";
import { requireRole } from "@/lib/auth/role-guard";
import { retryWorkflowNow } from "@/lib/workflows";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const guard = requireRole(req, requestId, ["admin"]);
    if (!guard.ok) return guard.response;
    const { id } = await params;
    const bodyResult = await readJsonBody(req);
    const parsedBody = (bodyResult.ok ? bodyResult.data : {}) as {
      force?: boolean;
      reason?: string;
    };
    const force = parsedBody.force === true;
    const reason = typeof parsedBody.reason === "string" ? parsedBody.reason.slice(0, 300) : undefined;
    await retryWorkflowNow(id, { force, reason });
    return NextResponse.json({ ok: true, workflowId: id, force, requestId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "WORKFLOW_NOT_FOUND") {
      return apiError(404, requestId, "WORKFLOW_NOT_FOUND", "Workflow not found");
    }
    if (message.startsWith("WORKFLOW_RETRY_CONFLICT")) {
      return apiError(409, requestId, message, "Workflow retry conflict");
    }
    return apiError(500, requestId, "INTERNAL_ERROR", "Unexpected internal error", { reason: message });
  }
}
