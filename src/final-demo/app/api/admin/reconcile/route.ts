import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { reconcileBuyTicketClaims } from "@/lib/workflows";
import { requireRole } from "@/lib/auth/role-guard";

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const guard = requireRole(req, requestId, ["admin"]);
  if (!guard.ok) return guard.response;
  const buyTicket = await reconcileBuyTicketClaims(50);
  const pendingWorkflows = await prisma.workflow.count({
    where: { status: "pending" },
  });
  return NextResponse.json({
    requestId,
    ok: true,
    pendingWorkflows,
    buyTicket,
    reconciledAt: new Date().toISOString(),
  });
}
