import { NextResponse } from "next/server";
import { getWorkflow } from "@/lib/workflows";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workflow = await getWorkflow(id);
  if (!workflow) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  return NextResponse.json(workflow);
}
