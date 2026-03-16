import { Button } from "@/components/ui/button";
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
  if (level === "error") return "#b91c1c";
  if (level === "warn") return "#b45309";
  if (level === "wait") return "#a16207";
  return "#334155";
}

function HeadCard(
  { title, head, nowMs, staleThresholdMs }: { title: string; head: HeadReadModel; nowMs: number; staleThresholdMs: number },
) {
  const ageMs = Math.max(0, nowMs - new Date(head.updatedAt).getTime());
  const isStale = ageMs > staleThresholdMs;
  const statusTone = head.status === "open" ? "#065f46" : head.status === "closed" ? "#374151" : "#92400e";
  const statusBg = head.status === "open" ? "#d1fae5" : head.status === "closed" ? "#f3f4f6" : "#fef3c7";
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: 15, color: "#6366f1" }}>{title}</h3>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: statusTone,
            background: statusBg,
            border: `1px solid ${statusTone}44`,
            borderRadius: 999,
            padding: "2px 8px",
            textTransform: "uppercase",
            letterSpacing: "0.03em",
          }}
        >
          {head.status}
        </span>
      </div>
      <p style={{ margin: "7px 0 4px 0", color: "#374151", fontSize: 13 }}>
        {head.detail || "-"} {isStale ? "· stale data" : ""}
      </p>
      <p style={{ margin: 0, color: "#6b7280", fontSize: 12 }}>
        Updated: {new Date(head.updatedAt).toLocaleTimeString()} ({Math.floor(ageMs / 1000)}s ago)
      </p>
    </div>
  );
}

function SnapshotUtxoRow({ row }: { row: SnapshotRow }) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: "8px 9px",
        background: "#fff",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <strong style={{ color: "#1f2937" }}>{row.label}</strong>
        <span style={{ color: "#111827", fontWeight: 600 }}>{lovelaceToAdaLabel(row.lovelace)}</span>
      </div>
      <div style={{ color: "#6b7280", overflowWrap: "anywhere", wordBreak: "break-word" }}>
        Ref: {shortenRef(row.ref)}
      </div>
      <div style={{ color: "#6b7280", overflowWrap: "anywhere", wordBreak: "break-word" }}>
        {row.hasInlineDatum ? " with Inline Datum" : ""}
      </div>
      <div style={{ color: "#6b7280", overflowWrap: "anywhere", wordBreak: "break-word" }}>
        Address: {shortenAddress(row.address)}
      </div>
      {row.assets.length > 0 ? (
        <div style={{ marginTop: 2, color: "#4b5563", overflowWrap: "anywhere", wordBreak: "break-word" }}>
          Assets: {row.assets.map((a) => `${a.amount} ${a.unit.slice(0, 10)}...`).join(", ")}
        </div>
      ) : null}
    </div>
  );
}

