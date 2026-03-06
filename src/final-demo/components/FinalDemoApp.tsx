"use client";

import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  connectWallet,
  disconnectWallet,
  ensureMockCip30WalletsInjected,
  getWalletOptions,
  restoreWalletSession,
  type WalletSession,
} from "@/lib/wallet/cip30";

type FinalDemoView = "user" | "charlie" | "all";

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
  type: "request_funds" | "buy_ticket";
  status: string;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  lastErrorCode: string | null;
  errorMessage: string | null;
  steps: Array<{ id: string; name: string; status: string; attempt: number }>;
  events: Array<{ id: string; level: string; message: string; createdAt: string }>;
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
  return r.json() as Promise<{ workflowId: string; idempotencyKey?: string }>;
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

function newBusinessId(): string {
  return `request_funds:${crypto.randomUUID()}`;
}
function newBuyTicketIntentId(): string {
  return `buy_ticket:${crypto.randomUUID()}`;
}

const REQUEST_FUNDS_INTENT_TTL_MS = 10 * 60 * 1000;
const REQUEST_FUNDS_INTENT_STORAGE_KEY = "final-demo.request-funds-intents.v1";
const BUY_TICKET_INTENT_STORAGE_KEY = "final-demo.buy-ticket-intents.v1";

type RequestFundsIntentRecord = {
  idempotencyKey: string;
  createdAtMs: number;
  workflowId?: string;
};

type RequestFundsIntentStore = Record<string, RequestFundsIntentRecord>;
type BuyTicketIntentStore = Record<string, RequestFundsIntentRecord>;

function requestFundsPayloadFingerprint(actor: string, address: string, amountLovelace: string): string {
  return JSON.stringify({
    actor: actor.trim().toLowerCase(),
    address: address.trim(),
    amountLovelace: amountLovelace.trim(),
  });
}

