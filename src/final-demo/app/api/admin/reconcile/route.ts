import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { reconcileBuyTicketClaims } from "@/lib/workflows";

export async function POST() {
  const buyTicket = await reconcileBuyTicketClaims(50);
  const pendingWorkflows = await prisma.workflow.count({
    where: { status: "pending" },
  });
  return NextResponse.json({
    ok: true,
    pendingWorkflows,
    buyTicket,
    reconciledAt: new Date().toISOString(),
  });
}
