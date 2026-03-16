import { apiError } from "@/lib/api-error";

export type FinalDemoRole = "user" | "charlie" | "admin";

const ROLE_HEADER = "x-final-demo-role";

function isRole(value: string): value is FinalDemoRole {
  return value === "user" || value === "charlie" || value === "admin";
}

export function readRequestRole(req: Request): FinalDemoRole | null {
  const raw = req.headers.get(ROLE_HEADER)?.trim().toLowerCase();
  if (!raw) return null;
  return isRole(raw) ? raw : null;
}

export function roleHeaders(role: FinalDemoRole): Record<string, string> {
  return { [ROLE_HEADER]: role };
}

export function requireRole(
  req: Request,
  requestId: string,
  allowed: FinalDemoRole[],
) {
  const role = readRequestRole(req);
  if (!role) {
    return {
      ok: false as const,
      response: apiError(401, requestId, "ROLE_REQUIRED", "Missing required role header"),
    };
  }
  if (!allowed.includes(role)) {
    return {
      ok: false as const,
      response: apiError(403, requestId, "ROLE_FORBIDDEN", "Role is not allowed for this operation", {
        allowed,
        got: role,
      }),
    };
  }
  return { ok: true as const, role };
}