function loadRequestFundsIntentStore(nowMs: number): RequestFundsIntentStore {
  try {
    const raw = window.localStorage.getItem(REQUEST_FUNDS_INTENT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as RequestFundsIntentStore;
    const pruned: RequestFundsIntentStore = {};
    for (const [fingerprint, record] of Object.entries(parsed)) {
      if (nowMs - record.createdAtMs < REQUEST_FUNDS_INTENT_TTL_MS) {
        pruned[fingerprint] = record;
      }
    }
    return pruned;
  } catch {
    return {};
  }
}

function saveRequestFundsIntentStore(store: RequestFundsIntentStore) {
  window.localStorage.setItem(REQUEST_FUNDS_INTENT_STORAGE_KEY, JSON.stringify(store));
}

function getOrCreateRequestFundsIdempotencyKey(actor: string, address: string, amountLovelace: string) {
  const nowMs = Date.now();
  const fingerprint = requestFundsPayloadFingerprint(actor, address, amountLovelace);
  const store = loadRequestFundsIntentStore(nowMs);
  const existing = store[fingerprint];
  if (existing) {
    return { fingerprint, idempotencyKey: existing.idempotencyKey };
  }
  const idempotencyKey = `${actor}:${newBusinessId()}`;
  store[fingerprint] = { idempotencyKey, createdAtMs: nowMs };
  saveRequestFundsIntentStore(store);
  return { fingerprint, idempotencyKey };
}

function rotateRequestFundsIdempotencyKey(actor: string, address: string, amountLovelace: string) {
  const nowMs = Date.now();
  const fingerprint = requestFundsPayloadFingerprint(actor, address, amountLovelace);
  const store = loadRequestFundsIntentStore(nowMs);
  const idempotencyKey = `${actor}:${newBusinessId()}`;
  store[fingerprint] = { idempotencyKey, createdAtMs: nowMs };
  saveRequestFundsIntentStore(store);
  return idempotencyKey;
}

function bindRequestFundsIntentWorkflow(fingerprint: string, workflowId: string) {
  const store = loadRequestFundsIntentStore(Date.now());
  if (!store[fingerprint]) return;
  store[fingerprint] = { ...store[fingerprint], workflowId };
  saveRequestFundsIntentStore(store);
}

function clearRequestFundsIntentByWorkflowId(workflowId: string): boolean {
  const store = loadRequestFundsIntentStore(Date.now());
  let removed = false;
  const next: RequestFundsIntentStore = {};
  for (const [fingerprint, record] of Object.entries(store)) {
    if (record.workflowId === workflowId) {
      removed = true;
      continue;
    }
    next[fingerprint] = record;
  }
  if (removed) saveRequestFundsIntentStore(next);
  return removed;
}

function buyTicketPayloadFingerprint(
  actor: string,
  address: string,
  amountLovelace: string,
  desiredOutput: string,
): string {
  return JSON.stringify({
    actor: actor.trim().toLowerCase(),
    address: address.trim(),
    amountLovelace: amountLovelace.trim(),
    desiredOutput: desiredOutput.trim(),
  });
}

function loadBuyTicketIntentStore(nowMs: number): BuyTicketIntentStore {
  try {
    const raw = window.localStorage.getItem(BUY_TICKET_INTENT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as BuyTicketIntentStore;
    const pruned: BuyTicketIntentStore = {};
    for (const [fingerprint, record] of Object.entries(parsed)) {
      if (nowMs - record.createdAtMs < REQUEST_FUNDS_INTENT_TTL_MS) {
        pruned[fingerprint] = record;
      }
    }
    return pruned;
  } catch {
    return {};
  }
}

function saveBuyTicketIntentStore(store: BuyTicketIntentStore) {
  window.localStorage.setItem(BUY_TICKET_INTENT_STORAGE_KEY, JSON.stringify(store));
}

function getOrCreateBuyTicketIdempotencyKey(
  actor: string,
  address: string,
  amountLovelace: string,
  desiredOutput: string,
) {
  const nowMs = Date.now();
  const fingerprint = buyTicketPayloadFingerprint(actor, address, amountLovelace, desiredOutput);
  const store = loadBuyTicketIntentStore(nowMs);
  const existing = store[fingerprint];
  if (existing) {
    return { fingerprint, idempotencyKey: existing.idempotencyKey };
  }
  const idempotencyKey = `${actor}:${newBuyTicketIntentId()}`;
  store[fingerprint] = { idempotencyKey, createdAtMs: nowMs };
  saveBuyTicketIntentStore(store);
  return { fingerprint, idempotencyKey };
}

function rotateBuyTicketIdempotencyKey(
  actor: string,
  address: string,
  amountLovelace: string,
  desiredOutput: string,
) {
  const nowMs = Date.now();
  const fingerprint = buyTicketPayloadFingerprint(actor, address, amountLovelace, desiredOutput);
  const store = loadBuyTicketIntentStore(nowMs);
  const idempotencyKey = `${actor}:${newBuyTicketIntentId()}`;
  store[fingerprint] = { idempotencyKey, createdAtMs: nowMs };
  saveBuyTicketIntentStore(store);
  return idempotencyKey;
}

function bindBuyTicketIntentWorkflow(fingerprint: string, workflowId: string) {
  const store = loadBuyTicketIntentStore(Date.now());
  if (!store[fingerprint]) return;
  store[fingerprint] = { ...store[fingerprint], workflowId };
  saveBuyTicketIntentStore(store);
}

function clearBuyTicketIntentByWorkflowId(workflowId: string): boolean {
  const store = loadBuyTicketIntentStore(Date.now());
  let removed = false;
  const next: BuyTicketIntentStore = {};
  for (const [fingerprint, record] of Object.entries(store)) {
    if (record.workflowId === workflowId) {
      removed = true;
      continue;
    }
    next[fingerprint] = record;
  }
  if (removed) saveBuyTicketIntentStore(next);
  return removed;
}

function FinalDemoInner({ view }: { view: FinalDemoView }) {
  const walletOptions = useMemo(() => {
    const all = getWalletOptions();
    if (view === "all") return all;
    return all.filter((wallet) => wallet.actor === view);
  }, [view]);
  const [selectedWalletKey, setSelectedWalletKey] = useState(walletOptions[0]?.key ?? "");
  const [walletSession, setWalletSession] = useState<WalletSession | null>(null);
  const actionActor = walletSession?.actor ?? (view === "charlie" ? "charlie" : "user");
  const [address, setAddress] = useState("addr_test1_demo_wallet");
  const [amount, setAmount] = useState("5000000");
  const [requestFundsIdempotencyKey, setRequestFundsIdempotencyKey] = useState(() => newBusinessId());
  const [buyTicketIdempotencyKey, setBuyTicketIdempotencyKey] = useState(() => newBuyTicketIntentId());
  const [desiredOutput, setDesiredOutput] = useState("addr_test1_lottery_contract");
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
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return false;
      if (data.status === "running" || data.status === "pending") return 1500;
      if (data.status === "failed" && data.nextRetryAt) return 1500;
      return false;
    },
  });

  const connect = useMutation({
    mutationFn: () => fetch("/api/state/heads/mock-connect", { method: "POST" }).then((r) => r.json()),
    onSuccess: () => heads.refetch(),
  });
  const walletConnect = useMutation({
    mutationFn: () => connectWallet(selectedWalletKey),
    onSuccess: (session) => {
      setWalletSession(session);
      setAddress(session.changeAddress);
    },
  });

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    ensureMockCip30WalletsInjected();
    restoreWalletSession()
      .then((session) => {
        if (!session) return;
        if (view !== "all" && session.actor !== view) return;
        setWalletSession(session);
        setSelectedWalletKey(session.walletKey);
        setAddress(session.changeAddress);
      })
      .catch(() => {
        // Keep UI usable even if restore fails for mock wallet state.
      });
  }, [view]);
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const wf = search.get("workflowId");
    if (wf) setWorkflowId(wf);
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (workflowId) {
      url.searchParams.set("workflowId", workflowId);
    } else {
      url.searchParams.delete("workflowId");
    }
    window.history.replaceState(null, "", url);
  }, [workflowId]);
  useEffect(() => {
    const intent = getOrCreateRequestFundsIdempotencyKey(actionActor, address, amount);
    setRequestFundsIdempotencyKey(intent.idempotencyKey);
  }, [actionActor, address, amount]);
  useEffect(() => {
    const intent = getOrCreateBuyTicketIdempotencyKey(actionActor, address, amount, desiredOutput);
    setBuyTicketIdempotencyKey(intent.idempotencyKey);
  }, [actionActor, address, amount, desiredOutput]);

  const requestFunds = useMutation({
    mutationFn: () =>
      {
        const actor = actionActor;
        const intent = getOrCreateRequestFundsIdempotencyKey(actor, address, amount);
        return createWorkflow("/api/workflows/request-funds", {
          actor,
          idempotencyKey: intent.idempotencyKey,
          address,
          amountLovelace: amount,
        }).then((d) => ({ ...d, fingerprint: intent.fingerprint }));
      },
    onSuccess: (d) => {
      setWorkflowId(d.workflowId);
      bindRequestFundsIntentWorkflow(d.fingerprint, d.workflowId);
      if (d.idempotencyKey) setRequestFundsIdempotencyKey(d.idempotencyKey);
    },
  });

  const buyTicket = useMutation({
    mutationFn: () =>
      {
        const actor = actionActor;
        const intent = getOrCreateBuyTicketIdempotencyKey(actor, address, amount, desiredOutput);
        return createWorkflow("/api/workflows/buy-ticket", {
          actor,
          idempotencyKey: intent.idempotencyKey,
          address,
          amountLovelace: amount,
          desiredOutput,
        }).then((d) => ({ ...d, fingerprint: intent.fingerprint }));
      },
    onSuccess: (d) => {
      setWorkflowId(d.workflowId);
      bindBuyTicketIntentWorkflow(d.fingerprint, d.workflowId);
      if (d.idempotencyKey) setBuyTicketIdempotencyKey(d.idempotencyKey);
    },
  });

  const retry = useMutation({
    mutationFn: () => retryWorkflow(workflowId),
    onSuccess: () => workflow.refetch(),
  });

  useEffect(() => {
    const data = workflow.data;
    if (!data || data.type !== "request_funds") return;
    if (data.status !== "succeeded" && data.status !== "cancelled") return;
    if (clearRequestFundsIntentByWorkflowId(data.id)) {
      setRequestFundsIdempotencyKey(rotateRequestFundsIdempotencyKey(actionActor, address, amount));
    }
  }, [actionActor, address, amount, workflow.data]);
  useEffect(() => {
    const data = workflow.data;
    if (!data || data.type !== "buy_ticket") return;
    if (data.status !== "succeeded" && data.status !== "cancelled") return;
    if (clearBuyTicketIntentByWorkflowId(data.id)) {
      setBuyTicketIdempotencyKey(rotateBuyTicketIdempotencyKey(actionActor, address, amount, desiredOutput));
    }
  }, [actionActor, address, amount, desiredOutput, workflow.data]);

  const busy = useMemo(
    () => connect.isPending || walletConnect.isPending || requestFunds.isPending || buyTicket.isPending,
    [connect.isPending, walletConnect.isPending, requestFunds.isPending, buyTicket.isPending],
  );
  const headsOpen = {
    headA: heads.data?.headA.status === "open",
    headB: heads.data?.headB.status === "open",
    headC: heads.data?.headC.status === "open",
  };
  const hasWalletConnection = Boolean(walletSession);
  const requestFundsDisabledReason = !hasWalletConnection
    ? "Connect a wallet first."
    : !headsOpen.headA
      ? "Head A must be open."
      : actionActor !== "user"
        ? "Request funds is only enabled for connected user wallets."
        : null;
  const buyTicketDisabledReason = !hasWalletConnection
    ? "Connect a wallet first."
    : actionActor === "ida"
      ? "Buy ticket is only enabled for user and charlie wallets."
    : (actionActor === "charlie" && (!headsOpen.headB || !headsOpen.headC))
      ? "Head B and Head C must be open for Charlie buy ticket path."
      : (actionActor === "user" && (!headsOpen.headA || !headsOpen.headB))
        ? "Head A and Head B must be open for user buy ticket path."
        : null;
  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24, display: "grid", gap: 16 }}>
      <section style={cardStyle}>
        <h1 style={{ margin: 0 }}>
          eUTxO L2 Interop Final Demo {view === "charlie" ? "· Charlie View" : view === "user" ? "· User View" : ""}
        </h1>
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
        <h2 style={{ marginTop: 0 }}>Wallet (CIP-30 Mock)</h2>
        <p style={{ marginTop: 0, color: "#52525b" }}>
          This demo injects mock providers into <code>window.cardano.*</code> with CIP-30-like methods (<code>isEnabled</code>, <code>enable</code>, <code>getNetworkId</code>, <code>getUsedAddresses</code>, <code>getChangeAddress</code>).
        </p>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "2fr 1fr 1fr" }}>
          <label style={labelStyle}>
            Wallet Provider
            <select
              style={inputStyle}
              value={selectedWalletKey}
              onChange={(e) => setSelectedWalletKey(e.target.value)}
              disabled={busy || Boolean(walletSession)}
            >
              {walletOptions.map((wallet) => (
                <option key={wallet.key} value={wallet.key}>
                  {wallet.name} ({wallet.actor})
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: "flex", alignItems: "end", gap: 8 }}>
            <Button onClick={() => walletConnect.mutate()} disabled={busy || Boolean(walletSession) || !selectedWalletKey}>
              Connect Wallet
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                disconnectWallet();
                setWalletSession(null);
              }}
              disabled={busy || !walletSession}
            >
              Disconnect
            </Button>
          </div>
        </div>
        {walletConnect.isError ? (
          <p style={{ marginTop: 8, color: "#b91c1c" }}>Wallet connect failed: {walletConnect.error.message}</p>
        ) : null}
        {walletSession ? (
          <p style={{ marginTop: 8, marginBottom: 0, color: "#52525b" }}>
            Connected: <strong>{walletSession.walletName}</strong> · actor <strong>{walletSession.actor}</strong> · network <strong>{walletSession.networkId}</strong>
          </p>
        ) : (
          <p style={{ marginTop: 8, marginBottom: 0, color: "#71717a" }}>
            No wallet connected yet.
          </p>
        )}
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Actions</h2>
        <p style={{ marginTop: 0, color: "#52525b" }}>
          Current actor context: <strong>{actionActor}</strong>
        </p>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <label style={labelStyle}>
            Address
            <input
              style={inputStyle}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={Boolean(walletSession)}
            />
          </label>
          <label style={labelStyle}>
            Amount (lovelace)
            <input style={inputStyle} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label style={labelStyle}>
            Desired Output (Lottery Contract)
            <input style={inputStyle} value={desiredOutput} onChange={(e) => setDesiredOutput(e.target.value)} />
          </label>
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button onClick={() => requestFunds.mutate()} disabled={busy || Boolean(requestFundsDisabledReason)}>Request Funds</Button>
          <Button
            variant="outline"
            onClick={() => setRequestFundsIdempotencyKey(rotateRequestFundsIdempotencyKey(actionActor, address, amount))}
            disabled={busy || Boolean(requestFundsDisabledReason)}
          >
            New Request Intent
          </Button>
          <Button onClick={() => buyTicket.mutate()} disabled={busy || Boolean(buyTicketDisabledReason)}>Buy Ticket (Mock)</Button>
          <Button
            variant="outline"
            onClick={() => setBuyTicketIdempotencyKey(rotateBuyTicketIdempotencyKey(actionActor, address, amount, desiredOutput))}
            disabled={busy || Boolean(buyTicketDisabledReason)}
          >
            New Ticket Intent
          </Button>
        </div>
        {requestFundsDisabledReason ? (
          <p style={{ marginTop: 8, marginBottom: 0, color: "#b45309", fontSize: 12 }}>
            Request funds unavailable: {requestFundsDisabledReason}
          </p>
        ) : null}
        {buyTicketDisabledReason ? (
          <p style={{ marginTop: 6, marginBottom: 0, color: "#b45309", fontSize: 12 }}>
            Buy ticket unavailable: {buyTicketDisabledReason}
          </p>
        ) : null}
        <p style={{ marginTop: 8, marginBottom: 0, color: "#71717a", fontSize: 12 }}>
          Request funds idempotencyKey: <code>{requestFundsIdempotencyKey}</code>
        </p>
        <p style={{ marginTop: 6, marginBottom: 0, color: "#71717a", fontSize: 12 }}>
          Buy ticket idempotencyKey: <code>{buyTicketIdempotencyKey}</code>
        </p>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Workflow Timeline</h2>
        <p>Current workflow: {workflowId || "none"}</p>
        {workflow.data ? (
          <>
            <p style={{ marginBottom: 4 }}>
              Type: <strong>{workflow.data.type}</strong>
            </p>
            <p style={{ marginTop: 0, marginBottom: 8 }}>
              Status: <strong>{workflow.data.status}</strong>{" "}
              (attempt {workflow.data.attemptCount}/{workflow.data.maxAttempts})
            </p>
            {workflow.data.status === "failed" && workflow.data.nextRetryAt ? (
              <p style={{ marginTop: 0, color: "#b45309" }}>
                Retry scheduled in{" "}
                {Math.max(0, Math.floor((new Date(workflow.data.nextRetryAt).getTime() - nowMs) / 1000))}s
                {" · "}
                next retry at {new Date(workflow.data.nextRetryAt).toLocaleTimeString()}
              </p>
            ) : null}
            {workflow.data.status === "cancelled" ? (
              <p style={{ marginTop: 0, color: "#b91c1c" }}>
                Terminal failure: {workflow.data.lastErrorCode ?? "WORKFLOW_ERROR"}
                {workflow.data.errorMessage ? ` - ${workflow.data.errorMessage}` : ""}
              </p>
            ) : null}
            {workflow.data.status === "failed" || workflow.data.status === "cancelled" ? (
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
                <li key={event.id}>
                  [{event.level}] {event.message} ({new Date(event.createdAt).toLocaleTimeString()})
                </li>
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

export function FinalDemoApp({ view = "user" }: { view?: FinalDemoView }) {
  return (
    <QueryClientProvider client={queryClient}>
      <FinalDemoInner view={view} />
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
