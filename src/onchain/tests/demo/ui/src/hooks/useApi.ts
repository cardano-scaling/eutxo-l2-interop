import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DemoSnapshot } from "@/lib/types";

const BASE = ""; // proxied by vite to localhost:3001

async function fetchStatus(): Promise<DemoSnapshot> {
  const res = await fetch(`${BASE}/api/status`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/**
 * Polls /api/status every 5s so the UI stays in sync with head state.
 * If the backend goes down, react-query will surface the error and
 * keep retrying — the UI can show a "disconnected" banner.
 */
export function useApi() {
  const queryClient = useQueryClient();
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    data: snapshot,
    isError: pollError,
    error: pollErrorObj,
  } = useQuery<DemoSnapshot>({
    queryKey: ["status"],
    queryFn: fetchStatus,
    // Poll faster (1s) while an action is in progress, otherwise 5s
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.busy ? 1_000 : 5_000;
    },
    refetchOnWindowFocus: true,
    retry: 2,
    staleTime: 500,
  });

  const fetchSnapshot = useCallback(() => {
    return queryClient.invalidateQueries({ queryKey: ["status"] });
  }, [queryClient]);

  const callAction = useCallback(async (action: string) => {
    // Cancel is fire-and-forget — don't touch loading state
    if (action === "cancel") {
      try {
        await fetch(`${BASE}/api/cancel`, { method: "POST" });
      } finally {
        queryClient.invalidateQueries({ queryKey: ["status"] });
      }
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Action failed");
      // Immediately update snapshot from response if provided
      if (data.snapshot) {
        queryClient.setQueryData(["status"], data.snapshot);
      }
      return data;
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      throw e;
    } finally {
      setActionLoading(false);
      // Also refetch to get latest state
      queryClient.invalidateQueries({ queryKey: ["status"] });
    }
  }, [queryClient]);

  // Combine action loading with poll errors
  const backendDown = pollError && !snapshot;
  const displayError = error || (backendDown ? `Backend unreachable: ${pollErrorObj?.message}` : null);

  return {
    snapshot: snapshot ?? null,
    loading: actionLoading,
    error: displayError,
    fetchSnapshot,
    callAction,
    backendDown: !!backendDown,
  };
}
