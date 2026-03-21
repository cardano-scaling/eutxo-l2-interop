"use client";

import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import {
  ActionButtonsCol,
  ActionSplit,
  CardDescriptionSm,
  CardTitleLg,
  HelperText,
  IdempotencyText,
  InlineCodeBlock,
  LinkButton,
  ListItemCard,
  ListSummary,
  ListUl,
  ListWrap,
  MetaText,
  PageGrid,
  Row,
  SectionSubTitle,
  WrapRow,
  MutedText,
  ConnectedBanner,
} from "@/components/ui/layout";
// @ts-ignore - blake2b doesn't ship bundled types in this project setup
import blake2b from "blake2b";
import {
  buildWalletSessionFromEnabledWallet,
  disconnectWallet,
  restoreWalletSessionWithFallback,
  signTxWithConnectedWallet,
  type WalletSession,
} from "@/lib/wallet/cip30";
import { ConnectWallet } from "@newm.io/cardano-dapp-wallet-connector";
import { roleHeaders, type FinalDemoRole } from "@/lib/auth/role-guard";
import {
  HeadMonitoringSection,
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
  inlineDatum: unknown | null;
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

function formatSavedAgo(savedAtMs: number, nowMs: number): string {
  const diffMs = Math.max(0, nowMs - savedAtMs);
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "saved just now";
  if (mins === 1) return "saved 1 min ago";
  return `saved ${mins} min ago`;
}

async function extractApiErrorMessage(response: Response): Promise<string> {
  const fallback = `${response.status} ${response.statusText}`.trim();
  try {
    const err = await response.json() as Partial<ApiErrorEnvelope> & { details?: unknown };
    const detailMessage = (() => {
      if (!err?.details || typeof err.details !== "object") return null;
      const maybe = (err.details as { message?: unknown }).message;
      return typeof maybe === "string" && maybe.trim().length > 0 ? maybe : null;
    })();
    if (err?.message && err?.errorCode && err?.requestId) {
      return detailMessage
        ? `${err.message} (${err.errorCode}) [${err.requestId}] — ${detailMessage}`
        : `${err.message} (${err.errorCode}) [${err.requestId}]`;
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

function isTestnetAddress(address: string | null | undefined): boolean {
  return typeof address === "string" && address.trim().startsWith("addr_test");
}

export interface WorkflowResponse {
  id: string;
  type: "request_funds" | "buy_ticket" | "admin_head_operation";
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

type WorkflowEvent = WorkflowResponse["events"][number];

function hasWorkflowEvent(workflow: WorkflowResponse, message: string): boolean {
  return workflow.events.some((event) => event.message === message);
}

function parseWorkflowEventMeta(event: WorkflowEvent): Record<string, unknown> | null {
  if (!event.metaJson) return null;
  try {
    const parsed = JSON.parse(event.metaJson) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function workflowHeadOperation(workflow: WorkflowResponse): string | null {
  const validated = workflow.events.find((event) => event.message === "admin_head_operation_validated");
  const meta = validated ? parseWorkflowEventMeta(validated) : null;
  const operation = meta?.operation;
  return typeof operation === "string" ? operation : null;
}

function isHeadCCommitOperationWorkflow(workflow: WorkflowResponse): boolean {
  if (workflow.type !== "admin_head_operation") return false;
  const operation = workflowHeadOperation(workflow);
  if (operation === "commit_head_c_charlie" || operation === "commit_head_c_admin") return true;
  return workflow.events.some((event) => event.message.startsWith("head_c_"));
}

function buyTicketMilestones(workflow: WorkflowResponse): Array<{ key: string; label: string; done: boolean }> {
  const sourceLocked = hasWorkflowEvent(workflow, "htlc_source_locked");
  const targetLocked = hasWorkflowEvent(workflow, "htlc_head_b_locked");
  const targetClaimed = hasWorkflowEvent(workflow, "ida_claim_target") || hasWorkflowEvent(workflow, "ida_claimed_both_htlcs");
  const sourceClaimed = hasWorkflowEvent(workflow, "ida_claim_source") || hasWorkflowEvent(workflow, "ida_claimed_both_htlcs");
  return [
    { key: "source_locked", label: "HTLC in source head locked", done: sourceLocked },
    { key: "target_locked", label: "HTLC in target head locked", done: targetLocked },
    { key: "target_claimed", label: "HTLC in target head claimed -> ticket created", done: targetClaimed },
    { key: "source_claimed", label: "HTLC in source head claimed", done: sourceClaimed },
  ];
}

function stepStatus(workflow: WorkflowResponse, stepName: "prepare" | "submit" | "confirm"): string {
  return workflow.steps.find((step) => step.name === stepName)?.status ?? "pending";
}

function requestFundsMilestones(workflow: WorkflowResponse): Array<{ key: string; label: string; state: string }> {
  return [
    { key: "validated", label: "Funding request validated", state: stepStatus(workflow, "prepare") },
    { key: "submitted", label: "Funding transfer submitted on Head A", state: stepStatus(workflow, "submit") },
    { key: "confirmed", label: "Funding transfer confirmed and available", state: stepStatus(workflow, "confirm") },
  ];
}

function headCCommitMilestones(workflow: WorkflowResponse): Array<{ key: string; label: string; done: boolean }> {
  const opened = hasWorkflowEvent(workflow, "head_c_open_completed");
  const waitingCounterpart = hasWorkflowEvent(workflow, "head_c_waiting_counterpart");
  return [
    { key: "validated", label: "Commit request accepted", done: hasWorkflowEvent(workflow, "admin_head_operation_validated") },
    { key: "script_started", label: "Head C commit script started", done: hasWorkflowEvent(workflow, "head_c_commit_script_started") },
    { key: "l1_refresh", label: "L1 UTxOs refreshed", done: hasWorkflowEvent(workflow, "head_c_l1_utxos_refreshed_startup") },
    { key: "tx_signed", label: "Commit tx signed", done: hasWorkflowEvent(workflow, "head_c_commit_tx_signed") },
    {
      key: "tx_submitted",
      label: "Commit tx submitted on L1",
      done: hasWorkflowEvent(workflow, "head_c_commit_tx_submitted") || hasWorkflowEvent(workflow, "head_c_partial_commit_submitted"),
    },
    { key: "waiting_counterpart", label: "Waiting for counterpart commit", done: waitingCounterpart || opened },
    { key: "opened", label: "Head C open completed", done: opened },
  ];
}

function describeHeadCCommitLatestEvent(event: WorkflowEvent): string {
  if (event.message === "head_c_waiting_counterpart") return "Waiting for counterpart commit";
  if (event.message === "head_c_open_completed") return "Head C is open";
  if (event.message === "head_c_commit_tx_submitted") {
    const meta = parseWorkflowEventMeta(event);
    const txHash = typeof meta?.txHash === "string" ? meta.txHash : null;
    return txHash ? `Commit tx submitted: ${txHash}` : "Commit tx submitted";
  }
  return event.message;
}

function milestoneIcon(state: string): string {
  if (state === "succeeded") return "✅";
  if (state === "failed" || state === "cancelled") return "❌";
  if (state === "running") return "⏳";
  return "○";
}

interface WorkflowListResponse {
  requestId: string;
  count: number;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasPrevPage: boolean;
  hasNextPage: boolean;
  workflows: WorkflowResponse[];
}

interface LotteryActiveResponse {
  requestId: string;
  headName: "headB";
  active: {
    id: string;
    headName: "headA" | "headB" | "headC";
    assetUnit: string;
    policyId: string;
    tokenNameHex: string;
    mintTxHash: string;
    contractAddress: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    closedAt: string | null;
  } | null;
  ticketCostLovelace: string | null;
}

interface LotteryRegistrationPayload {
  headName: "headB";
  policyId: string;
  tokenNameHex: string;
  mintTxHash: string;
  contractAddress: string;
}

interface AdminLotteryCreateResponse {
  requestId: string;
  ok: boolean;
  registrationOk: boolean;
  needsReconcile: boolean;
  result: {
    onchain: {
      txHash: string;
      assetUnit: string;
      policyId: string;
      tokenNameHex: string;
      contractAddress: string;
      lotteryUtxoRef: string | null;
    };
    registration: {
      ok: boolean;
      attempts: number;
      error?: string;
      payload: LotteryRegistrationPayload;
    };
  };
  stdout: string;
  stderr: string;
  finishedAt: string;
}

interface AdminLotteryReconcileResponse {
  requestId: string;
  ok: boolean;
  reconciledAt: string;
}

type PendingLotteryReconcileRecord = AdminLotteryCreateResponse["result"] & {
  savedAtMs: number;
};

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

async function submitCharlieBuyTicketTx(role: FinalDemoRole, body: { htlcHash: string; timeoutMinutes: string }) {
  const r = await fetch("/api/charlie/buy-ticket/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...roleHeaders(role) },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await extractApiErrorMessage(r));
  return r.json() as Promise<{
    txHash: string;
    sourceHtlcRef: string;
    headBHtlcRef: null;
    hashRef: string;
    address: string;
    amountLovelace: string;
  }>;
}

async function fetchCharlieAddress(role: FinalDemoRole): Promise<string> {
  const r = await fetch("/api/charlie/address", {
    headers: roleHeaders(role),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(await extractApiErrorMessage(r));
  const payload = await r.json() as { address?: string };
  if (!payload.address?.trim()) throw new Error("Charlie address is not available");
  return payload.address.trim();
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
  filters: { status?: string; type?: string; idContains?: string; page?: number; includeCompleted?: boolean },
): Promise<WorkflowListResponse> {
  const url = new URL("/api/admin/workflows", window.location.origin);
  if (filters.status) url.searchParams.set("status", filters.status);
  if (filters.type) url.searchParams.set("type", filters.type);
  if (filters.idContains) url.searchParams.set("idContains", filters.idContains);
  if (filters.page && filters.page > 1) url.searchParams.set("page", String(filters.page));
  if (filters.includeCompleted) url.searchParams.set("includeCompleted", "true");
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

async function fetchActiveLottery(): Promise<LotteryActiveResponse> {
  const r = await fetch("/api/lottery/active", { cache: "no-store" });
  if (!r.ok) throw new Error(await extractApiErrorMessage(r));
  return r.json();
}

async function createLotteryOnHeadB(role: FinalDemoRole, body: Record<string, unknown>) {
  const r = await fetch("/api/admin/lottery/create", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...roleHeaders(role) },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await extractApiErrorMessage(r));
  return r.json() as Promise<AdminLotteryCreateResponse>;
}

async function reconcileLotteryRegistration(role: FinalDemoRole, payload: LotteryRegistrationPayload) {
  const r = await fetch("/api/admin/lottery/reconcile", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...roleHeaders(role) },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(await extractApiErrorMessage(r));
  return r.json() as Promise<AdminLotteryReconcileResponse>;
}

async function runAdminHeadOperation(
  role: FinalDemoRole,
  operation: "open_head_a" | "open_head_b" | "open_heads_ab" | "commit_head_c_charlie" | "commit_head_c_admin",
) {
  const r = await fetch("/api/admin/heads/open", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...roleHeaders(role) },
    body: JSON.stringify({ operation }),
  });
  if (!r.ok) throw new Error(await extractApiErrorMessage(r));
  return r.json() as Promise<{
    ok: boolean;
    operation: string;
    workflowId: string;
    workflowStatus: string;
    idempotencyKey: string;
    queuedAt: string;
  }>;
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
const LOTTERY_RECONCILE_STORAGE_KEY = "final-demo.admin.lottery-reconcile.v1";
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

function loadPendingLotteryReconcile(): PendingLotteryReconcileRecord | null {
  try {
    const raw = window.localStorage.getItem(LOTTERY_RECONCILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingLotteryReconcileRecord>;
    if (
      typeof parsed?.onchain?.txHash !== "string"
      || typeof parsed?.onchain?.assetUnit !== "string"
      || typeof parsed?.registration?.payload?.policyId !== "string"
      || typeof parsed?.registration?.payload?.tokenNameHex !== "string"
      || typeof parsed?.registration?.payload?.mintTxHash !== "string"
      || typeof parsed?.registration?.payload?.contractAddress !== "string"
    ) {
      return null;
    }
    return {
      onchain: parsed.onchain as PendingLotteryReconcileRecord["onchain"],
      registration: parsed.registration as PendingLotteryReconcileRecord["registration"],
      savedAtMs: typeof parsed.savedAtMs === "number" ? parsed.savedAtMs : Date.now(),
    };
  } catch {
    return null;
  }
}

function savePendingLotteryReconcile(record: PendingLotteryReconcileRecord | null): void {
  if (!record) {
    window.localStorage.removeItem(LOTTERY_RECONCILE_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(LOTTERY_RECONCILE_STORAGE_KEY, JSON.stringify(record));
}

function FinalDemoInner({ view }: { view: FinalDemoView }) {
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme === "dark";
  const defaultActor = view === "charlie" ? "charlie" : "user";
  const appRole: FinalDemoRole = view === "admin" ? "admin" : view;
  const [walletSession, setWalletSession] = useState<WalletSession | null>(null);
  const [walletConnectorError, setWalletConnectorError] = useState<string | null>(null);
  const actionActor = walletSession?.actor ?? defaultActor;
  const [address, setAddress] = useState("no wallet connected");
  const [requestFundsIdempotencyKey, setRequestFundsIdempotencyKey] = useState(() => newBusinessId());
  const [buyTicketIdempotencyKey, setBuyTicketIdempotencyKey] = useState(() => newBuyTicketIntentId());
  const [htlcHash, setHtlcHash] = useState("aabbccddeeff00112233445566778899");
  const [timeoutMinutes, setTimeoutMinutes] = useState("60");
  const [preimage, setPreimage] = useState("00112233445566778899aabbccddeeff");
  const [htlcPairs, setHtlcPairs] = useState<HtlcPairRecord[]>([]);
  const [htlcPairGenerateError, setHtlcPairGenerateError] = useState<string | null>(null);
  const [workflowId, setWorkflowId] = useState("");
  const [charlieHeadCWorkflowId, setCharlieHeadCWorkflowId] = useState("");
  const [workflowSearchId, setWorkflowSearchId] = useState("");
  const [adminWorkflowStatusFilter, setAdminWorkflowStatusFilter] = useState("__all_excluding_succeeded");
  const [adminWorkflowTypeFilter, setAdminWorkflowTypeFilter] = useState("");
  const [adminWorkflowPage, setAdminWorkflowPage] = useState(1);
  const [adminLotteryPrizeLovelace, setAdminLotteryPrizeLovelace] = useState("25000000");
  const [adminLotteryTicketCostLovelace, setAdminLotteryTicketCostLovelace] = useState("5000000");
  const [adminLotteryCloseTimestampMs, setAdminLotteryCloseTimestampMs] = useState("");
  const [pendingLotteryReconcile, setPendingLotteryReconcile] = useState<PendingLotteryReconcileRecord | null>(null);

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
  const snapshots = useQuery({
    queryKey: ["head-snapshots"],
    queryFn: fetchHeadSnapshots,
    enabled: true,
    retry: 1,
    refetchInterval: (q) => {
      const data = q.state.data;
      const hasOpen = Boolean(
        data
        && (
          data.heads.headA.status === "open"
          || data.heads.headB.status === "open"
          || data.heads.headC.status === "open"
        ),
      );
      return hasOpen ? 4000 : 10000;
    },
    refetchIntervalInBackground: true,
  });
  const anyOpenHead = Boolean(
    (heads.data
      && (heads.data.headA.status === "open" || heads.data.headB.status === "open" || heads.data.headC.status === "open"))
    || (snapshots.data
      && (
        snapshots.data.heads.headA.status === "open"
        || snapshots.data.heads.headB.status === "open"
        || snapshots.data.heads.headC.status === "open"
      )),
  );
  const activeLottery = useQuery({
    queryKey: ["active-lottery"],
    queryFn: fetchActiveLottery,
    retry: 1,
    refetchInterval: 5000,
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
  const charlieHeadCWorkflow = useQuery({
    queryKey: ["charlie-head-c-workflow", charlieHeadCWorkflowId],
    queryFn: () => fetchWorkflow(charlieHeadCWorkflowId),
    enabled: view === "charlie" && Boolean(charlieHeadCWorkflowId),
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return false;
      if (data.status === "running" || data.status === "pending") return 1500;
      if (data.status === "failed" && data.nextRetryAt) return 1500;
      return false;
    },
  });
  const adminIncludeCompleted = adminWorkflowStatusFilter === "__all_including_succeeded";
  const adminStatusFilter = adminWorkflowStatusFilter === "__all_excluding_succeeded"
    || adminWorkflowStatusFilter === "__all_including_succeeded"
    ? undefined
    : adminWorkflowStatusFilter;
  const adminWorkflows = useQuery({
    queryKey: [
      "admin-workflows",
      adminWorkflowStatusFilter,
      adminWorkflowTypeFilter,
      workflowSearchId,
      adminWorkflowPage,
      adminIncludeCompleted,
    ],
    queryFn: () =>
      fetchAdminWorkflows(appRole, {
        status: adminStatusFilter || undefined,
        type: adminWorkflowTypeFilter || undefined,
        idContains: workflowSearchId || undefined,
        page: adminWorkflowPage,
        includeCompleted: adminIncludeCompleted,
      }),
    enabled: view === "admin",
    refetchInterval: 3000,
  });
  useEffect(() => {
    setAdminWorkflowPage(1);
  }, [adminWorkflowStatusFilter, adminWorkflowTypeFilter, workflowSearchId]);

  const connect = useMutation({
    mutationFn: () => fetch("/api/state/heads/mock-connect", { method: "POST" }).then((r) => r.json()),
    onSuccess: () => heads.refetch(),
  });

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    setWalletConnectorError(null);
    if (view === "charlie") {
      void fetchCharlieAddress(appRole)
        .then((charlieAddress) => {
          setWalletSession(null);
          setAddress(charlieAddress);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : "Failed to load Charlie funds address";
          setWalletConnectorError(message);
        });
      return;
    }
    restoreWalletSessionWithFallback(defaultActor)
      .then((session) => {
        if (!session) return;
        if (session.actor !== defaultActor) return;
        if (!isTestnetAddress(session.changeAddress)) {
          setWalletSession(null);
          setAddress("no wallet connected");
          setWalletConnectorError("Wallet is connected on mainnet. Switch wallet network to testnet.");
          return;
        }
        setWalletSession(session);
        setAddress(session.changeAddress);
      })
      .catch(() => {
        // Keep UI usable even if wallet restore fails.
      });
  }, [appRole, defaultActor, view]);
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
    if (view !== "admin") return;
    setPendingLotteryReconcile(loadPendingLotteryReconcile());
  }, [view]);
  useEffect(() => {
    if (view !== "admin") return;
    savePendingLotteryReconcile(pendingLotteryReconcile);
  }, [pendingLotteryReconcile, view]);
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
        if (!isTestnetAddress(walletSession.changeAddress)) {
          throw new Error("Wallet is connected on mainnet. Switch wallet network to testnet.");
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
        const actor = actionActor;
        const walletAddress = actor === "charlie"
          ? address
          : walletSession?.changeAddress;
        if (!walletAddress || walletAddress === "no wallet connected") {
          throw new Error(actor === "charlie" ? "Charlie funds address is not ready." : "Connect a wallet first.");
        }
        if (actor !== "charlie" && !isTestnetAddress(walletAddress)) {
          throw new Error("Wallet is connected on mainnet. Switch wallet network to testnet.");
        }
        setHtlcPairGenerateError(null);
        let nextPreimage = "";
        let nextHash = "";
        try {
          const generated = generateHtlcPairClient();
          nextPreimage = generated.preimage;
          nextHash = generated.htlcHash;
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown error";
          setHtlcPairGenerateError(message);
          throw new Error(`Failed to generate HTLC pair automatically: ${message}`);
        }
        setPreimage(nextPreimage);
        setHtlcHash(nextHash);
        setHtlcPairs(saveHtlcPair(nextPreimage, nextHash));
        const intent = getOrCreateBuyTicketIdempotencyKey(
          actor,
          walletAddress,
          nextHash,
          timeoutMinutes,
        );
        setBuyTicketIdempotencyKey(intent.idempotencyKey);
        if (actor === "charlie") {
          const displayedTicketCost = activeLottery.data?.ticketCostLovelace?.trim() ?? "";
          if (!/^\d+$/.test(displayedTicketCost)) {
            throw new Error("Active lottery ticket cost is unavailable for Charlie buy ticket.");
          }
          return createWorkflow("/api/workflows/buy-ticket", {
            actor,
            idempotencyKey: intent.idempotencyKey,
            address: walletAddress,
            amountLovelace: displayedTicketCost,
            htlcHash: nextHash,
            timeoutMinutes,
            preimage: nextPreimage,
          })
            .then((pendingWf) => {
              setWorkflowId(pendingWf.workflowId);
              bindBuyTicketIntentWorkflow(intent.fingerprint, pendingWf.workflowId);
              if (pendingWf.idempotencyKey) setBuyTicketIdempotencyKey(pendingWf.idempotencyKey);
              return submitCharlieBuyTicketTx(appRole, { htlcHash: nextHash, timeoutMinutes });
            })
            .then((submitted) =>
              createWorkflow("/api/workflows/buy-ticket", {
                actor,
                idempotencyKey: intent.idempotencyKey,
                address: submitted.address,
                amountLovelace: submitted.amountLovelace,
                htlcHash: nextHash,
                timeoutMinutes,
                preimage: nextPreimage,
                submittedSourceTxHash: submitted.txHash,
                submittedSourceHtlcRef: submitted.sourceHtlcRef,
              }).then((d) => ({ ...d, fingerprint: intent.fingerprint })),
            );
        }
        if (!walletSession) {
          throw new Error("Connect a wallet first.");
        }
        return prepareBuyTicketTx({
          actor,
          address: walletAddress,
          amountLovelace: "0",
          sourceHead: "headA",
          htlcHash: nextHash,
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
              htlcHash: nextHash,
              timeoutMinutes,
              preimage: nextPreimage,
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
              preimage: nextPreimage,
            }).then((submitted) => ({ submitted, ticketCost })),
          )
          .then(({ submitted, ticketCost }) =>
            createWorkflow("/api/workflows/buy-ticket", {
              actor,
              idempotencyKey: intent.idempotencyKey,
              address: walletAddress,
              amountLovelace: ticketCost,
              htlcHash: nextHash,
              timeoutMinutes,
              preimage: nextPreimage,
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
  const createLotteryOnHeadBMutation = useMutation({
    mutationFn: () =>
      createLotteryOnHeadB(appRole, {
        prizeLovelace: adminLotteryPrizeLovelace.trim(),
        ticketCostLovelace: adminLotteryTicketCostLovelace.trim(),
        closeTimestampMs: adminLotteryCloseTimestampMs.trim() || undefined,
      }),
    onSuccess: () => {
      heads.refetch();
      snapshots.refetch();
      adminWorkflows.refetch();
      activeLottery.refetch();
    },
    onSettled: (data) => {
      if (!data) return;
      if (data.needsReconcile) {
        setPendingLotteryReconcile({ ...data.result, savedAtMs: Date.now() });
      } else {
        setPendingLotteryReconcile(null);
      }
    },
  });
  const reconcileLotteryRegistrationMutation = useMutation({
    mutationFn: (payload: LotteryRegistrationPayload) => reconcileLotteryRegistration(appRole, payload),
    onSuccess: () => {
      heads.refetch();
      snapshots.refetch();
      adminWorkflows.refetch();
      activeLottery.refetch();
      setPendingLotteryReconcile(null);
    },
  });
  const runHeadOperation = useMutation({
    mutationFn: (operation: "open_head_a" | "open_head_b" | "open_heads_ab" | "commit_head_c_charlie" | "commit_head_c_admin") =>
      runAdminHeadOperation(appRole, operation),
    onSuccess: (data) => {
      if (view === "admin") {
        setWorkflowId(data.workflowId);
      }
      if (view === "charlie" && data.operation === "commit_head_c_charlie") {
        setCharlieHeadCWorkflowId(data.workflowId);
      }
      heads.refetch();
      snapshots.refetch();
      adminWorkflows.refetch();
    },
  });
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
    () => connect.isPending || requestFunds.isPending || buyTicket.isPending,
    [connect.isPending, requestFunds.isPending, buyTicket.isPending],
  );
  const requestFundsBusy = useMemo(
    () => connect.isPending || requestFunds.isPending,
    [connect.isPending, requestFunds.isPending],
  );
  const buyTicketBusy = useMemo(
    () => connect.isPending || buyTicket.isPending,
    [connect.isPending, buyTicket.isPending],
  );
  const headsOpen = {
    headA: heads.data?.headA.status === "open",
    headB: heads.data?.headB.status === "open",
    headC: heads.data?.headC.status === "open",
  };
  const snapshotHeadsOpen = {
    headA: snapshots.data?.heads.headA.status === "open",
    headB: snapshots.data?.heads.headB.status === "open",
    headC: snapshots.data?.heads.headC.status === "open",
  };
  const effectiveHeadOpen = {
    headA: headsOpen.headA || snapshotHeadsOpen.headA,
    headB: headsOpen.headB || snapshotHeadsOpen.headB,
    headC: headsOpen.headC || snapshotHeadsOpen.headC,
  };
  const visibleHeads: Array<"headA" | "headB" | "headC"> = view === "user"
    ? ["headA", "headB"]
    : view === "charlie"
      ? ["headB", "headC"]
      : ["headA", "headB", "headC"];
  const hasWalletConnection = view === "charlie"
    ? address !== "no wallet connected"
    : Boolean(walletSession);
  const walletNetworkCompatible = view === "charlie"
    ? true
    : isTestnetAddress(walletSession?.changeAddress);
  const requestFundsDisabledReason = !hasWalletConnection
    ? "Connect a wallet first."
    : !walletNetworkCompatible
      ? "Wallet must be on testnet (addr_test...)."
    : !effectiveHeadOpen.headA
      ? "Head A must be open."
      : actionActor !== "user"
        ? "Request funds is only enabled for connected user wallets."
        : null;
  const buyTicketDisabledReason = !hasWalletConnection
    ? (view === "charlie" ? "Charlie funds address is not ready." : "Connect a wallet first.")
    : !walletNetworkCompatible
      ? "Wallet must be on testnet (addr_test...)."
    : actionActor === "ida"
      ? "Buy ticket is only enabled for user and charlie wallets."
    : (actionActor === "charlie" && (!effectiveHeadOpen.headB || !effectiveHeadOpen.headC))
      ? "Head B and Head C must be open for Charlie buy ticket path."
    : (actionActor === "user" && (!effectiveHeadOpen.headA || !effectiveHeadOpen.headB))
        ? "Head A and Head B must be open for user buy ticket path."
        : null;
  const requestFundsWorkflow = workflow.data?.type === "request_funds" ? workflow.data : null;
  const buyTicketWorkflow = workflow.data?.type === "buy_ticket" ? workflow.data : null;
  const requestFundsLatestEvent = requestFundsWorkflow && requestFundsWorkflow.events.length > 0
    ? requestFundsWorkflow.events[requestFundsWorkflow.events.length - 1]
    : null;
  const buyTicketLatestEvent = buyTicketWorkflow && buyTicketWorkflow.events.length > 0
    ? buyTicketWorkflow.events[buyTicketWorkflow.events.length - 1]
    : null;
  const requestFundsProgress = requestFundsWorkflow ? requestFundsMilestones(requestFundsWorkflow) : [];
  const buyTicketProgress = buyTicketWorkflow ? buyTicketMilestones(buyTicketWorkflow) : [];
  const charlieHeadCCommitWorkflow = charlieHeadCWorkflow.data?.type === "admin_head_operation"
    ? charlieHeadCWorkflow.data
    : null;
  const charlieHeadCCommitLatestEvent = charlieHeadCCommitWorkflow && charlieHeadCCommitWorkflow.events.length > 0
    ? charlieHeadCCommitWorkflow.events[charlieHeadCCommitWorkflow.events.length - 1]
    : null;
  const charlieHeadCCommitProgress = charlieHeadCCommitWorkflow && isHeadCCommitOperationWorkflow(charlieHeadCCommitWorkflow)
    ? headCCommitMilestones(charlieHeadCCommitWorkflow)
    : [];
  const adminHeadCCommitWorkflow = workflow.data
    && workflow.data.type === "admin_head_operation"
    && isHeadCCommitOperationWorkflow(workflow.data)
    ? workflow.data
    : null;
  const adminHeadCCommitLatestEvent = adminHeadCCommitWorkflow && adminHeadCCommitWorkflow.events.length > 0
    ? adminHeadCCommitWorkflow.events[adminHeadCCommitWorkflow.events.length - 1]
    : null;
  const adminHeadCCommitProgress = adminHeadCCommitWorkflow
    ? headCCommitMilestones(adminHeadCCommitWorkflow)
    : [];
  const activeReconcileRecord = createLotteryOnHeadBMutation.isSuccess && createLotteryOnHeadBMutation.data.needsReconcile
    ? { ...createLotteryOnHeadBMutation.data.result, savedAtMs: Date.now() }
    : pendingLotteryReconcile;
  return (
    <PageGrid>
      <HeadMonitoringSection
        heads={heads}
        snapshots={snapshots}
        nowMs={nowMs}
        visibleHeads={visibleHeads}
        anyOpenHead={anyOpenHead}
        onRetryHeads={() => heads.refetch()}
        onRetrySnapshots={() => snapshots.refetch()}
        cardStyle={cardStyle}
      />

      {view !== "admin" ? (
      <Card style={cardStyle}>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle><CardTitleLg>Actions</CardTitleLg></CardTitle>
          </div>
          {view === "user" ? (
            <Row>
              <ConnectWallet
                fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
                isInverted={isDarkTheme}
                mainButtonStyle={{
                  ...walletConnectMainButtonStyle,
                  border: isDarkTheme ? "1px solid #3b82f6" : walletConnectMainButtonStyle.border,
                  background: isDarkTheme ? "#3b82f6" : walletConnectMainButtonStyle.background,
                }}
                modalStyle={walletConnectModalStyle}
                modalHeaderStyle={walletConnectModalHeaderStyle}
                disconnectButtonStyle={walletConnectDisconnectButtonStyle}
                onConnect={(wallet) => {
                  setWalletConnectorError(null);
                  void buildWalletSessionFromEnabledWallet(wallet, defaultActor)
                    .then((session) => {
                      if (!isTestnetAddress(session.changeAddress)) {
                        setWalletSession(null);
                        setAddress("no wallet connected");
                        setWalletConnectorError("Wallet is connected on mainnet. Switch wallet network to testnet.");
                        return;
                      }
                      setWalletSession(session);
                      setAddress(session.changeAddress);
                    })
                    .catch((error) => {
                      const message = error instanceof Error ? error.message : "Failed to initialize wallet session";
                      setWalletConnectorError(message);
                    });
                }}
                onDisconnect={() => {
                  disconnectWallet();
                  setWalletSession(null);
                  setWalletConnectorError(null);
                }}
                onError={(message) => setWalletConnectorError(message)}
              />
            </Row>
          ) : null}
        </CardHeader>
        <CardContent>
        {walletConnectorError ? (
          <Alert variant="destructive" style={alertTop8Style}>Wallet connect failed: {walletConnectorError}</Alert>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          {view === "user" ? (
            <Card>
              <CardHeader>
                <CardTitle>Request Funds</CardTitle>
                <CardDescription>
                  Fixed transfer from Ida to connected user address on Head A.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
                  <div style={{ display: "grid", gap: 16 }}>
                    <div className="space-y-2">
                      <Label>Address</Label>
                      <Input
                        value={address}
                        readOnly
                        disabled
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Request funds amount (in lovelace)</Label>
                      <Input value={REQUEST_FUNDS_FIXED_LOVELACE} readOnly disabled />
                    </div>
                  </div>
                  <Button type="button" onClick={() => requestFunds.mutate()} disabled={requestFundsBusy || Boolean(requestFundsDisabledReason)}>
                    {requestFunds.isPending ? "Requesting Funds..." : "Request Funds"}
                  </Button>
                  {requestFundsWorkflow ? (
                    <div className="rounded-md border p-3">
                      <HelperText>
                        Workflow {requestFundsWorkflow.id} · <strong>{requestFundsWorkflow.status}</strong>
                      </HelperText>
                      <ul className="mt-2 space-y-1 text-sm">
                        {requestFundsProgress.map((milestone) => (
                          <li key={milestone.key}>
                            {milestoneIcon(milestone.state)} {milestone.label}
                          </li>
                        ))}
                      </ul>
                      {requestFundsLatestEvent ? (
                        <HelperText>
                          Latest event: [{requestFundsLatestEvent.level}] {requestFundsLatestEvent.message}
                        </HelperText>
                      ) : null}
                    </div>
                  ) : null}
                </form>
                {requestFunds.isSuccess ? (
                  <Alert style={alertTop6Style}>
                    Request funds submitted successfully.
                  </Alert>
                ) : null}
                {requestFundsDisabledReason ? (
                  <Alert style={alertTop8Style}>
                    Request funds unavailable: {requestFundsDisabledReason}
                  </Alert>
                ) : null}
                {requestFunds.isError ? (
                  <Alert variant="destructive" style={alertErrorBreakStyle}>
                    Request funds failed: {formatInlineError(requestFunds.error.message)}
                  </Alert>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Buy Ticket</CardTitle>
              <CardDescription>
                Build user HTLC on source head and trigger automated Ida bridge flow.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
                <div style={{ display: "grid", gap: 16 }}>
                  <div className="space-y-2">
                    <Label>Address</Label>
                    <Input
                      value={address}
                      readOnly
                      disabled
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Ticket cost (in lovelace)</Label>
                    <Input
                      value={activeLottery.data?.ticketCostLovelace ?? "unavailable"}
                      readOnly
                      disabled
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>HTLC Timeout (minutes)</Label>
                    <Input value={timeoutMinutes} onChange={(e) => setTimeoutMinutes(e.target.value)} />
                  </div>
                </div>
                <div className="grid gap-2 border-t pt-3">
                  <Button type="button" onClick={() => buyTicket.mutate()} disabled={buyTicketBusy || Boolean(buyTicketDisabledReason)}>
                    {buyTicket.isPending ? "Buying Ticket..." : "Buy Ticket"}
                  </Button>
                </div>
                {buyTicketWorkflow ? (
                  <div className="rounded-md border p-3">
                    <HelperText>
                      Workflow {buyTicketWorkflow.id} · <strong>{buyTicketWorkflow.status}</strong>
                    </HelperText>
                    <ul className="mt-2 space-y-1 text-sm">
                      {buyTicketProgress.map((milestone) => (
                        <li key={milestone.key}>
                          {milestone.done ? "✅" : "⏳"} {milestone.label}
                        </li>
                      ))}
                    </ul>
                    {buyTicketLatestEvent ? (
                      <HelperText>
                        Latest event: [{buyTicketLatestEvent.level}] {buyTicketLatestEvent.message}
                      </HelperText>
                    ) : null}
                  </div>
                ) : null}
              </form>
              {buyTicket.isSuccess ? (
                <Alert style={alertTop6Style}>
                  Buy ticket submitted successfully.
                </Alert>
              ) : null}
              {buyTicketDisabledReason ? (
                <Alert style={alertTop6Style}>
                  Buy ticket unavailable: {buyTicketDisabledReason}
                </Alert>
              ) : null}
              {buyTicket.isError ? (
                <Alert variant="destructive" style={alertErrorBreakStyle}>
                  Buy ticket failed: {formatInlineError(buyTicket.error.message)}
                </Alert>
              ) : null}
              {htlcPairGenerateError ? (
                <Alert variant="destructive" style={alertTop6Style}>
                  HTLC pair generation failed: {htlcPairGenerateError}
                </Alert>
              ) : null}
              {activeLottery.isLoading ? (
                <HelperText>Loading active lottery ticket cost...</HelperText>
              ) : null}
              {activeLottery.isError ? (
                <Alert variant="destructive" style={alertTop6Style}>
                  Could not load active lottery ticket cost: {formatInlineError(activeLottery.error.message)}
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          {view === "charlie" ? (
            <Card>
              <CardHeader>
                <CardTitle>Head C Commit</CardTitle>
                <CardDescription>
                  Commit Charlie funds to Head C.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button type="button" variant="secondary" onClick={() => runHeadOperation.mutate("commit_head_c_charlie")} disabled={runHeadOperation.isPending}>
                  {runHeadOperation.isPending ? "Committing Head C..." : "Commit Head C Funds"}
                </Button>
                {charlieHeadCCommitWorkflow ? (
                  <div className="rounded-md border p-3">
                    <HelperText>
                      Workflow {charlieHeadCCommitWorkflow.id} · <strong>{charlieHeadCCommitWorkflow.status}</strong>
                    </HelperText>
                    <ul className="mt-2 space-y-1 text-sm">
                      {charlieHeadCCommitProgress.map((milestone) => (
                        <li key={milestone.key}>
                          {milestone.done ? "✅" : "⏳"} {milestone.label}
                        </li>
                      ))}
                    </ul>
                    {charlieHeadCCommitLatestEvent ? (
                      <HelperText>
                        Latest event: [{charlieHeadCCommitLatestEvent.level}] {describeHeadCCommitLatestEvent(charlieHeadCCommitLatestEvent)}
                      </HelperText>
                    ) : null}
                  </div>
                ) : null}
                {runHeadOperation.isError ? (
                  <Alert variant="destructive" style={alertErrorBreakStyle}>
                    Charlie Head C commit failed: {formatInlineError(runHeadOperation.error.message)}
                  </Alert>
                ) : null}
                {runHeadOperation.isSuccess ? (
                  <Alert style={alertTop6Style}>
                    Charlie Head C commit queued (workflow {runHeadOperation.data.workflowId}).
                  </Alert>
                ) : null}
                {charlieHeadCWorkflow.isError ? (
                  <Alert variant="destructive" style={alertTop6Style}>
                    Could not load Charlie Head C commit workflow: {formatInlineError(charlieHeadCWorkflow.error.message)}
                  </Alert>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
        </CardContent>
      </Card>
      ) : null}

      {view === "admin" ? (
        <Card style={cardStyle}>
          <CardHeader>
            <CardTitle><CardTitleLg>Admin Operations</CardTitleLg></CardTitle>
          </CardHeader>
          <CardContent>
          <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Workflow ID search</Label>
                <Input value={workflowSearchId} onChange={(e) => setWorkflowSearchId(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Workflow status</Label>
                <Select
                  value={adminWorkflowStatusFilter}
                  onValueChange={(value) => setAdminWorkflowStatusFilter(value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="All (excluding succeeded)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all_excluding_succeeded">All (excluding succeeded)</SelectItem>
                    <SelectItem value="__all_including_succeeded">All (including succeeded)</SelectItem>
                    <SelectItem value="pending">pending</SelectItem>
                    <SelectItem value="running">running</SelectItem>
                    <SelectItem value="failed">failed</SelectItem>
                    <SelectItem value="cancelled">cancelled</SelectItem>
                    <SelectItem value="succeeded">succeeded</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Workflow type</Label>
                <Select
                  value={adminWorkflowTypeFilter || "__all"}
                  onValueChange={(value) => setAdminWorkflowTypeFilter(value === "__all" ? "" : value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">All</SelectItem>
                    <SelectItem value="request_funds">request_funds</SelectItem>
                    <SelectItem value="buy_ticket">buy_ticket</SelectItem>
                    <SelectItem value="admin_head_operation">admin_head_operation</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 border-t pt-3">
              <Button type="button" variant="outline" onClick={() => adminWorkflows.refetch()}>
                Refresh Workflow List
              </Button>
              <Button type="button" variant="secondary" onClick={() => reconcile.mutate()} disabled={reconcile.isPending}>
                Run Reconcile
              </Button>
            </div>
          </form>
          {adminWorkflows.isError ? (
            <Alert variant="destructive" style={alertTop8Style}>Admin workflow list failed: {adminWorkflows.error.message}</Alert>
          ) : null}
          {reconcile.isError ? (
            <Alert variant="destructive" style={alertTop8Style}>Reconcile failed: {reconcile.error.message}</Alert>
          ) : null}
          {adminWorkflows.data ? (
            <ListWrap>
              <ListSummary>
                Showing {adminWorkflows.data.workflows.length} of {adminWorkflows.data.total} workflows · page {adminWorkflows.data.page}/{adminWorkflows.data.totalPages}
              </ListSummary>
              <ListUl>
                {adminWorkflows.data.workflows.map((wf) => (
                  <ListItemCard key={wf.id}>
                    <LinkButton
                      onClick={() => setWorkflowId(wf.id)}
                    >
                      {wf.id}
                    </LinkButton>
                    {" · "}{wf.type} · {wf.status} · attempt {wf.attemptCount}/{wf.maxAttempts}
                  </ListItemCard>
                ))}
              </ListUl>
              <div className="mt-3 flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAdminWorkflowPage((p) => Math.max(1, p - 1))}
                  disabled={!adminWorkflows.data.hasPrevPage}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAdminWorkflowPage((p) => p + 1)}
                  disabled={!adminWorkflows.data.hasNextPage}
                >
                  Next
                </Button>
              </div>
            </ListWrap>
          ) : null}
          <SectionSubTitle>Head Operations</SectionSubTitle>
          <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
            <div className="flex flex-wrap gap-2 border-t pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => runHeadOperation.mutate("open_head_a")}
                disabled={runHeadOperation.isPending}
              >
                Open Head A
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => runHeadOperation.mutate("open_head_b")}
                disabled={runHeadOperation.isPending}
              >
                Open Head B
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => runHeadOperation.mutate("open_heads_ab")}
                disabled={runHeadOperation.isPending}
              >
                Open Heads A + B
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => runHeadOperation.mutate("commit_head_c_charlie")}
                disabled={runHeadOperation.isPending}
              >
                Commit Head C (Charlie)
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => runHeadOperation.mutate("commit_head_c_admin")}
                disabled={runHeadOperation.isPending}
              >
                Commit Head C (Admin)
              </Button>
            </div>
          </form>
          {runHeadOperation.isError ? (
            <Alert variant="destructive" style={alertTop8Style}>
              Head operation failed: {runHeadOperation.error.message}
            </Alert>
          ) : null}
          {runHeadOperation.isSuccess ? (
            <Alert style={alertTop8Style}>
              Head operation queued: {runHeadOperation.data.operation} (workflow {runHeadOperation.data.workflowId})
            </Alert>
          ) : null}
          {adminHeadCCommitWorkflow ? (
            <div className="mt-3 rounded-md border p-3">
              <HelperText>
                Head C Commit Workflow {adminHeadCCommitWorkflow.id} · <strong>{adminHeadCCommitWorkflow.status}</strong>
              </HelperText>
              <ul className="mt-2 space-y-1 text-sm">
                {adminHeadCCommitProgress.map((milestone) => (
                  <li key={milestone.key}>
                    {milestone.done ? "✅" : "⏳"} {milestone.label}
                  </li>
                ))}
              </ul>
              {adminHeadCCommitLatestEvent ? (
                <HelperText>
                  Latest event: [{adminHeadCCommitLatestEvent.level}] {describeHeadCCommitLatestEvent(adminHeadCCommitLatestEvent)}
                </HelperText>
              ) : null}
            </div>
          ) : null}

          <SectionSubTitle>Create Lottery on Head B</SectionSubTitle>
          <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Prize (lovelace)</Label>
                <Input value={adminLotteryPrizeLovelace} onChange={(e) => setAdminLotteryPrizeLovelace(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Ticket cost (lovelace)</Label>
                <Input value={adminLotteryTicketCostLovelace} onChange={(e) => setAdminLotteryTicketCostLovelace(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Close timestamp (POSIX ms, optional)</Label>
                <Input
                  value={adminLotteryCloseTimestampMs}
                  onChange={(e) => setAdminLotteryCloseTimestampMs(e.target.value)}
                  placeholder="defaults to now + 30d"
                />
              </div>
            </div>
            <div className="border-t pt-3">
              <Button
                type="button"
                onClick={() => createLotteryOnHeadBMutation.mutate()}
                disabled={createLotteryOnHeadBMutation.isPending || reconcileLotteryRegistrationMutation.isPending}
              >
                Create + Register Lottery
              </Button>
            </div>
          </form>

          {createLotteryOnHeadBMutation.isError ? (
            <Alert variant="destructive" style={alertTop8Style}>Lottery create failed: {createLotteryOnHeadBMutation.error.message}</Alert>
          ) : null}
          {createLotteryOnHeadBMutation.isSuccess ? (
            createLotteryOnHeadBMutation.data.registrationOk ? (
              <Alert style={alertTop8Style}>Lottery created and registered in DB.</Alert>
            ) : (
              <Alert variant="destructive" style={alertTop8Style}>
                Lottery created on-chain, but DB registration failed after {createLotteryOnHeadBMutation.data.result.registration.attempts} attempts.
              </Alert>
            )
          ) : null}
          {activeReconcileRecord ? (
            <div className="mt-2 rounded-md border p-3">
              <HelperText>
                On-chain lottery:
                {" "}
                {activeReconcileRecord.onchain.txHash}
              </HelperText>
              <MutedText>{formatSavedAgo(activeReconcileRecord.savedAtMs, nowMs)}</MutedText>
              {activeReconcileRecord.registration.error ? (
                <Alert variant="destructive" style={alertTop6Style}>
                  {formatInlineError(activeReconcileRecord.registration.error)}
                </Alert>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                className="mt-2"
                onClick={() => reconcileLotteryRegistrationMutation.mutate(activeReconcileRecord.registration.payload)}
                disabled={reconcileLotteryRegistrationMutation.isPending}
              >
                {reconcileLotteryRegistrationMutation.isPending ? "Reconciling..." : "Reconcile Registration"}
              </Button>
            </div>
          ) : null}
          {reconcileLotteryRegistrationMutation.isError ? (
            <Alert variant="destructive" style={alertTop8Style}>
              Reconcile registration failed: {reconcileLotteryRegistrationMutation.error.message}
            </Alert>
          ) : null}
          {reconcileLotteryRegistrationMutation.isSuccess ? (
            <Alert style={alertTop8Style}>
              Registration reconciled successfully.
            </Alert>
          ) : null}
          </CardContent>
        </Card>
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
    </PageGrid>
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
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 12,
  boxShadow: "0 1px 1px rgba(15,23,42,0.04)",
};


const inputStyle: React.CSSProperties = {
  width: "100%",
};

const alertTop8Style: React.CSSProperties = { marginTop: 8 };
const alertTop6Style: React.CSSProperties = { marginTop: 6 };
const alertErrorBreakStyle: React.CSSProperties = { marginTop: 6, overflowWrap: "anywhere", wordBreak: "break-word" };
const walletConnectMainButtonStyle: React.CSSProperties = {
  borderRadius: 8,
  border: "1px solid #2563eb",
  background: "#2563eb",
  color: "#ffffff",
  fontSize: 14,
  fontWeight: 600,
  padding: "8px 12px",
  minHeight: 36,
};
const walletConnectModalStyle: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  boxShadow: "0 12px 30px rgba(15,23,42,0.18)",
};
const walletConnectModalHeaderStyle: React.CSSProperties = {
  borderBottom: "1px solid var(--border)",
  paddingBottom: 10,
  color: "var(--foreground)",
};
const walletConnectDisconnectButtonStyle: React.CSSProperties = {
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--secondary)",
  color: "var(--secondary-foreground)",
};
