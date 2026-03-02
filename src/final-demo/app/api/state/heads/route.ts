import { NextResponse } from "next/server";
import { getHeadsState } from "@/lib/heads";

export async function GET() {
  const heads = await getHeadsState();
  return NextResponse.json(heads);
}