function SnapshotHeadCard({ title, snapshot }: { title: string; snapshot: HeadSnapshotState }) {
  const visible = snapshot.utxos.slice(0, 8);
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10, background: "#fff" }}>
      <h3 style={{ margin: "0 0 6px 0", fontSize: 15, color: "#6366f1" }}>{title}</h3>
      <p style={{ margin: "0 0 6px 0" }}>
        Status: <strong>{snapshot.status}</strong>
      </p>
      {snapshot.error ? (
        <p style={{ margin: "0 0 6px 0", color: "#b91c1c", fontSize: 12, overflowWrap: "anywhere", wordBreak: "break-word", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "5px 7px" }}>
          {snapshot.error}
        </p>
      ) : null}
      {snapshot.utxos.length === 0 ? (
        <p style={{ margin: 0, color: "#71717a", fontSize: 12 }}>No UTxOs to display.</p>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {visible.map((row) => <SnapshotUtxoRow key={row.ref} row={row} />)}
          {snapshot.utxos.length > visible.length ? (
            <p style={{ margin: 0, color: "#71717a" }}>
              +{snapshot.utxos.length - visible.length} more
            </p>
          ) : null}
        </div>
      )}
      <p style={{ margin: "8px 0 0 0", color: "#6b7280", fontSize: 11 }}>
        Snapshot: {new Date(snapshot.fetchedAt).toLocaleTimeString()}
      </p>
    </div>
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
  return (
    <section style={cardStyle}>
      <h2 style={{ marginTop: 0 }}>Head State</h2>
      {heads.isLoading ? <p>Loading head state...</p> : null}
      {heads.isError ? (
        <div style={{ display: "grid", gap: 8 }}>
          <p style={{ color: "#b91c1c", margin: 0 }}>Failed to load head state: {heads.error?.message}</p>
          <div>
            <Button variant="outline" onClick={onRetry}>Retry Head State</Button>
          </div>
        </div>
      ) : null}
      {heads.data ? (
        <>
          <p style={{ marginTop: 0, color: "#475569", fontSize: 13 }}>
            Last update: {new Date(heads.data.updatedAt).toLocaleString()} ({Math.floor(Math.max(0, nowMs - new Date(heads.data.updatedAt).getTime()) / 1000)}s ago)
            {" · "}
            <strong style={{ color: (nowMs - new Date(heads.data.updatedAt).getTime()) > heads.data.staleThresholdMs ? "#b45309" : "#166534" }}>
              {(nowMs - new Date(heads.data.updatedAt).getTime()) > heads.data.staleThresholdMs ? "STALE" : "FRESH"}
            </strong>
          </p>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: `repeat(${visibleHeads.length}, minmax(0, 1fr))` }}>
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
    </section>
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
    <section style={cardStyle}>
      <h2 style={{ marginTop: 0 }}>Head Snapshot UTxOs</h2>
      <p style={{ marginTop: 0, color: "#475569", fontSize: 13 }}>
        Live UTxOs mapped to known actor/script names.
      </p>
      {snapshots.isLoading ? <p style={{ margin: 0 }}>Loading snapshots...</p> : null}
      {snapshots.isError ? (
        <p style={{ margin: 0, color: "#b91c1c" }}>Failed to load snapshots: {snapshots.error?.message}</p>
      ) : null}
      {snapshots.data ? (
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: `repeat(${visibleHeads.length}, minmax(0, 1fr))` }}>
          {visibleHeads.includes("headA") ? <SnapshotHeadCard title="Head A" snapshot={snapshots.data.heads.headA} /> : null}
          {visibleHeads.includes("headB") ? <SnapshotHeadCard title="Head B" snapshot={snapshots.data.heads.headB} /> : null}
          {visibleHeads.includes("headC") ? <SnapshotHeadCard title="Head C" snapshot={snapshots.data.heads.headC} /> : null}
        </div>
      ) : null}
    </section>
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
    <section style={cardStyle}>
      <h2 style={{ marginTop: 0 }}>Workflow Timeline</h2>
      <p style={{ overflowWrap: "anywhere", wordBreak: "break-word", color: "#475569", fontSize: 13 }}>
        Current workflow: {workflowId || "none"}
      </p>
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
          {(workflow.data.status === "failed" || workflow.data.status === "cancelled") && view === "admin" ? (
            <Button variant="destructive" onClick={onRetry}>Retry Workflow</Button>
          ) : null}
          <h3 style={{ marginBottom: 6 }}>Steps</h3>
          <ul style={{ marginTop: 0, paddingLeft: 18 }}>
            {workflow.data.steps.map((step) => (
              <li key={step.id} style={{ marginBottom: 4 }}>{step.name} - {step.status} (attempt {step.attempt})</li>
            ))}
          </ul>
          <h3 style={{ marginBottom: 6 }}>Events</h3>
          <ul style={{ marginTop: 0, paddingLeft: 18 }}>
            {workflow.data.events.map((event) => {
              const rendered = displayWorkflowEvent(event);
              return (
                <li
                  key={event.id}
                  style={{
                    overflowWrap: "anywhere",
                    wordBreak: "break-word",
                    color: eventColor(rendered.level),
                    marginBottom: 6,
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    padding: "5px 8px",
                    listStyle: "none",
                  }}
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
                style={{
                  fontSize: 12,
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                }}
              >
                {workflow.data.resultJson}
              </pre>
            </>
          ) : null}
        </>
      ) : (
        <p>No workflow selected yet.</p>
      )}
    </section>
  );
}

