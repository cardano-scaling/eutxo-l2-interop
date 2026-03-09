import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { getWorkflow } from "@/lib/workflows";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const { id } = await params;
  const workflow = await getWorkflow(id);
  if (!workflow) {
    return apiError(404, requestId, "WORKFLOW_NOT_FOUND", "Workflow not found");
  }
  return NextResponse.json(workflow);
}
