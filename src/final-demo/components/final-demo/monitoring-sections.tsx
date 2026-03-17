import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { HeadReadModel, HeadSnapshotState, SnapshotRow, WorkflowResponse } from "@/components/FinalDemoApp";

type VisibleHead = "headA" | "headB" | "headC";

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
  return (
    <div style={monitorStyles.utxoCard}>
      <div style={monitorStyles.utxoTitleRow}>
        <strong style={monitorStyles.strongText}>{row.label}</strong>
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
            Assets: {row.assets.map((a) => `${a.amount} ${a.unit.slice(0, 10)}...`).join(", ")}
          </div>
        ) : null}
        {row.hasInlineDatum ? (
          <div style={monitorStyles.breakingMeta}>
            with Inline Datum
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SnapshotHeadCard({ title, snapshot }: { title: string; snapshot: HeadSnapshotState }) {
  const visible = snapshot.utxos.slice(0, 8);
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
        <div style={monitorStyles.gridTight}>
          {visible.map((row) => <SnapshotUtxoRow key={row.ref} row={row} />)}
          {snapshot.utxos.length > visible.length ? (
            <p style={monitorStyles.emptyText}>
              +{snapshot.utxos.length - visible.length} more
            </p>
          ) : null}
        </div>
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
  const visibleUtxos = snapshot?.utxos.slice(0, 8) ?? [];

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
          <div style={monitorStyles.gridTight}>
            {visibleUtxos.map((row) => <SnapshotUtxoRow key={row.ref} row={row} />)}
            {snapshot.utxos.length > visibleUtxos.length ? (
              <p style={monitorStyles.emptyText}>+{snapshot.utxos.length - visibleUtxos.length} more</p>
            ) : null}
          </div>
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
  snapshotMeta: { margin: "8px 0 0 0", color: "var(--muted-foreground)", fontSize: 11 },
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

function headGridStyle(visibleHeadCount: number): React.CSSProperties {
  return { ...monitorStyles.gridAuto, gridTemplateColumns: `repeat(${visibleHeadCount}, minmax(0, 1fr))` };
}

function freshnessStyle(stale: boolean): React.CSSProperties {
  return { color: stale ? "var(--chart-3)" : "var(--chart-2)" };
}

function eventItemStyle(level: string): React.CSSProperties {
  return { ...monitorStyles.eventItem, color: eventColor(level) };
}

