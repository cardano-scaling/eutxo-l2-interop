import { NextResponse } from "next/server";

function isPasswordConfigured(value: string | undefined): boolean {
  return Boolean((value ?? "").trim());
}

export async function GET() {
  const requestId = crypto.randomUUID();
  return NextResponse.json({
    requestId,
    adminPasswordRequired: isPasswordConfigured(process.env.FINAL_DEMO_ADMIN_PASSWORD),
    charliePasswordRequired: isPasswordConfigured(process.env.FINAL_DEMO_CHARLIE_PASSWORD),
  });
}

