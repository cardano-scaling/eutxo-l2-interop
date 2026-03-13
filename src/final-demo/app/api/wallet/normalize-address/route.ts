import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, readJsonBody } from "@/lib/api-error";
import { hexAddressToBech32 } from "@/lib/hydra/ops-address";

const schema = z.object({
  address: z.string().min(1),
});

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const bodyResult = await readJsonBody(req);
  if (!bodyResult.ok) {
    return apiError(400, requestId, "INVALID_JSON_BODY", "Request body must be valid JSON");
  }
  const parsed = schema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return apiError(400, requestId, "REQUEST_VALIDATION_FAILED", "Address payload validation failed", parsed.error.issues);
  }

  const address = parsed.data.address.trim();
  if (address.startsWith("addr")) {
    return NextResponse.json({ requestId, address });
  }
  if (!/^[0-9a-fA-F]+$/.test(address)) {
    return apiError(400, requestId, "INVALID_ADDRESS", "Address must be bech32 or hex");
  }

  try {
    const bech32 = hexAddressToBech32(address);
    return NextResponse.json({ requestId, address: bech32 });
  } catch {
    return apiError(400, requestId, "INVALID_ADDRESS", "Address hex cannot be converted to bech32");
  }
}

