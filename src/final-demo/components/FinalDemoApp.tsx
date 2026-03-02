"use client";

import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";

interface HeadReadModel {
  status: string;
  detail: string;
  updatedAt: string;
  ageMs: number;
  isStale: boolean;
}

interface HeadsResponse {
  headA: HeadReadModel;
  headB: HeadReadModel;
  headC: HeadReadModel;
  updatedAt: string;
  ageMs: number;
  isStale: boolean;
  staleThresholdMs: number;
}

interface ApiErrorEnvelope {
  errorCode: string;
  message: string;
  requestId: string;
}

interface WorkflowResponse {
  id: string;
  status: string;
  steps: Array<{ id: string; name: string; status: string; attempt: number }>;
  events: Array<{ id: string; level: string; message: string }>;
}

async function fetchHeads(): Promise<HeadsResponse> {
  const r = await fetch("/api/state/heads", { cache: "no-store" });
  if (!r.ok) {
    try {
      const err = await r.json() as ApiErrorEnvelope;
      throw new Error(`${err.message} (${err.errorCode}) [${err.requestId}]`);
    } catch {
      throw new Error(await r.text());
    }
  }
  return r.json();
}

async function createWorkflow(path: string, body: Record<string, unknown>) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<{ workflowId: string }>;
}

async function fetchWorkflow(id: string): Promise<WorkflowResponse> {
  const r = await fetch(`/api/workflows/${id}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function retryWorkflow(id: string) {
  const r = await fetch(`/api/admin/workflows/${id}/retry`, { method: "POST" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function FinalDemoInner() {
  const [wallet, setWallet] = useState("addr_test1_demo_wallet");
  const [amount, setAmount] = useState("5000000");
  const [placeholderAddress, setPlaceholderAddress] = useState("addr_test1_placeholder_ticket");
  const [workflowId, setWorkflowId] = useState("");

  const heads = useQuery({
    queryKey: ["heads"],
    queryFn: fetchHeads,
    retry: 2,
    // Keep polling aligned with backend staleness semantics.
    refetchInterval: (q) => {
      const thresholdMs = q.state.data?.staleThresholdMs ?? 60_000;
      return Math.max(1000, Math.floor(thresholdMs / 2));
    },
    refetchIntervalInBackground: true,
  });

  const workflow = useQuery({
    queryKey: ["workflow", workflowId],
    queryFn: () => fetchWorkflow(workflowId),
    enabled: Boolean(workflowId),
    refetchInterval: (q) => (q.state.data?.status === "running" || q.state.data?.status === "pending" ? 1500 : false),
  });

  const connect = useMutation({
    mutationFn: () => fetch("/api/state/heads/mock-connect", { method: "POST" }).then((r) => r.json()),
    onSuccess: () => heads.refetch(),
  });

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const requestFunds = useMutation({
    mutationFn: () =>
      createWorkflow("/api/workflows/request-funds", {
        actor: "user",
        idempotencyKey: crypto.randomUUID(),
        wallet,
        amountLovelace: amount,
      }),
    onSuccess: (d) => setWorkflowId(d.workflowId),
  });

  const buyTicket = useMutation({
    mutationFn: () =>
      createWorkflow("/api/workflows/buy-ticket", {
        actor: "user",
        idempotencyKey: crypto.randomUUID(),
        wallet,
        amountLovelace: amount,
        placeholderAddress,
      }),
    onSuccess: (d) => setWorkflowId(d.workflowId),
  });

  const charlie = useMutation({
    mutationFn: () =>
      createWorkflow("/api/workflows/charlie-interact", {
        actor: "charlie",
        idempotencyKey: crypto.randomUUID(),
        wallet,
        action: "init_head_c",
      }),
    onSuccess: (d) => setWorkflowId(d.workflowId),
  });

  const retry = useMutation({
    mutationFn: () => retryWorkflow(workflowId),
    onSuccess: () => workflow.refetch(),
  });

  const busy = useMemo(
    () => connect.isPending || requestFunds.isPending || buyTicket.isPending || charlie.isPending,
    [connect.isPending, requestFunds.isPending, buyTicket.isPending, charlie.isPending],
  );

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24, display: "grid", gap: 16 }}>
      <section style={cardStyle}>
        <h1 style={{ margin: 0 }}>eUTxO L2 Interop Final Demo</h1>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Head State</h2>
        {heads.isLoading ? <p>Loading head state...</p> : null}
        {heads.isError ? (
          <div style={{ display: "grid", gap: 8 }}>
            <p style={{ color: "#b91c1c", margin: 0 }}>Failed to load head state: {heads.error.message}</p>
            <div>
              <Button variant="outline" onClick={() => heads.refetch()}>Retry Head State</Button>
            </div>
          </div>
        ) : null}
        {heads.data ? (
          <>
            <p
              style={{
                marginTop: 0,
                color: (nowMs - new Date(heads.data.updatedAt).getTime()) > heads.data.staleThresholdMs ? "#b45309" : "#52525b",
              }}
            >
              Last update: {new Date(heads.data.updatedAt).toLocaleString()} ({Math.floor(Math.max(0, nowMs - new Date(heads.data.updatedAt).getTime()) / 1000)}s ago)
              {" · "}
              {(nowMs - new Date(heads.data.updatedAt).getTime()) > heads.data.staleThresholdMs ? "STALE" : "FRESH"}
            </p>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
              <HeadCard title="Head A" head={heads.data.headA} nowMs={nowMs} staleThresholdMs={heads.data.staleThresholdMs} />
              <HeadCard title="Head B" head={heads.data.headB} nowMs={nowMs} staleThresholdMs={heads.data.staleThresholdMs} />
              <HeadCard title="Head C" head={heads.data.headC} nowMs={nowMs} staleThresholdMs={heads.data.staleThresholdMs} />
            </div>
          </>
        ) : null}
        <div style={{ marginTop: 12 }}>
          <Button onClick={() => connect.mutate()} disabled={busy}>
            Mock Connect Heads
          </Button>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Actions</h2>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <label style={labelStyle}>
            Wallet
            <input style={inputStyle} value={wallet} onChange={(e) => setWallet(e.target.value)} />
          </label>
          <label style={labelStyle}>
            Amount (lovelace)
            <input style={inputStyle} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label style={labelStyle}>
            Placeholder Address
            <input style={inputStyle} value={placeholderAddress} onChange={(e) => setPlaceholderAddress(e.target.value)} />
          </label>
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button onClick={() => requestFunds.mutate()} disabled={busy}>Request Funds</Button>
          <Button onClick={() => buyTicket.mutate()} disabled={busy}>Buy Ticket (Mock)</Button>
          <Button onClick={() => charlie.mutate()} disabled={busy}>Charlie Interact</Button>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Workflow Timeline</h2>
        <p>Current workflow: {workflowId || "none"}</p>
        {workflow.data ? (
          <>
            <p>Status: <strong>{workflow.data.status}</strong></p>
            {workflow.data.status === "failed" ? (
              <Button variant="destructive" onClick={() => retry.mutate()}>Retry Workflow</Button>
            ) : null}
            <h3>Steps</h3>
            <ul>
              {workflow.data.steps.map((step) => (
                <li key={step.id}>{step.name} - {step.status} (attempt {step.attempt})</li>
              ))}
            </ul>
            <h3>Events</h3>
            <ul>
              {workflow.data.events.map((event) => (
                <li key={event.id}>[{event.level}] {event.message}</li>
              ))}
            </ul>
          </>
        ) : (
          <p>No workflow selected yet.</p>
        )}
      </section>
    </main>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: true, retry: 1 },
  },
});

export function FinalDemoApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <FinalDemoInner />
    </QueryClientProvider>
  );
}

function HeadCard(
  { title, head, nowMs, staleThresholdMs }: { title: string; head: HeadReadModel; nowMs: number; staleThresholdMs: number },
) {
  const ageMs = Math.max(0, nowMs - new Date(head.updatedAt).getTime());
  const isStale = ageMs > staleThresholdMs;
  return (
    <div style={{ border: "1px solid #e4e4e7", borderRadius: 8, padding: 10, background: "#fafafa" }}>
      <h3 style={{ margin: "0 0 6px 0" }}>{title}</h3>
      <p style={{ margin: "0 0 4px 0" }}>
        Status: {head.status} {isStale ? "· stale" : ""}
      </p>
      <p style={{ margin: "0 0 4px 0" }}>{head.detail || "-"}</p>
      <p style={{ margin: 0, color: "#71717a", fontSize: 12 }}>
        Updated: {new Date(head.updatedAt).toLocaleTimeString()} ({Math.floor(ageMs / 1000)}s ago)
      </p>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e4e4e7",
  borderRadius: 12,
  padding: 16,
};

const labelStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  fontSize: 14,
};

const inputStyle: React.CSSProperties = {
  border: "1px solid #d4d4d8",
  borderRadius: 8,
  padding: "8px 10px",
};
