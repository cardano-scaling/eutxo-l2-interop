import { NextResponse } from "next/server";

export function apiError(
  status: number,
  requestId: string,
  errorCode: string,
  message: string,
  details?: unknown,
) {
  return NextResponse.json(
    {
      errorCode,
      message,
      requestId,
      ...(details === undefined ? {} : { details }),
    },
    { status },
  );
}

export async function readJsonBody(req: Request): Promise<{ ok: true; data: unknown } | { ok: false }> {
  try {
    return { ok: true, data: await req.json() };
  } catch {
    return { ok: false };
  }
}
