import { NextResponse } from "next/server";
import { retryWorkflowNow } from "@/lib/workflows";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parsedBody = (await req.json().catch(() => ({}))) as {
      force?: boolean;
      reason?: string;
    };
    const force = parsedBody.force === true;
    const reason = typeof parsedBody.reason === "string" ? parsedBody.reason.slice(0, 300) : undefined;
    await retryWorkflowNow(id, { force, reason });
    return NextResponse.json({ ok: true, workflowId: id, force });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "WORKFLOW_NOT_FOUND") {
      return NextResponse.json({ error: "WORKFLOW_NOT_FOUND" }, { status: 404 });
    }
    if (message.startsWith("WORKFLOW_RETRY_CONFLICT")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message }, { status: 500 });
  }
}
