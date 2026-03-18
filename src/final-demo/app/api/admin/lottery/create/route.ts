import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, readJsonBody } from "@/lib/api-error";
import { requireRole } from "@/lib/auth/role-guard";
import { logger } from "@/lib/logger";

const schema = z.object({
  prizeLovelace: z.string().regex(/^\d+$/),
  ticketCostLovelace: z.string().regex(/^\d+$/),
  closeTimestampMs: z.string().regex(/^\d+$/).optional(),
});

const resultSchema = z.object({
  onchain: z.object({
    txHash: z.string(),
    assetUnit: z.string(),
    policyId: z.string(),
    tokenNameHex: z.string(),
    contractAddress: z.string(),
    lotteryUtxoRef: z.string().nullable(),
  }),
  registration: z.object({
    ok: z.boolean(),
    attempts: z.number(),
    error: z.string().optional(),
    payload: z.object({
      headName: z.literal("headB"),
      policyId: z.string(),
      tokenNameHex: z.string(),
      mintTxHash: z.string(),
      contractAddress: z.string(),
    }),
  }),
});

function parseLotteryResult(stdout: string) {
  const marker = "LOTTERY_CREATE_RESULT_JSON:";
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.startsWith(marker)) continue;
    const raw = line.slice(marker.length);
    try {
      const json = JSON.parse(raw);
      const parsed = resultSchema.safeParse(json);
      if (parsed.success) return parsed.data;
    } catch {
      // noop: parsing error handled by fallback below
    }
  }
  return null;
}

async function runTsx(args: string[], timeoutMs = 3 * 60 * 1000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", "hydra:create-lottery-head-b", "--", ...args], {
      cwd: process.cwd(),
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`lottery create exited with code ${code}\n${stderr || stdout}`));
      }
    });
  });
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const guard = requireRole(req, requestId, ["admin"]);
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(req);
  if (!body.ok) {
    return apiError(400, requestId, "INVALID_JSON_BODY", "Request body must be valid JSON");
  }
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    return apiError(400, requestId, "REQUEST_VALIDATION_FAILED", "Lottery create payload validation failed", parsed.error.issues);
  }

  try {
    const args = [
      "--prize",
      parsed.data.prizeLovelace,
      "--ticket-cost",
      parsed.data.ticketCostLovelace,
    ];
    if (parsed.data.closeTimestampMs) {
      args.push("--close-timestamp", parsed.data.closeTimestampMs);
    }
    const result = await runTsx(args);
    const parsedResult = parseLotteryResult(result.stdout);
    if (!parsedResult) {
      return apiError(
        500,
        requestId,
        "ADMIN_LOTTERY_CREATE_RESULT_MISSING",
        "Lottery create did not return structured result payload",
        { stdout: result.stdout, stderr: result.stderr },
      );
    }
    return NextResponse.json({
      requestId,
      ok: true,
      registrationOk: parsedResult.registration.ok,
      needsReconcile: !parsedResult.registration.ok,
      result: parsedResult,
      stdout: result.stdout,
      stderr: result.stderr,
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ requestId, err: error }, "admin lottery create failed");
    const message = error instanceof Error ? error.message : "Unknown error";
    return apiError(500, requestId, "ADMIN_LOTTERY_CREATE_FAILED", "Failed to create lottery", { message });
  }
}

