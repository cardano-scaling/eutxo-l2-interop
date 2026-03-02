import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST() {
  const pendingWorkflows = await prisma.workflow.count({
    where: { status: "pending" },
  });
  return NextResponse.json({
    ok: true,
    pendingWorkflows,
    reconciledAt: new Date().toISOString(),
  });
}
