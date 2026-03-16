"use client";

import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
// @ts-ignore - blake2b doesn't ship bundled types in this project setup
import blake2b from "blake2b";
import {
  connectWallet,
  disconnectWallet,
  getWalletOptions,
  restoreWalletSession,
  signTxWithConnectedWallet,
  type WalletSession,
} from "@/lib/wallet/cip30";
import { roleHeaders, type FinalDemoRole } from "@/lib/auth/role-guard";
import {
  HeadStateSection,
  SnapshotSection,
  WorkflowTimelineSection,
} from "@/components/final-demo/monitoring-sections";

type FinalDemoView = "user" | "charlie" | "admin";

export interface HeadReadModel {
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

export interface SnapshotRow {
  ref: string;
  address: string;
  label: string;
  lovelace: string;
  assets: Array<{ unit: string; amount: string }>;
  hasInlineDatum: boolean;
}

export interface HeadSnapshotState {
  head: "headA" | "headB" | "headC";
  status: string;
  error: string | null;
  utxos: SnapshotRow[];
  fetchedAt: string;
}

interface HeadSnapshotsResponse {
  updatedAt: string;
  heads: {
    headA: HeadSnapshotState;
    headB: HeadSnapshotState;
    headC: HeadSnapshotState;
  };
}

interface ApiErrorEnvelope {
  errorCode: string;
  message: string;
  requestId: string;
}

async function extractApiErrorMessage(response: Response): Promise<string> {
  const fallback = `${response.status} ${response.statusText}`.trim();
  try {
    const err = await response.json() as Partial<ApiErrorEnvelope> & { details?: unknown };
    if (err?.message && err?.errorCode && err?.requestId) {
      return `${err.message} (${err.errorCode}) [${err.requestId}]`;
    }
    if (err?.message) return String(err.message);
    return JSON.stringify(err);
  } catch {
    try {
      const text = await response.text();
      return text || fallback;
    } catch {
      return fallback;
    }
  }
}

function formatInlineError(message: string, max = 280): string {
  const trimmed = message.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}...`;
}

export interface WorkflowResponse {
  id: string;
  type: "request_funds" | "buy_ticket";
  status: string;
  resultJson: string | null;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  lastErrorCode: string | null;
  errorMessage: string | null;
  steps: Array<{ id: string; name: string; status: string; attempt: number }>;
  events: Array<{ id: string; level: string; message: string; createdAt: string; metaJson?: string | null }>;
}

interface WorkflowListResponse {
  requestId: string;
  count: number;
  workflows: WorkflowResponse[];
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

async function fetchHeadSnapshots(): Promise<HeadSnapshotsResponse> {
  const r = await fetch("/api/state/snapshots", { cache: "no-store" });
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
  if (!r.ok) throw new Error(await extractApiErrorMessage(r));
  return r.json() as Promise<{ workflowId: string; idempotencyKey?: string }>;
}

async function prepareRequestFundsTx(body: Record<string, unknown>) {
  const r = await fetch("/api/hydra-ops/request-funds/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await extractApiErrorMessage(r));
  return r.json() as Promise<{ unsignedTxCborHex: string; txBodyHash: string; amountLovelace: string }>;
}

async function submitRequestFundsTx(body: Record<string, unknown>) {
  const r = await fetch("/api/hydra-ops/request-funds/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await extractApiErrorMessage(r));
  return r.json() as Promise<{ txHash: string; amountLovelace: string }>;
}

async function prepareBuyTicketTx(body: Record<string, unknown>) {
  const r = await fetch("/api/hydra-ops/htlc/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await extractApiErrorMessage(r));
  return r.json() as Promise<{
    draftId: string;
    unsignedTxCborHex: string;
    txBodyHash: string;
    summary?: { sourceHead?: "headA" | "headC"; amountLovelace?: string; htlcHash?: string };
  }>;
}

async function submitBuyTicketTx(body: Record<string, unknown>) {
  const r = await fetch("/api/hydra-ops/htlc/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await extractApiErrorMessage(r));
  return r.json() as Promise<{
    txHash: string;
    sourceHtlcRef: string;
    headBHtlcRef: string | null;
    hashRef: string;
  }>;
}

function stringToHex(input: string): string {
  return Array.from(input)
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(input: string): Uint8Array {
  if (input.length % 2 !== 0) {
    throw new Error("Invalid hex input length");
  }
  const out = new Uint8Array(input.length / 2);
  for (let i = 0; i < input.length; i += 2) {
    out[i / 2] = Number.parseInt(input.slice(i, i + 2), 16);
  }
  return out;
}

function generateHtlcPairClient(): { preimage: string; htlcHash: string } {
  const preimage = stringToHex(crypto.randomUUID());
  const htlcHash = blake2b(32)
    .update(hexToBytes(preimage))
    .digest("hex");
  return { preimage, htlcHash };
}

async function fetchWorkflow(id: string): Promise<WorkflowResponse> {
  const r = await fetch(`/api/workflows/${id}`);
  if (!r.ok) throw new Error(await extractApiErrorMessage(r));
  return r.json();
}

async function retryWorkflow(id: string, role: FinalDemoRole) {
  const r = await fetch(`/api/admin/workflows/${id}/retry`, {
    method: "POST",
    headers: roleHeaders(role),
  });
  if (!r.ok) throw new Error(await extractApiErrorMessage(r));
  return r.json();
}

async function fetchAdminWorkflows(
  role: FinalDemoRole,
  filters: { status?: string; type?: string; idContains?: string },
): Promise<WorkflowListResponse> {
  const url = new URL("/api/admin/workflows", window.location.origin);
  if (filters.status) url.searchParams.set("status", filters.status);
  if (filters.type) url.searchParams.set("type", filters.type);
  if (filters.idContains) url.searchParams.set("idContains", filters.idContains);
  url.searchParams.set("limit", "25");
  const r = await fetch(url.toString(), {
    headers: roleHeaders(role),
  });
  if (!r.ok) throw new Error(await extractApiErrorMessage(r));
  return r.json();
}

async function runAdminReconcile(role: FinalDemoRole) {
  const r = await fetch("/api/admin/reconcile", {
    method: "POST",
    headers: roleHeaders(role),
  });
  if (!r.ok) throw new Error(await extractApiErrorMessage(r));
  return r.json();
}

async function registerLotteryActive(role: FinalDemoRole, body: Record<string, unknown>) {
  const r = await fetch("/api/lottery/active", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...roleHeaders(role) },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await extractApiErrorMessage(r));
  return r.json();
}

async function associateCharlieNode(role: FinalDemoRole) {
  const r = await fetch("/api/charlie/associate", {
    method: "POST",
    headers: roleHeaders(role),
  });
  if (!r.ok) throw new Error(await extractApiErrorMessage(r));
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
const HTLC_PAIRS_STORAGE_KEY = "final-demo.htlc-pairs.v1";
const HTLC_PAIRS_MAX = 10;
const REQUEST_FUNDS_FIXED_LOVELACE = "20000000";

type RequestFundsIntentRecord = {
  idempotencyKey: string;
  createdAtMs: number;
  workflowId?: string;
};

type RequestFundsIntentStore = Record<string, RequestFundsIntentRecord>;
type BuyTicketIntentStore = Record<string, RequestFundsIntentRecord>;
type HtlcPairRecord = { preimage: string; htlcHash: string; createdAtMs: number };

function requestFundsPayloadFingerprint(actor: string, address: string): string {
  return JSON.stringify({
    actor: actor.trim().toLowerCase(),
    address: address.trim(),
    amountLovelace: REQUEST_FUNDS_FIXED_LOVELACE,
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

function getOrCreateRequestFundsIdempotencyKey(actor: string, address: string) {
  const nowMs = Date.now();
  const fingerprint = requestFundsPayloadFingerprint(actor, address);
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

function rotateRequestFundsIdempotencyKey(actor: string, address: string) {
  const nowMs = Date.now();
  const fingerprint = requestFundsPayloadFingerprint(actor, address);
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
  htlcHash: string,
  timeoutMinutes: string,
): string {
  return JSON.stringify({
    actor: actor.trim().toLowerCase(),
    address: address.trim(),
    htlcHash: htlcHash.trim().toLowerCase(),
    timeoutMinutes: timeoutMinutes.trim(),
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
  htlcHash: string,
  timeoutMinutes: string,
) {
  const nowMs = Date.now();
  const fingerprint = buyTicketPayloadFingerprint(actor, address, htlcHash, timeoutMinutes);
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
  htlcHash: string,
  timeoutMinutes: string,
) {
  const nowMs = Date.now();
  const fingerprint = buyTicketPayloadFingerprint(actor, address, htlcHash, timeoutMinutes);
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

function loadHtlcPairs(): HtlcPairRecord[] {
  try {
    const raw = window.localStorage.getItem(HTLC_PAIRS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HtlcPairRecord[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x) =>
      typeof x?.preimage === "string"
      && typeof x?.htlcHash === "string"
      && typeof x?.createdAtMs === "number"
    );
  } catch {
    return [];
  }
}

function saveHtlcPair(preimage: string, htlcHash: string): HtlcPairRecord[] {
  const next = [{ preimage, htlcHash, createdAtMs: Date.now() }, ...loadHtlcPairs()].slice(0, HTLC_PAIRS_MAX);
  window.localStorage.setItem(HTLC_PAIRS_STORAGE_KEY, JSON.stringify(next));
  return next;
}

function FinalDemoInner({ view }: { view: FinalDemoView }) {
  const defaultActor = view === "charlie" ? "charlie" : "user";
  const appRole: FinalDemoRole = view === "admin" ? "admin" : view;
  const [walletOptions, setWalletOptions] = useState(() => getWalletOptions());
  const [selectedWalletKey, setSelectedWalletKey] = useState(walletOptions[0]?.key ?? "");
  const [walletSession, setWalletSession] = useState<WalletSession | null>(null);
  const actionActor = walletSession?.actor ?? defaultActor;
  const [address, setAddress] = useState("addr_test1_demo_wallet");
  const [lastPreparedTicketCostLovelace, setLastPreparedTicketCostLovelace] = useState<string | null>(null);
  const [requestFundsIdempotencyKey, setRequestFundsIdempotencyKey] = useState(() => newBusinessId());
  const [buyTicketIdempotencyKey, setBuyTicketIdempotencyKey] = useState(() => newBuyTicketIntentId());
  const [htlcHash, setHtlcHash] = useState("aabbccddeeff00112233445566778899");
  const [timeoutMinutes, setTimeoutMinutes] = useState("60");
  const [preimage, setPreimage] = useState("00112233445566778899aabbccddeeff");
  const [htlcPairs, setHtlcPairs] = useState<HtlcPairRecord[]>([]);
  const [htlcPairGenerateError, setHtlcPairGenerateError] = useState<string | null>(null);
  const [workflowId, setWorkflowId] = useState("");
  const [workflowSearchId, setWorkflowSearchId] = useState("");
  const [adminWorkflowStatusFilter, setAdminWorkflowStatusFilter] = useState("");
  const [adminWorkflowTypeFilter, setAdminWorkflowTypeFilter] = useState("");
  const [adminLotteryPolicyId, setAdminLotteryPolicyId] = useState("");
  const [adminLotteryTokenNameHex, setAdminLotteryTokenNameHex] = useState("");
  const [adminLotteryMintTxHash, setAdminLotteryMintTxHash] = useState("");
  const [adminLotteryContractAddress, setAdminLotteryContractAddress] = useState("");

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
  const anyOpenHead = Boolean(
    heads.data
    && (heads.data.headA.status === "open" || heads.data.headB.status === "open" || heads.data.headC.status === "open"),
  );
  const snapshots = useQuery({
    queryKey: ["head-snapshots", anyOpenHead],
    queryFn: fetchHeadSnapshots,
    enabled: anyOpenHead,
    retry: 1,
    refetchInterval: 4000,
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
  const adminWorkflows = useQuery({
    queryKey: ["admin-workflows", adminWorkflowStatusFilter, adminWorkflowTypeFilter, workflowSearchId],
    queryFn: () =>
      fetchAdminWorkflows(appRole, {
        status: adminWorkflowStatusFilter || undefined,
        type: adminWorkflowTypeFilter || undefined,
        idContains: workflowSearchId || undefined,
      }),
    enabled: view === "admin",
    refetchInterval: 3000,
  });

  const connect = useMutation({
    mutationFn: () => fetch("/api/state/heads/mock-connect", { method: "POST" }).then((r) => r.json()),
    onSuccess: () => heads.refetch(),
  });
  const walletConnect = useMutation({
    mutationFn: () => connectWallet(selectedWalletKey, defaultActor),
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
    setWalletOptions(getWalletOptions());
    restoreWalletSession(defaultActor)
      .then((session) => {
        if (!session) return;
        if (session.actor !== defaultActor) return;
        setWalletSession(session);
        setSelectedWalletKey(session.walletKey);
        setAddress(session.changeAddress);
      })
      .catch(() => {
        // Keep UI usable even if wallet restore fails.
      });
  }, [defaultActor, view]);
  useEffect(() => {
    if (!selectedWalletKey) {
      setSelectedWalletKey(walletOptions[0]?.key ?? "");
      return;
    }
    if (!walletOptions.some((wallet) => wallet.key === selectedWalletKey)) {
      setSelectedWalletKey(walletOptions[0]?.key ?? "");
    }
  }, [walletOptions, selectedWalletKey]);
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const wf = search.get("workflowId");
    if (wf) setWorkflowId(wf);
  }, []);
  useEffect(() => {
    const pairs = loadHtlcPairs();
    setHtlcPairs(pairs);
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
    const intent = getOrCreateRequestFundsIdempotencyKey(actionActor, address);
    setRequestFundsIdempotencyKey(intent.idempotencyKey);
  }, [actionActor, address]);
  useEffect(() => {
    const intent = getOrCreateBuyTicketIdempotencyKey(
      actionActor,
      address,
      htlcHash,
      timeoutMinutes,
    );
    setBuyTicketIdempotencyKey(intent.idempotencyKey);
  }, [actionActor, address, htlcHash, timeoutMinutes]);

  const requestFunds = useMutation({
    mutationFn: () =>
      {
        if (!walletSession) {
          throw new Error("Connect a wallet first.");
        }
        const actor = actionActor;
        const walletAddress = walletSession.changeAddress;
        const intent = getOrCreateRequestFundsIdempotencyKey(actor, walletAddress);
        return prepareRequestFundsTx({ address: walletAddress })
          .then((draft) => signTxWithConnectedWallet(walletSession, draft.unsignedTxCborHex, true)
            .then((witnessHex) => ({ draft, witnessHex })))
          .then(({ draft, witnessHex }) => submitRequestFundsTx({ unsignedTxCborHex: draft.unsignedTxCborHex, witnessHex }))
          .then((submitted) => createWorkflow("/api/workflows/request-funds", {
            actor,
            idempotencyKey: intent.idempotencyKey,
            address: walletAddress,
            amountLovelace: submitted.amountLovelace,
            submittedTxHash: submitted.txHash,
          }).then((d) => ({ ...d, fingerprint: intent.fingerprint }))
        );
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
        if (!walletSession) {
          throw new Error("Connect a wallet first.");
        }
        const actor = actionActor;
        const walletAddress = walletSession.changeAddress;
        const intent = getOrCreateBuyTicketIdempotencyKey(
          actor,
          walletAddress,
          htlcHash,
          timeoutMinutes,
        );
        return prepareBuyTicketTx({
          actor,
          address: walletAddress,
          amountLovelace: "0",
          sourceHead: actor === "charlie" ? "headC" : "headA",
          htlcHash,
          timeoutMinutes,
        })
          .then((draft) => {
            const ticketCost = draft.summary?.amountLovelace?.trim();
            const preparedSourceHead = draft.summary?.sourceHead;
            const preparedHtlcHash = draft.summary?.htlcHash?.trim();
            if (!ticketCost || !/^\d+$/.test(ticketCost)) {
              throw new Error("Server did not return a valid ticket cost in buy-ticket prepare");
            }
            if ((preparedSourceHead !== "headA" && preparedSourceHead !== "headC") || !preparedHtlcHash) {
              throw new Error("Server did not return required buy-ticket metadata for submit");
            }
            setLastPreparedTicketCostLovelace(ticketCost);
            // CIP-30 signTx returns witness set; server assembles it with the unsigned tx.
            return signTxWithConnectedWallet(walletSession, draft.unsignedTxCborHex, true)
              .then((witnessHex) => ({ unsignedTxCborHex: draft.unsignedTxCborHex, witnessHex, ticketCost, preparedSourceHead, preparedHtlcHash }));
          })
          .then(({ unsignedTxCborHex, witnessHex, ticketCost, preparedSourceHead, preparedHtlcHash }) =>
            createWorkflow("/api/workflows/buy-ticket", {
              actor,
              idempotencyKey: intent.idempotencyKey,
              address: walletAddress,
              amountLovelace: ticketCost,
              htlcHash,
              timeoutMinutes,
              preimage,
            })
              .then((pendingWf) => {
                setWorkflowId(pendingWf.workflowId);
                bindBuyTicketIntentWorkflow(intent.fingerprint, pendingWf.workflowId);
                if (pendingWf.idempotencyKey) setBuyTicketIdempotencyKey(pendingWf.idempotencyKey);
                return { unsignedTxCborHex, witnessHex, preparedSourceHead, preparedHtlcHash, ticketCost };
              }),
          )
          .then(({ unsignedTxCborHex, witnessHex, preparedSourceHead, preparedHtlcHash, ticketCost }) =>
            submitBuyTicketTx({
              unsignedTxCborHex,
              witnessHex,
              sourceHead: preparedSourceHead,
              htlcHash: preparedHtlcHash,
              idempotencyKey: intent.idempotencyKey,
              preimage,
            }).then((submitted) => ({ submitted, ticketCost })),
          )
          .then(({ submitted, ticketCost }) =>
            createWorkflow("/api/workflows/buy-ticket", {
              actor,
              idempotencyKey: intent.idempotencyKey,
              address: walletAddress,
              amountLovelace: ticketCost,
              htlcHash,
              timeoutMinutes,
              preimage,
              submittedSourceTxHash: submitted.txHash,
              submittedSourceHtlcRef: submitted.sourceHtlcRef,
            }).then((d) => ({ ...d, fingerprint: intent.fingerprint })),
          );
      },
    onSuccess: (d) => {
      setWorkflowId(d.workflowId);
      bindBuyTicketIntentWorkflow(d.fingerprint, d.workflowId);
      if (d.idempotencyKey) setBuyTicketIdempotencyKey(d.idempotencyKey);
    },
  });

  const retry = useMutation({
    mutationFn: () => retryWorkflow(workflowId, appRole),
    onSuccess: () => workflow.refetch(),
  });
  const reconcile = useMutation({
    mutationFn: () => runAdminReconcile(appRole),
    onSuccess: () => {
      heads.refetch();
      adminWorkflows.refetch();
      if (workflowId) workflow.refetch();
    },
  });
  const createLotteryRegistration = useMutation({
    mutationFn: () =>
      registerLotteryActive(appRole, {
        headName: "headB",
        policyId: adminLotteryPolicyId.trim().toLowerCase(),
        tokenNameHex: adminLotteryTokenNameHex.trim().toLowerCase(),
        mintTxHash: adminLotteryMintTxHash.trim().toLowerCase(),
        contractAddress: adminLotteryContractAddress.trim(),
      }),
  });
  const associateCharlie = useMutation({
    mutationFn: () => associateCharlieNode(appRole),
    onSuccess: () => {
      heads.refetch();
      snapshots.refetch();
    },
  });
  const generateHtlcPairAndFill = () => {
    try {
      setHtlcPairGenerateError(null);
      const { preimage: nextPreimage, htlcHash: nextHash } = generateHtlcPairClient();
      setPreimage(nextPreimage);
      setHtlcHash(nextHash);
      setHtlcPairs(saveHtlcPair(nextPreimage, nextHash));
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      setHtlcPairGenerateError(message);
    }
  };

  useEffect(() => {
    const data = workflow.data;
    if (!data || data.type !== "request_funds") return;
    if (data.status !== "succeeded" && data.status !== "cancelled") return;
    if (clearRequestFundsIntentByWorkflowId(data.id)) {
      setRequestFundsIdempotencyKey(rotateRequestFundsIdempotencyKey(actionActor, address));
    }
  }, [actionActor, address, workflow.data]);
  useEffect(() => {
    const data = workflow.data;
    if (!data || data.type !== "buy_ticket") return;
    if (data.status !== "succeeded" && data.status !== "cancelled") return;
    if (clearBuyTicketIntentByWorkflowId(data.id)) {
      setBuyTicketIdempotencyKey(
        rotateBuyTicketIdempotencyKey(
          actionActor,
          address,
          htlcHash,
          timeoutMinutes,
        ),
      );
    }
  }, [
    actionActor,
    address,
    htlcHash,
    timeoutMinutes,
    workflow.data,
  ]);

  const busy = useMemo(
    () => connect.isPending || walletConnect.isPending || requestFunds.isPending || buyTicket.isPending,
    [connect.isPending, walletConnect.isPending, requestFunds.isPending, buyTicket.isPending],
  );
  const headsOpen = {
    headA: heads.data?.headA.status === "open",
    headB: heads.data?.headB.status === "open",
    headC: heads.data?.headC.status === "open",
  };
  const visibleHeads: Array<"headA" | "headB" | "headC"> = view === "user"
    ? ["headA", "headB"]
    : view === "charlie"
      ? ["headA", "headC"]
      : ["headA", "headB", "headC"];
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
    <main
      style={{
        width: "100%",
        maxWidth: "100%",
        margin: 0,
        padding: "clamp(8px, 2vw, 14px)",
        display: "grid",
        gap: 12,
      }}
    >
      <HeadStateSection
        heads={heads}
        nowMs={nowMs}
        visibleHeads={visibleHeads}
        onRetry={() => heads.refetch()}
        cardStyle={cardStyle}
      />
      {anyOpenHead ? (
        <SnapshotSection snapshots={snapshots} visibleHeads={visibleHeads} cardStyle={cardStyle} />
      ) : null}

      {view !== "admin" ? (
      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Wallet (CIP-30)</h2>
        <p style={{ marginTop: 0, color: "#475569", fontSize: 13 }}>
          Connect a detected CIP-30 wallet extension. If none are installed, actions stay disabled.
        </p>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <label style={labelStyle}>
            Wallet Provider
            <select
              style={inputStyle}
              value={selectedWalletKey}
              onChange={(e) => setSelectedWalletKey(e.target.value)}
              disabled={busy || Boolean(walletSession) || walletOptions.length === 0}
            >
              {walletOptions.length === 0 ? (
                <option value="">No wallet extensions detected</option>
              ) : null}
              {walletOptions.map((wallet) => (
                <option key={wallet.key} value={wallet.key}>
                  {wallet.name}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: "flex", alignItems: "end", gap: 8 }}>
            <Button
              onClick={() => {
                setWalletOptions(getWalletOptions());
                walletConnect.mutate();
              }}
              disabled={busy || Boolean(walletSession) || !selectedWalletKey || walletOptions.length === 0}
            >
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
        {walletOptions.length === 0 ? (
          <p style={{ marginTop: 8, marginBottom: 0, color: "#b45309" }}>
            No CIP-30 wallet extension detected in this browser.
          </p>
        ) : null}
        {walletSession ? (
          <p style={{ marginTop: 8, marginBottom: 0, color: "#334155", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: "6px 8px", fontSize: 13 }}>
            Connected: <strong>{walletSession.walletName}</strong> · actor <strong>{walletSession.actor}</strong> · network <strong>{walletSession.networkId}</strong>
            {" · "}signTx <strong>{walletSession.supportsSignTx ? "yes" : "no"}</strong>
          </p>
        ) : (
          <p style={{ marginTop: 8, marginBottom: 0, color: "#71717a" }}>
            No wallet connected yet.
          </p>
        )}
      </section>
      ) : null}

      {view !== "admin" ? (
      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Actions</h2>
        <p style={{ marginTop: 0, color: "#475569", fontSize: 13 }}>
          Current actor context: <strong>{actionActor}</strong>
        </p>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "minmax(0, 1fr) 220px" }}>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <label style={labelStyle}>
              Address
              <input
                style={inputStyle}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                disabled={Boolean(walletSession)}
              />
            </label>
            {view === "user" ? (
              <label style={labelStyle}>
                Request funds amount (lovelace)
                <input style={inputStyle} value={REQUEST_FUNDS_FIXED_LOVELACE} readOnly />
              </label>
            ) : null}
            <label style={labelStyle}>
              Ticket cost (lovelace)
              <input
                style={inputStyle}
                value={lastPreparedTicketCostLovelace ?? "derived from active lottery at prepare"}
                readOnly
              />
            </label>
            <label style={labelStyle}>
              HTLC Hash (hex)
              <input style={inputStyle} value={htlcHash} onChange={(e) => setHtlcHash(e.target.value)} />
            </label>
            <label style={labelStyle}>
              HTLC Timeout (minutes)
              <input style={inputStyle} value={timeoutMinutes} onChange={(e) => setTimeoutMinutes(e.target.value)} />
            </label>
            <label style={labelStyle}>
              HTLC Preimage (hex, demo)
              <input style={inputStyle} value={preimage} onChange={(e) => setPreimage(e.target.value)} />
            </label>
          </div>
          <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
            <Button variant="secondary" onClick={generateHtlcPairAndFill} disabled={busy}>
              Generate Pair
            </Button>
            {view === "user" ? (
              <Button onClick={() => requestFunds.mutate()} disabled={busy || Boolean(requestFundsDisabledReason)}>
                Request Funds
              </Button>
            ) : null}
            <Button onClick={() => buyTicket.mutate()} disabled={busy || Boolean(buyTicketDisabledReason)}>Buy Ticket</Button>
            {view === "charlie" ? (
              <Button variant="outline" onClick={() => associateCharlie.mutate()} disabled={associateCharlie.isPending}>
                Associate Node
              </Button>
            ) : null}
          </div>
        </div>
        {view === "user" && requestFundsDisabledReason ? (
          <p style={{ marginTop: 8, marginBottom: 0, color: "#b45309", fontSize: 12, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "5px 7px" }}>
            Request funds unavailable: {requestFundsDisabledReason}
          </p>
        ) : null}
        {buyTicketDisabledReason ? (
          <p style={{ marginTop: 6, marginBottom: 0, color: "#b45309", fontSize: 12, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "5px 7px" }}>
            Buy ticket unavailable: {buyTicketDisabledReason}
          </p>
        ) : null}
        {view === "user" && requestFunds.isError ? (
          <p style={{ marginTop: 6, marginBottom: 0, color: "#b91c1c", fontSize: 12, overflowWrap: "anywhere", wordBreak: "break-word", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "6px 8px" }}>
            Request funds failed: {formatInlineError(requestFunds.error.message)}
          </p>
        ) : null}
        {buyTicket.isError ? (
          <p style={{ marginTop: 6, marginBottom: 0, color: "#b91c1c", fontSize: 12, overflowWrap: "anywhere", wordBreak: "break-word", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "6px 8px" }}>
            Buy ticket failed: {formatInlineError(buyTicket.error.message)}
          </p>
        ) : null}
        {associateCharlie.isError ? (
          <p style={{ marginTop: 6, marginBottom: 0, color: "#b91c1c", fontSize: 12, overflowWrap: "anywhere", wordBreak: "break-word" }}>
            Charlie association failed: {formatInlineError(associateCharlie.error.message)}
          </p>
        ) : null}
        {associateCharlie.isSuccess ? (
          <p style={{ marginTop: 6, marginBottom: 0, color: "#166534", fontSize: 12 }}>
            Charlie hydra node association requested.
          </p>
        ) : null}
        {htlcPairGenerateError ? (
          <p style={{ marginTop: 6, marginBottom: 0, color: "#b91c1c", fontSize: 12 }}>
            HTLC pair generation failed: {htlcPairGenerateError}
          </p>
        ) : null}
        {htlcPairs.length > 0 ? (
          <p style={{ marginTop: 6, marginBottom: 0, color: "#52525b", fontSize: 12 }}>
            Latest generated pair saved in UI context at{" "}
            {new Date(htlcPairs[0].createdAtMs).toLocaleTimeString()}.
          </p>
        ) : null}
        {view === "user" ? (
          <p style={{ marginTop: 8, marginBottom: 0, color: "#71717a", fontSize: 12 }}>
            Request funds idempotencyKey:
            <code style={{ display: "block", overflowWrap: "anywhere", wordBreak: "break-word" }}>
              {requestFundsIdempotencyKey}
            </code>
          </p>
        ) : null}
        <p style={{ marginTop: 6, marginBottom: 0, color: "#71717a", fontSize: 12 }}>
          Buy ticket idempotencyKey:
          <code style={{ display: "block", overflowWrap: "anywhere", wordBreak: "break-word" }}>
            {buyTicketIdempotencyKey}
          </code>
        </p>
      </section>
      ) : null}

      {view === "admin" ? (
        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Admin Operations</h2>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <label style={labelStyle}>
              Workflow ID search
              <input style={inputStyle} value={workflowSearchId} onChange={(e) => setWorkflowSearchId(e.target.value)} />
            </label>
            <label style={labelStyle}>
              Workflow status
              <select style={inputStyle} value={adminWorkflowStatusFilter} onChange={(e) => setAdminWorkflowStatusFilter(e.target.value)}>
                <option value="">All</option>
                <option value="pending">pending</option>
                <option value="running">running</option>
                <option value="failed">failed</option>
                <option value="cancelled">cancelled</option>
                <option value="succeeded">succeeded</option>
              </select>
            </label>
            <label style={labelStyle}>
              Workflow type
              <select style={inputStyle} value={adminWorkflowTypeFilter} onChange={(e) => setAdminWorkflowTypeFilter(e.target.value)}>
                <option value="">All</option>
                <option value="request_funds">request_funds</option>
                <option value="buy_ticket">buy_ticket</option>
              </select>
            </label>
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button variant="outline" onClick={() => adminWorkflows.refetch()}>Refresh Workflow List</Button>
            <Button variant="secondary" onClick={() => reconcile.mutate()} disabled={reconcile.isPending}>Run Reconcile</Button>
          </div>
          {adminWorkflows.isError ? (
            <p style={{ marginTop: 8, color: "#b91c1c" }}>Admin workflow list failed: {adminWorkflows.error.message}</p>
          ) : null}
          {reconcile.isError ? (
            <p style={{ marginTop: 8, color: "#b91c1c" }}>Reconcile failed: {reconcile.error.message}</p>
          ) : null}
          {adminWorkflows.data ? (
            <div style={{ marginTop: 10 }}>
              <p style={{ margin: "0 0 8px 0", color: "#334155", fontWeight: 600 }}>Found {adminWorkflows.data.count} workflows</p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {adminWorkflows.data.workflows.map((wf) => (
                  <li key={wf.id} style={{ marginBottom: 6, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "4px 7px", listStylePosition: "inside" }}>
                    <button
                      type="button"
                      onClick={() => setWorkflowId(wf.id)}
                      style={{ border: "none", background: "transparent", color: "#1d4ed8", cursor: "pointer", padding: 0 }}
                    >
                      {wf.id}
                    </button>
                    {" · "}{wf.type} · {wf.status} · attempt {wf.attemptCount}/{wf.maxAttempts}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <h3 style={{ marginTop: 16, marginBottom: 8 }}>Register Active Lottery</h3>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <label style={labelStyle}>
              Policy ID
              <input style={inputStyle} value={adminLotteryPolicyId} onChange={(e) => setAdminLotteryPolicyId(e.target.value)} />
            </label>
            <label style={labelStyle}>
              Token Name Hex
              <input style={inputStyle} value={adminLotteryTokenNameHex} onChange={(e) => setAdminLotteryTokenNameHex(e.target.value)} />
            </label>
            <label style={labelStyle}>
              Mint Tx Hash
              <input style={inputStyle} value={adminLotteryMintTxHash} onChange={(e) => setAdminLotteryMintTxHash(e.target.value)} />
            </label>
            <label style={labelStyle}>
              Contract Address
              <input style={inputStyle} value={adminLotteryContractAddress} onChange={(e) => setAdminLotteryContractAddress(e.target.value)} />
            </label>
          </div>
          <div style={{ marginTop: 10 }}>
            <Button onClick={() => createLotteryRegistration.mutate()} disabled={createLotteryRegistration.isPending}>
              Register Lottery
            </Button>
          </div>
          {createLotteryRegistration.isError ? (
            <p style={{ marginTop: 8, color: "#b91c1c" }}>Lottery register failed: {createLotteryRegistration.error.message}</p>
          ) : null}
          {createLotteryRegistration.isSuccess ? (
            <p style={{ marginTop: 8, color: "#166534" }}>Lottery registration submitted.</p>
          ) : null}
        </section>
      ) : null}

      {view === "admin" ? (
        <WorkflowTimelineSection
          workflowId={workflowId}
          workflow={workflow}
          nowMs={nowMs}
          view={view}
          onRetry={() => retry.mutate()}
          cardStyle={cardStyle}
        />
      ) : null}
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

const cardStyle: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: 12,
  boxShadow: "0 1px 1px rgba(15,23,42,0.04)",
};

const labelStyle: React.CSSProperties = {
  display: "grid",
  gap: 5,
  fontSize: 12,
  color: "#374151",
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  border: "1px solid #d1d5db",
  borderRadius: 8,
  padding: "8px 10px",
  background: "#ffffff",
  color: "#111827",
};
