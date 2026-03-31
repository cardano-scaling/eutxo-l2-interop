import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { HeadReadModel, HeadSnapshotState, SnapshotRow, WorkflowResponse } from "@/components/FinalDemoApp";

type VisibleHead = "headA" | "headB" | "headC";
const UTXO_LAZY_PAGE_SIZE = 24;
const SNAPSHOT_LABEL_YOU_SUFFIX = " (you)";

function lovelaceToAdaLabel(lovelace: string): string {
  try {
    return `${(Number(BigInt(lovelace)) / 1_000_000).toFixed(2)} ADA`;
  } catch {
    return `${lovelace} lovelace`;
  }
}

function shortenRef(ref: string): string {
  if (ref.length <= 18) return ref;
  return `${ref.slice(0, 10)}...${ref.slice(-6)}`;
}

function shortenAddress(address: string): string {
  if (address.length <= 14) return address;
  return `${address.slice(0, 12)}...${address.slice(-4)}`;
}

function splitAssetUnit(unit: string): { policyId: string; tokenName: string } {
  if (!/^[0-9a-f]+$/i.test(unit)) {
    return { policyId: unit, tokenName: "-" };
  }
  const policyId = unit.slice(0, 56);
  const tokenName = unit.slice(56);
  return {
    policyId: policyId || unit,
    tokenName: tokenName || "-",
  };
}

