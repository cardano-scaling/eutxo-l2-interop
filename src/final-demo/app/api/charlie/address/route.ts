import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { apiError } from "@/lib/api-error";
import { requireRole } from "@/lib/auth/role-guard";
import { credentialsPath } from "@/lib/runtime-paths";

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  const guard = requireRole(req, requestId, ["charlie", "admin"]);
  if (!guard.ok) return guard.response;

  try {
    const address = readFileSync(credentialsPath("charlie", "charlie-funds.addr"), "utf8").trim();
    if (!address) {
      return apiError(500, requestId, "CHARLIE_ADDRESS_EMPTY", "Charlie funds address file is empty");
    }
    return NextResponse.json({ requestId, address });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return apiError(500, requestId, "CHARLIE_ADDRESS_READ_FAILED", "Failed to read Charlie funds address", { message });
  }
}