function shortenAssetUnit(unit: string): string {
  if (unit.length <= 14) return unit;
  return `${unit.slice(0, 10)}...`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function datumPrimitive(value: unknown): string {
  if (value == null) return "-";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const record = asRecord(value);
  if (!record) return JSON.stringify(value);
  if (typeof record.bech32 === "string") return record.bech32;
  if (typeof record.int === "number" || typeof record.int === "bigint" || typeof record.int === "string") {
    return String(record.int);
  }
  if (typeof record.bytes === "string") return record.bytes;
  if (typeof record.bool === "boolean") return String(record.bool);
  if (typeof record.constructor === "number") {
    if (record.constructor === 0) return "false";
    if (record.constructor === 1) return "true";
  }
  return JSON.stringify(value);
}

function formatUnixMs(value: string): string {
  if (!/^\d+$/.test(value)) return value;
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return value;
  return `${new Date(ms).toLocaleString()} (${value})`;
}

function extractLotteryDatumFields(inlineDatum: unknown): Array<{ label: string; value: string }> | null {
  const obj = asRecord(inlineDatum);
  if (!obj) return null;
  const directKeys = ["prize", "ticket_cost", "paid_winner", "close_timestamp", "admin"];
  const hasDirectShape = directKeys.every((k) => k in obj);
  if (hasDirectShape) {
    const prize = datumPrimitive(obj.prize);
    const ticketCost = datumPrimitive(obj.ticket_cost);
    const paidWinner = datumPrimitive(obj.paid_winner);
    const closeTimestampRaw = datumPrimitive(obj.close_timestamp);
    const admin = datumPrimitive(obj.admin);
    return [
      { label: "Prize", value: prize },
      { label: "Ticket Cost", value: ticketCost },
      { label: "Paid Winner", value: paidWinner },
      { label: "Close Timestamp", value: formatUnixMs(closeTimestampRaw) },
      { label: "Admin", value: admin },
    ];
  }
  const fields = Array.isArray(obj.fields) ? obj.fields : null;
  if (!fields || fields.length < 5) return null;
  const prize = datumPrimitive(fields[0]);
  const ticketCost = datumPrimitive(fields[1]);
  const paidWinner = datumPrimitive(fields[2]);
  const closeTimestampRaw = datumPrimitive(fields[3]);
  const admin = datumPrimitive(fields[4]);
  return [
    { label: "Prize", value: prize },
    { label: "Ticket Cost", value: ticketCost },
    { label: "Paid Winner", value: paidWinner },
    { label: "Close Timestamp", value: formatUnixMs(closeTimestampRaw) },
    { label: "Admin", value: admin },
  ];
}

function extractLotteryTicketSummary(inlineDatum: unknown): { buyerAddress: string; lotteryId: string } | null {
  const obj = asRecord(inlineDatum);
  if (!obj) return null;
  const summary = asRecord(obj.__ticketSummary);
  if (!summary) return null;
  const buyerAddressRaw = typeof summary.buyerAddress === "string"
    ? summary.buyerAddress
    : typeof summary.desiredOutputAddress === "string"
      ? summary.desiredOutputAddress
      : null;
  if (!buyerAddressRaw || typeof summary.lotteryId !== "string") return null;
  const buyerAddress = buyerAddressRaw.trim();
  const lotteryId = summary.lotteryId.trim();
  if (!buyerAddress || !lotteryId) return null;
  return { buyerAddress, lotteryId };
}

function extractHtlcSummary(inlineDatum: unknown): {
  hash: string;
  timeoutMs: string;
  senderPkh: string;
  receiverPkh: string;
  desiredOutputAddress: string;
  desiredLovelace: string;
  hasDesiredDatum: boolean;
} | null {
  const obj = asRecord(inlineDatum);
  if (!obj) return null;
  const summary = asRecord(obj.__htlcSummary);
  if (!summary) return null;
  if (
    typeof summary.hash !== "string"
    || typeof summary.timeoutMs !== "string"
    || typeof summary.senderPkh !== "string"
    || typeof summary.receiverPkh !== "string"
    || typeof summary.desiredOutputAddress !== "string"
    || typeof summary.desiredLovelace !== "string"
    || typeof summary.hasDesiredDatum !== "boolean"
  ) {
    return null;
  }
  return {
    hash: summary.hash,
    timeoutMs: summary.timeoutMs,
    senderPkh: summary.senderPkh,
    receiverPkh: summary.receiverPkh,
    desiredOutputAddress: summary.desiredOutputAddress,
    desiredLovelace: summary.desiredLovelace,
    hasDesiredDatum: summary.hasDesiredDatum,
  };
}

function parseEventMeta(metaJson?: string | null): Record<string, unknown> | null {
  if (!metaJson) return null;
  try {
    const parsed = JSON.parse(metaJson) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function displayWorkflowEvent(event: { level: string; message: string; metaJson?: string | null }) {
  const meta = parseEventMeta(event.metaJson);
  const reason = typeof meta?.reason === "string" ? meta.reason : null;
  const isWaitingEvent = event.message.toLowerCase().includes("waiting");
  const level = isWaitingEvent ? "wait" : event.level;
  const text = isWaitingEvent && reason ? reason : event.message;
  return { level, text };
}

function eventColor(level: string): string {
  if (level === "error") return "var(--destructive)";
  if (level === "warn") return "var(--chart-3)";
  if (level === "wait") return "var(--chart-4)";
  return "var(--foreground)";
}

function HeadCard(
  { title, head, nowMs, staleThresholdMs }: { title: string; head: HeadReadModel; nowMs: number; staleThresholdMs: number },
) {
  const ageMs = Math.max(0, nowMs - new Date(head.updatedAt).getTime());
  const isStale = ageMs > staleThresholdMs;
  const badgeVariant = head.status === "open" ? "default" : head.status === "closed" ? "secondary" : "outline";
  return (
    <Card style={monitorStyles.nestedCard}>
      <CardContent style={monitorStyles.nestedCardContent}>
      <div style={monitorStyles.rowBetween}>
        <h3 style={monitorStyles.headTitle}>{title}</h3>
        <Badge variant={badgeVariant}>
          {head.status}
        </Badge>
      </div>
      <p style={monitorStyles.headDetail}>
        {head.detail || "-"} {isStale ? "· stale data" : ""}
      </p>
      <p style={monitorStyles.metaText}>
        Updated: {new Date(head.updatedAt).toLocaleTimeString()} ({Math.floor(ageMs / 1000)}s ago)
      </p>
      </CardContent>
    </Card>
  );
}

function SnapshotUtxoRow({ row }: { row: SnapshotRow }) {
  const lotteryDatumFields = row.label === "lottery" && row.inlineDatum
    ? extractLotteryDatumFields(row.inlineDatum)
    : null;
  const lotteryTicketSummary = row.label === "lottery_ticket" && row.inlineDatum
    ? extractLotteryTicketSummary(row.inlineDatum)
    : null;
  const htlcSummary = row.label === "htlc_script" && row.inlineDatum
    ? extractHtlcSummary(row.inlineDatum)
    : null;
  return (
    <div style={monitorStyles.utxoCard}>
      <div style={monitorStyles.utxoTitleRow}>
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: "0.2em", minWidth: 0, flexWrap: "wrap" }}>
          {renderSnapshotUtxoLabel(row.label)}
        </span>
        <span style={monitorStyles.valueText}>{lovelaceToAdaLabel(row.lovelace)}</span>
      </div>
      <div style={monitorStyles.utxoMetaStack}>
        <div style={monitorStyles.breakingMeta}>
          Ref: {shortenRef(row.ref)}
        </div>
        <div style={monitorStyles.breakingMeta}>
          Address: {shortenAddress(row.address)}
        </div>
        {row.assets.length > 0 ? (
          <div style={monitorStyles.assetText}>
            Assets:{" "}
            <TooltipProvider>
              {row.assets.map((asset, index) => {
                const split = splitAssetUnit(asset.unit);
                return (
                  <span key={`${asset.unit}_${index}`}>
                    {index > 0 ? ", " : null}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span style={monitorStyles.assetUnitTrigger}>
                          {asset.amount} {shortenAssetUnit(asset.unit)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" align="start" style={monitorStyles.inlineDatumTooltip}>
                        <div style={monitorStyles.inlineDatumGrid}>
                          <div style={monitorStyles.inlineDatumRow}>
                            <span style={monitorStyles.inlineDatumLabel}>Policy ID:</span>
                            <span style={monitorStyles.inlineDatumValue}>{split.policyId}</span>
                          </div>
                          <div style={monitorStyles.inlineDatumRow}>
                            <span style={monitorStyles.inlineDatumLabel}>Token Name:</span>
                            <span style={monitorStyles.inlineDatumValue}>{split.tokenName}</span>
                          </div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </span>
                );
              })}
            </TooltipProvider>
          </div>
        ) : null}
        {row.hasInlineDatum ? (
          <div style={monitorStyles.breakingMeta}>
            {row.label === "lottery" && row.inlineDatum ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span style={monitorStyles.inlineDatumTrigger}>with Inline Datum</span>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="start" style={monitorStyles.inlineDatumTooltip}>
                    {lotteryDatumFields ? (
                      <div style={monitorStyles.inlineDatumGrid}>
                        {lotteryDatumFields.map((field) => (
                          <div key={field.label} style={monitorStyles.inlineDatumRow}>
                            <span style={monitorStyles.inlineDatumLabel}>{field.label}:</span>
                            <span style={monitorStyles.inlineDatumValue}>{field.value}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <pre style={monitorStyles.inlineDatumPre}>
                        {JSON.stringify(row.inlineDatum, null, 2)}
                      </pre>
                    )}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : row.label === "lottery_ticket" && lotteryTicketSummary ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span style={monitorStyles.inlineDatumTrigger}>with Inline Datum</span>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="start" style={monitorStyles.inlineDatumTooltip}>
                    <div style={monitorStyles.inlineDatumGrid}>
                      <div style={monitorStyles.inlineDatumRow}>
                        <span style={monitorStyles.inlineDatumLabel}>Buyer Address:</span>
                        <span style={monitorStyles.inlineDatumValue}>{lotteryTicketSummary.buyerAddress}</span>
                      </div>
                      <div style={monitorStyles.inlineDatumRow}>
                        <span style={monitorStyles.inlineDatumLabel}>Lottery ID:</span>
                        <span style={monitorStyles.inlineDatumValue}>{lotteryTicketSummary.lotteryId}</span>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : row.label === "htlc_script" && htlcSummary ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span style={monitorStyles.inlineDatumTrigger}>with Inline Datum</span>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="start" style={monitorStyles.inlineDatumTooltip}>
                    <div style={monitorStyles.inlineDatumGrid}>
                      <div style={monitorStyles.inlineDatumRow}>
                        <span style={monitorStyles.inlineDatumLabel}>Hash:</span>
                        <span style={monitorStyles.inlineDatumValue}>{htlcSummary.hash}</span>
                      </div>
                      <div style={monitorStyles.inlineDatumRow}>
                        <span style={monitorStyles.inlineDatumLabel}>Timeout:</span>
                        <span style={monitorStyles.inlineDatumValue}>{formatUnixMs(htlcSummary.timeoutMs)}</span>
                      </div>
                      <div style={monitorStyles.inlineDatumRow}>
                        <span style={monitorStyles.inlineDatumLabel}>Sender PKH:</span>
                        <span style={monitorStyles.inlineDatumValue}>{htlcSummary.senderPkh}</span>
                      </div>
                      <div style={monitorStyles.inlineDatumRow}>
                        <span style={monitorStyles.inlineDatumLabel}>Receiver PKH:</span>
                        <span style={monitorStyles.inlineDatumValue}>{htlcSummary.receiverPkh}</span>
                      </div>
                      <div style={monitorStyles.inlineDatumRow}>
                        <span style={monitorStyles.inlineDatumLabel}>Desired Address:</span>
                        <span style={monitorStyles.inlineDatumValue}>{htlcSummary.desiredOutputAddress}</span>
                      </div>
                      <div style={monitorStyles.inlineDatumRow}>
                        <span style={monitorStyles.inlineDatumLabel}>Desired Lovelace:</span>
                        <span style={monitorStyles.inlineDatumValue}>{htlcSummary.desiredLovelace}</span>
                      </div>
                      <div style={monitorStyles.inlineDatumRow}>
                        <span style={monitorStyles.inlineDatumLabel}>Desired Datum:</span>
                        <span style={monitorStyles.inlineDatumValue}>{htlcSummary.hasDesiredDatum ? "present" : "null"}</span>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              "with Inline Datum"
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LazyUtxoList({ utxos }: { utxos: SnapshotRow[] }) {
  const [visibleCount, setVisibleCount] = useState(UTXO_LAZY_PAGE_SIZE);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Keep user's current scroll position stable across snapshot polls.
    // Only clamp/expand the render window based on current list size.
    setVisibleCount((prev) => {
      const minWindow = UTXO_LAZY_PAGE_SIZE;
      const maxWindow = Math.max(minWindow, utxos.length);
      return Math.min(Math.max(prev, minWindow), maxWindow);
    });
  }, [utxos.length]);

  const handleScroll = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 120;
    if (!nearBottom) return;
    setVisibleCount((prev) => Math.min(prev + UTXO_LAZY_PAGE_SIZE, utxos.length));
  }, [utxos.length]);

  const visible = useMemo(
    () => utxos.slice(0, visibleCount),
    [utxos, visibleCount],
  );

  return (
    <div ref={scrollerRef} onScroll={handleScroll} style={monitorStyles.utxoScrollList}>
      <div style={monitorStyles.gridTight}>
        {visible.map((row) => <SnapshotUtxoRow key={row.ref} row={row} />)}
        {visible.length < utxos.length ? (
          <p style={monitorStyles.emptyText}>
            Scroll to load more ({visible.length}/{utxos.length})
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SnapshotHeadCard({ title, snapshot }: { title: string; snapshot: HeadSnapshotState }) {
  return (
    <Card style={monitorStyles.nestedCard}>
      <CardContent style={monitorStyles.nestedCardContent}>
      <h3 style={monitorStyles.headTitleBlock}>{title}</h3>
      <p style={monitorStyles.statusLine}>
        Status: <strong>{snapshot.status}</strong>
      </p>
      {snapshot.error ? (
        <p style={monitorStyles.errorBlock}>
          {snapshot.error}
        </p>
      ) : null}
      {snapshot.utxos.length === 0 ? (
        <p style={monitorStyles.emptyText}>No UTxOs to display.</p>
      ) : (
        <LazyUtxoList utxos={snapshot.utxos} />
      )}
      <p style={monitorStyles.snapshotMeta}>
        Snapshot: {new Date(snapshot.fetchedAt).toLocaleTimeString()}
      </p>
      </CardContent>
    </Card>
  );
}

function UnifiedHeadMonitoringCard({
  title,
  head,
  snapshot,
  nowMs,
  staleThresholdMs,
  anyOpenHead,
  snapshotsLoading,
  snapshotsErrorMessage,
}: {
  title: string;
  head: HeadReadModel;
  snapshot: HeadSnapshotState | null;
  nowMs: number;
  staleThresholdMs: number;
  anyOpenHead: boolean;
  snapshotsLoading: boolean;
  snapshotsErrorMessage: string | null;
}) {
  const ageMs = Math.max(0, nowMs - new Date(head.updatedAt).getTime());
  const isStale = ageMs > staleThresholdMs;
  const badgeVariant = head.status === "open" ? "default" : head.status === "closed" ? "secondary" : "outline";
  const visibleUtxos = snapshot?.utxos ?? [];

  return (
    <Card style={monitorStyles.nestedCard}>
      <CardContent style={monitorStyles.nestedCardContent}>
        <div style={monitorStyles.rowBetween}>
          <h1 style={monitorStyles.headTitle}>{title}</h1>
          <Badge variant={badgeVariant}>
            {head.status}
          </Badge>
        </div>
        <p style={monitorStyles.statusLine}>
          Status: <strong>{head.status}</strong>
        </p>
        <p style={monitorStyles.metaText}>
          Updated: {new Date(head.updatedAt).toLocaleTimeString()} ({Math.floor(ageMs / 1000)}s ago)
        </p>

        <h2 style={monitorStyles.utxoSectionTitle}>Snapshot UTxOs</h2>
        {!anyOpenHead ? (
          <p style={monitorStyles.emptyText}>Open at least one head to fetch snapshots.</p>
        ) : null}
        {anyOpenHead && snapshotsLoading ? (
          <p style={monitorStyles.emptyText}>Loading snapshots...</p>
        ) : null}
        {anyOpenHead && snapshotsErrorMessage ? (
          <p style={monitorStyles.errorBlock}>{snapshotsErrorMessage}</p>
        ) : null}
        {snapshot?.error ? (
          <p style={monitorStyles.errorBlock}>{snapshot.error}</p>
        ) : null}
        {!snapshot && anyOpenHead && !snapshotsLoading && !snapshotsErrorMessage ? (
          <p style={monitorStyles.emptyText}>Snapshot unavailable.</p>
        ) : null}
        {snapshot && !snapshot.error && visibleUtxos.length === 0 ? (
          <p style={monitorStyles.emptyText}>No UTxOs to display.</p>
        ) : null}
        {snapshot && !snapshot.error && visibleUtxos.length > 0 ? (
          <LazyUtxoList utxos={visibleUtxos} />
        ) : null}
        {snapshot ? (
          <p style={monitorStyles.snapshotMeta}>
            Snapshot: {new Date(snapshot.fetchedAt).toLocaleTimeString()}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function HeadStateSection({
  heads,
  nowMs,
  visibleHeads,
  onRetry,
  cardStyle,
}: {
  heads: {
    isLoading: boolean;
    isError: boolean;
    error?: Error | null;
    data?: {
      headA: HeadReadModel;
      headB: HeadReadModel;
      headC: HeadReadModel;
      updatedAt: string;
      staleThresholdMs: number;
    };
  };
  nowMs: number;
  visibleHeads: VisibleHead[];
  onRetry: () => void;
  cardStyle: React.CSSProperties;
}) {
  const headsStale = heads.data
    ? (nowMs - new Date(heads.data.updatedAt).getTime()) > heads.data.staleThresholdMs
    : false;
  return (
    <Card style={cardStyle}>
      <CardHeader style={monitorStyles.cardHeaderTight}>
        <CardTitle style={monitorStyles.cardTitle}>Head State</CardTitle>
      </CardHeader>
      <CardContent>
      {heads.isLoading ? <p>Loading head state...</p> : null}
      {heads.isError ? (
        <div style={monitorStyles.gridWithGap8}>
          <Alert variant="destructive">Failed to load head state: {heads.error?.message}</Alert>
          <div>
            <Button variant="outline" onClick={onRetry}>Retry Head State</Button>
          </div>
        </div>
      ) : null}
      {heads.data ? (
        <>
          <p style={monitorStyles.lastUpdateText}>
            Last update: {new Date(heads.data.updatedAt).toLocaleString()} ({Math.floor(Math.max(0, nowMs - new Date(heads.data.updatedAt).getTime()) / 1000)}s ago)
            {" · "}
            <strong style={freshnessStyle(headsStale)}>
              {headsStale ? "STALE" : "FRESH"}
            </strong>
          </p>
          <div style={headGridStyle(visibleHeads.length)}>
            {visibleHeads.includes("headA")
              ? <HeadCard title="Head A" head={heads.data.headA} nowMs={nowMs} staleThresholdMs={heads.data.staleThresholdMs} />
              : null}
            {visibleHeads.includes("headB")
              ? <HeadCard title="Head B" head={heads.data.headB} nowMs={nowMs} staleThresholdMs={heads.data.staleThresholdMs} />
              : null}
            {visibleHeads.includes("headC")
              ? <HeadCard title="Head C" head={heads.data.headC} nowMs={nowMs} staleThresholdMs={heads.data.staleThresholdMs} />
              : null}
          </div>
        </>
      ) : null}
      </CardContent>
    </Card>
  );
}

export function SnapshotSection({
  snapshots,
  visibleHeads,
  cardStyle,
}: {
  snapshots: {
    isLoading: boolean;
    isError: boolean;
    error?: Error | null;
    data?: {
      heads: {
        headA: HeadSnapshotState;
        headB: HeadSnapshotState;
        headC: HeadSnapshotState;
      };
    };
  };
  visibleHeads: VisibleHead[];
  cardStyle: React.CSSProperties;
}) {
  return (
    <Card style={cardStyle}>
      <CardHeader style={monitorStyles.cardHeaderTight}>
        <CardTitle style={monitorStyles.cardTitle}>Head Snapshot UTxOs</CardTitle>
      </CardHeader>
      <CardContent>
      <p style={monitorStyles.lastUpdateText}>
        Live UTxOs mapped to known actor/script names.
      </p>
      {snapshots.isLoading ? <p style={monitorStyles.emptyText}>Loading snapshots...</p> : null}
      {snapshots.isError ? (
        <Alert variant="destructive">Failed to load snapshots: {snapshots.error?.message}</Alert>
      ) : null}
      {snapshots.data ? (
        <div style={headGridStyle(visibleHeads.length)}>
          {visibleHeads.includes("headA") ? <SnapshotHeadCard title="Head A" snapshot={snapshots.data.heads.headA} /> : null}
          {visibleHeads.includes("headB") ? <SnapshotHeadCard title="Head B" snapshot={snapshots.data.heads.headB} /> : null}
          {visibleHeads.includes("headC") ? <SnapshotHeadCard title="Head C" snapshot={snapshots.data.heads.headC} /> : null}
        </div>
      ) : null}
      </CardContent>
    </Card>
  );
}

export function HeadMonitoringSection({
  heads,
  snapshots,
  nowMs,
  visibleHeads,
  anyOpenHead,
  onRetryHeads,
  onRetrySnapshots,
  cardStyle,
}: {
  heads: {
    isLoading: boolean;
    isError: boolean;
    error?: Error | null;
    data?: {
      headA: HeadReadModel;
      headB: HeadReadModel;
      headC: HeadReadModel;
      updatedAt: string;
      staleThresholdMs: number;
    };
  };
  snapshots: {
    isLoading: boolean;
    isError: boolean;
    error?: Error | null;
    data?: {
      heads: {
        headA: HeadSnapshotState;
        headB: HeadSnapshotState;
        headC: HeadSnapshotState;
      };
    };
  };
  nowMs: number;
  visibleHeads: VisibleHead[];
  anyOpenHead: boolean;
  onRetryHeads: () => void;
  onRetrySnapshots: () => void;
  cardStyle: React.CSSProperties;
}) {
  const headsStale = heads.data
    ? (nowMs - new Date(heads.data.updatedAt).getTime()) > heads.data.staleThresholdMs
    : false;
  const snapshotErrorMessage = snapshots.isError ? `Failed to load snapshots: ${snapshots.error?.message}` : null;

  return (
    <Card style={cardStyle}>
      <CardHeader style={monitorStyles.cardHeaderTight}>
        <CardTitle style={monitorStyles.cardTitle}>Hydra Heads State</CardTitle>
      </CardHeader>
      <CardContent>
        {heads.isLoading ? <p>Loading head state...</p> : null}
        {heads.isError ? (
          <div style={monitorStyles.gridWithGap8}>
            <Alert variant="destructive">Failed to load head state: {heads.error?.message}</Alert>
            <div>
              <Button variant="outline" onClick={onRetryHeads}>Retry Head State</Button>
            </div>
          </div>
        ) : null}
        {heads.data ? (
          <>
            <p style={monitorStyles.lastUpdateText}>
              Last update: {new Date(heads.data.updatedAt).toLocaleString()} (
              {Math.floor(Math.max(0, nowMs - new Date(heads.data.updatedAt).getTime()) / 1000)}s ago)
              {" · "}
              <strong style={freshnessStyle(headsStale)}>
                {headsStale ? "STALE" : "FRESH"}
              </strong>
            </p>
            <div style={headGridStyle(visibleHeads.length)}>
              {visibleHeads.includes("headA")
                ? (
                  <UnifiedHeadMonitoringCard
                    title="Head A"
                    head={heads.data.headA}
                    snapshot={snapshots.data?.heads.headA ?? null}
                    nowMs={nowMs}
                    staleThresholdMs={heads.data.staleThresholdMs}
                    anyOpenHead={anyOpenHead}
                    snapshotsLoading={snapshots.isLoading}
                    snapshotsErrorMessage={snapshotErrorMessage}
                  />
                )
                : null}
              {visibleHeads.includes("headB")
                ? (
                  <UnifiedHeadMonitoringCard
                    title="Head B"
                    head={heads.data.headB}
                    snapshot={snapshots.data?.heads.headB ?? null}
                    nowMs={nowMs}
                    staleThresholdMs={heads.data.staleThresholdMs}
                    anyOpenHead={anyOpenHead}
                    snapshotsLoading={snapshots.isLoading}
                    snapshotsErrorMessage={snapshotErrorMessage}
                  />
                )
                : null}
              {visibleHeads.includes("headC")
                ? (
                  <UnifiedHeadMonitoringCard
                    title="Head C"
                    head={heads.data.headC}
                    snapshot={snapshots.data?.heads.headC ?? null}
                    nowMs={nowMs}
                    staleThresholdMs={heads.data.staleThresholdMs}
                    anyOpenHead={anyOpenHead}
                    snapshotsLoading={snapshots.isLoading}
                    snapshotsErrorMessage={snapshotErrorMessage}
                  />
                )
                : null}
            </div>
          </>
        ) : null}
        {snapshots.isError ? (
          <div style={monitorStyles.gridWithGap8}>
            <Alert variant="destructive">Failed to load snapshots: {snapshots.error?.message}</Alert>
            <div>
              <Button variant="outline" onClick={onRetrySnapshots}>Retry Snapshots</Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function WorkflowTimelineSection({
  workflowId,
  workflow,
  nowMs,
  view,
  onRetry,
  cardStyle,
}: {
  workflowId: string;
  workflow: { data?: WorkflowResponse };
  nowMs: number;
  view: "user" | "charlie" | "admin";
  onRetry: () => void;
  cardStyle: React.CSSProperties;
}) {
  return (
    <Card style={cardStyle}>
      <CardHeader style={monitorStyles.cardHeaderTight}>
        <CardTitle style={monitorStyles.cardTitle}>Workflow Timeline</CardTitle>
      </CardHeader>
      <CardContent>
      <p style={monitorStyles.timelineCurrent}>
        Current workflow: {workflowId || "none"}
      </p>
      {workflow.data ? (
        <>
          <p style={monitorStyles.metaLine}>
            Type: <strong>{workflow.data.type}</strong>
          </p>
          <p style={monitorStyles.metaLineTop0}>
            Status: <strong>{workflow.data.status}</strong>{" "}
            (attempt {workflow.data.attemptCount}/{workflow.data.maxAttempts})
          </p>
          {workflow.data.status === "failed" && workflow.data.nextRetryAt ? (
            <Alert>
              Retry scheduled in{" "}
              {Math.max(0, Math.floor((new Date(workflow.data.nextRetryAt).getTime() - nowMs) / 1000))}s
              {" · "}
              next retry at {new Date(workflow.data.nextRetryAt).toLocaleTimeString()}
            </Alert>
          ) : null}
          {workflow.data.status === "cancelled" ? (
            <Alert variant="destructive">
              Terminal failure: {workflow.data.lastErrorCode ?? "WORKFLOW_ERROR"}
              {workflow.data.errorMessage ? ` - ${workflow.data.errorMessage}` : ""}
            </Alert>
          ) : null}
          {(workflow.data.status === "failed" || workflow.data.status === "cancelled") && view === "admin" ? (
            <Button variant="destructive" onClick={onRetry}>Retry Workflow</Button>
          ) : null}
          <h3 style={monitorStyles.sectionTitle}>Steps</h3>
          <ul style={monitorStyles.list}>
            {workflow.data.steps.map((step) => (
              <li key={step.id} style={monitorStyles.listItem}>{step.name} - {step.status} (attempt {step.attempt})</li>
            ))}
          </ul>
          <h3 style={monitorStyles.sectionTitle}>Events</h3>
          <ul style={monitorStyles.list}>
            {workflow.data.events.map((event) => {
              const rendered = displayWorkflowEvent(event);
              return (
                <li
                  key={event.id}
                  style={eventItemStyle(rendered.level)}
                >
                  [{rendered.level}] {rendered.text} ({new Date(event.createdAt).toLocaleTimeString()})
                </li>
              );
            })}
          </ul>
          {workflow.data.resultJson ? (
            <>
              <h3>Result</h3>
              <pre
                style={monitorStyles.pre}
              >
                {workflow.data.resultJson}
              </pre>
            </>
          ) : null}
        </>
      ) : (
        <p>No workflow selected yet.</p>
      )}
      </CardContent>
    </Card>
  );
}

const monitorStyles: Record<string, React.CSSProperties> = {
  nestedCard: { border: "1px solid var(--border)", borderRadius: 10 },
  nestedCardContent: { paddingTop: 10 },
  rowBetween: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" },
  headTitle: { margin: 0, fontSize: 26, marginBottom: 8, fontWeight: 700, color: "var(--primary)" },
  headTitleBlock: { margin: "0 0 6px 0", fontSize: 15, color: "var(--primary)" },
  headDetail: { margin: "7px 0 4px 0", color: "var(--foreground)", fontSize: 13 },
  metaText: { margin: "0 0 14px 0", color: "var(--muted-foreground)", fontSize: 12 },
  utxoCard: { border: "1px solid var(--border)", borderRadius: 8, padding: "8px 9px", background: "var(--card)", fontSize: 12 },
  strongText: { color: "var(--foreground)", fontSize: 16, fontWeight: 700, lineHeight: 1, margin: 0 },
  valueText: { color: "var(--foreground)", fontWeight: 600, lineHeight: 1, margin: 0 },
  utxoTitleRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 },
  utxoMetaStack: { display: "grid", gap: 2, marginTop: 1 },
  breakingMeta: { margin: 0, lineHeight: 1.2, color: "var(--muted-foreground)", overflowWrap: "anywhere", wordBreak: "break-word" },
  assetText: { margin: 0, lineHeight: 1.2, color: "var(--muted-foreground)", overflowWrap: "anywhere", wordBreak: "break-word" },
  assetUnitTrigger: {
    textDecoration: "underline dotted",
    cursor: "help",
  },
  inlineDatumTrigger: {
    textDecoration: "underline dotted",
    cursor: "help",
  },
  inlineDatumTooltip: {
    maxWidth: 440,
    border: "1px solid var(--border)",
    background: "var(--popover)",
    color: "var(--popover-foreground)",
  },
  inlineDatumGrid: {
    display: "grid",
    gap: 4,
    minWidth: 300,
  },
  inlineDatumRow: {
    display: "grid",
    gridTemplateColumns: "120px 1fr",
    gap: 8,
    alignItems: "start",
  },
  inlineDatumLabel: {
    color: "var(--muted-foreground)",
    fontWeight: 600,
  },
  inlineDatumValue: {
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 12,
  },
  inlineDatumPre: {
    margin: 0,
    maxHeight: 220,
    overflow: "auto",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 12,
  },
  statusLine: { margin: "0 0 6px 0" },
  utxoSectionTitle: { margin: "10px 0 6px 0", fontSize: 20, marginBottom: 12, fontWeight: 700, color: "var(--foreground)" },
  errorBlock: {
    margin: "0 0 6px 0",
    color: "var(--destructive)",
    fontSize: 12,
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    background: "var(--card)",
    border: "1px solid var(--destructive)",
    borderRadius: 8,
    padding: "5px 7px",
  },
  emptyText: { margin: 0, color: "var(--muted-foreground)", fontSize: 12 },
  gridTight: { display: "grid", gap: 6 },
  utxoScrollList: {
    maxHeight: 360,
    overflowY: "auto",
    paddingRight: 4,
  },
  snapshotMeta: { margin: "8px 0 0 0", color: "var(--muted-foreground)", fontSize: 11 },
  /** Matches secondary copy in head state (e.g. “…s ago”) — smaller than UTxO title. */
  snapshotLabelYouSuffix: {
    color: "var(--muted-foreground)",
    fontSize: 11,
    fontWeight: 500,
    lineHeight: 1.2,
  },
  cardHeaderTight: { paddingBottom: 0 },
  cardTitle: { fontSize: 24 },
  lastUpdateText: { marginTop: 0, marginBottom: 14, color: "var(--muted-foreground)", fontSize: 13 },
  gridAuto: { display: "grid", gap: 10 },
  gridWithGap8: { display: "grid", gap: 8 },
  timelineCurrent: { overflowWrap: "anywhere", wordBreak: "break-word", color: "var(--muted-foreground)", fontSize: 13 },
  metaLine: { marginBottom: 4 },
  metaLineTop0: { marginTop: 0, marginBottom: 8 },
  sectionTitle: { marginBottom: 6 },
  list: { marginTop: 0, paddingLeft: 18 },
  listItem: { marginBottom: 4 },
  eventItem: {
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    marginBottom: 6,
    background: "var(--muted)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "5px 8px",
    listStyle: "none",
  },
  pre: { fontSize: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word" },
};

function renderSnapshotUtxoLabel(label: string): ReactNode {
  if (label.endsWith(SNAPSHOT_LABEL_YOU_SUFFIX)) {
    const base = label.slice(0, -SNAPSHOT_LABEL_YOU_SUFFIX.length);
    return (
      <>
        <strong style={monitorStyles.strongText}>{base}</strong>
        <span style={monitorStyles.snapshotLabelYouSuffix}> (you)</span>
      </>
    );
  }
  return <strong style={monitorStyles.strongText}>{label}</strong>;
}

function headGridStyle(visibleHeadCount: number): React.CSSProperties {
  return { ...monitorStyles.gridAuto, gridTemplateColumns: `repeat(${visibleHeadCount}, minmax(0, 1fr))` };
}

function freshnessStyle(stale: boolean): React.CSSProperties {
  return { color: stale ? "var(--chart-3)" : "var(--chart-2)" };
}

function eventItemStyle(level: string): React.CSSProperties {
  return { ...monitorStyles.eventItem, color: eventColor(level) };
}

