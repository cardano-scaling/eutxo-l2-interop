import type { DemoSnapshot, DemoPhase } from "@/lib/types";

interface Props {
  snapshot: DemoSnapshot | null;
}

const COLORS = {
  alice: "#ef4444",   // red-500
  ida: "#14b8a6",     // teal-500
  bob: "#f97316",     // orange-500
  headA: "#6366f1",   // indigo
  headB: "#8b5cf6",   // violet
  l1: "#64748b",      // slate
  script: "#a855f7",  // purple-500
  disputed: "#dc2626", // red-600
};

function statusColor(status: string): string {
  switch (status) {
    case "Open": return "#22c55e";
    case "Closed": case "Final": return "#ef4444";
    case "Idle": return "#94a3b8";
    default: return "#eab308";
  }
}

function lovelaceToAda(utxos: Array<{ assets: Record<string, string> }>): string {
  const total = utxos.reduce((sum, u) => sum + BigInt(u.assets?.lovelace || "0"), 0n);
  return (Number(total) / 1_000_000).toFixed(1);
}

/** Pulsing glow for active elements */
function PulseCircle({ cx, cy, r, color }: { cx: number; cy: number; r: number; color: string }) {
  return (
    <circle cx={cx} cy={cy} r={r} fill={color} opacity="0.3">
      <animate attributeName="r" values={`${r};${r + 6};${r}`} dur="2s" repeatCount="indefinite" />
      <animate attributeName="opacity" values="0.3;0.1;0.3" dur="2s" repeatCount="indefinite" />
    </circle>
  );
}

export function TopologyDiagram({ snapshot }: Props) {
  const phase: DemoPhase = snapshot?.phase || "idle";

  const headAStatus = snapshot?.headA.status || "Unknown";
  const headBStatus = snapshot?.headB.status || "Unknown";

  const wrappedAddr = snapshot?.wrappedAddress || "";
  const headAScriptUtxos = snapshot?.headA.utxos.filter(u => u.address === wrappedAddr) || [];
  const headBScriptUtxos = snapshot?.headB.utxos.filter(u => u.address === wrappedAddr) || [];

  const hasWrappedA = headAScriptUtxos.length > 0;
  const hasWrappedB = headBScriptUtxos.length > 0;

  // Detect disputed from datum (same heuristic as HeadPanel)
  const isDisputed = (utxos: typeof headAScriptUtxos) =>
    utxos.some(u => u.datum?.includes("d87a80"));
  const disputedA = isDisputed(headAScriptUtxos);
  const disputedB = isDisputed(headBScriptUtxos);

  // Phase-based highlights
  const headsActive = ["wrapped", "disputed"].includes(phase);
  const l1Active = ["initializing", "closing", "closed", "merged"].includes(phase);
  const idaBridgeActive = ["wrapped", "disputed"].includes(phase);

  // Head opacity
  const headAOpacity = headAStatus === "Open" ? 1 : headAStatus === "Idle" ? 0.3 : 0.5;
  const headBOpacity = headBStatus === "Open" ? 1 : headBStatus === "Idle" ? 0.3 : 0.5;

  return (
    <svg viewBox="0 0 800 420" className="w-full max-w-4xl mx-auto" style={{ fontFamily: "system-ui, sans-serif" }}>
      {/* Background */}
      <rect width="800" height="420" fill="hsl(var(--background))" rx="12" />

      {/* ── L1 layer ──────────────────────────────────────────── */}
      <rect x="40" y="330" width="720" height="70" rx="10"
        fill="hsl(var(--muted))" stroke={l1Active ? COLORS.l1 : "hsl(var(--border))"}
        strokeWidth={l1Active ? 2.5 : 1.5} opacity="0.8"
      />
      <text x="400" y="350" textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="11" fontWeight="600">
        CARDANO L1
      </text>

      {/* L1 participant balances */}
      <text x="140" y="375" textAnchor="middle" fill={COLORS.alice} fontSize="11" fontWeight="500">
        Alice: {lovelaceToAda(snapshot?.l1.alice || [])} ₳
      </text>
      <text x="400" y="375" textAnchor="middle" fill={COLORS.ida} fontSize="11" fontWeight="500">
        Ida: {lovelaceToAda(snapshot?.l1.ida || [])} ₳
      </text>
      <text x="660" y="375" textAnchor="middle" fill={COLORS.bob} fontSize="11" fontWeight="500">
        Bob: {lovelaceToAda(snapshot?.l1.bob || [])} ₳
      </text>

      {/* Script UTXOs on L1 */}
      {(snapshot?.l1.script.length || 0) > 0 && (
        <text x="400" y="393" textAnchor="middle" fill={COLORS.disputed} fontSize="10" fontWeight="600">
          ⚠ Disputed on L1: {snapshot!.l1.script.length} UTXO(s) — {lovelaceToAda(snapshot!.l1.script)} ₳
        </text>
      )}

      {/* ── Head A ────────────────────────────────────────────── */}
      <rect x="50" y="100" width="300" height="180" rx="12" fill="none"
        stroke={disputedA ? COLORS.disputed : COLORS.headA}
        strokeWidth={headsActive ? 2.5 : 2}
        strokeDasharray={headsActive ? "8 4" : "none"}
        opacity={headAOpacity}
      >
        {headsActive && (
          <animate attributeName="stroke-dashoffset" from="24" to="0" dur="1s" repeatCount="indefinite" />
        )}
      </rect>
      <text x="200" y="125" textAnchor="middle" fill={COLORS.headA} fontSize="13" fontWeight="700">HEAD A</text>
      <circle cx="310" cy="120" r="6" fill={statusColor(headAStatus)} />
      <text x="200" y="142" textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="10">{headAStatus}</text>

      {/* Alice node */}
      {phase === "wrapped" && hasWrappedA && <PulseCircle cx={120} cy={195} r={28} color={COLORS.alice} />}
      <circle cx="120" cy="195" r="28" fill={COLORS.alice} opacity="0.15" stroke={COLORS.alice} strokeWidth="2" />
      <text x="120" y="199" textAnchor="middle" fill={COLORS.alice} fontSize="12" fontWeight="600">Alice</text>

      {/* Ida node in Head A */}
      <circle cx="280" cy="195" r="28" fill={COLORS.ida} opacity="0.15" stroke={COLORS.ida} strokeWidth="2" />
      <text x="280" y="199" textAnchor="middle" fill={COLORS.ida} fontSize="12" fontWeight="600">Ida</text>

      {/* Validator UTXO in Head A */}
      {hasWrappedA && (
        <>
          <rect x="155" y="225" width="90" height="35" rx="6"
            fill={disputedA ? COLORS.disputed : COLORS.script} opacity="0.15"
            stroke={disputedA ? COLORS.disputed : COLORS.script} strokeWidth="1.5"
          />
          <text x="200" y="240" textAnchor="middle"
            fill={disputedA ? COLORS.disputed : COLORS.script} fontSize="9" fontWeight="600">
            {disputedA ? "⚠ Disputed" : "🔒 Wrapped"}
          </text>
          <text x="200" y="253" textAnchor="middle"
            fill={disputedA ? COLORS.disputed : COLORS.script} fontSize="9">
            {lovelaceToAda(headAScriptUtxos)} ₳
          </text>
        </>
      )}

      {/* ── Head B ────────────────────────────────────────────── */}
      <rect x="450" y="100" width="300" height="180" rx="12" fill="none"
        stroke={disputedB ? COLORS.disputed : COLORS.headB}
        strokeWidth={headsActive ? 2.5 : 2}
        strokeDasharray={headsActive ? "8 4" : "none"}
        opacity={headBOpacity}
      >
        {headsActive && (
          <animate attributeName="stroke-dashoffset" from="24" to="0" dur="1s" repeatCount="indefinite" />
        )}
      </rect>
      <text x="600" y="125" textAnchor="middle" fill={COLORS.headB} fontSize="13" fontWeight="700">HEAD B</text>
      <circle cx="710" cy="120" r="6" fill={statusColor(headBStatus)} />
      <text x="600" y="142" textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="10">{headBStatus}</text>

      {/* Ida node in Head B */}
      <circle cx="520" cy="195" r="28" fill={COLORS.ida} opacity="0.15" stroke={COLORS.ida} strokeWidth="2" />
      <text x="520" y="199" textAnchor="middle" fill={COLORS.ida} fontSize="12" fontWeight="600">Ida</text>

      {/* Bob node */}
      {phase === "wrapped" && hasWrappedB && <PulseCircle cx={680} cy={195} r={28} color={COLORS.bob} />}
      <circle cx="680" cy="195" r="28" fill={COLORS.bob} opacity="0.15" stroke={COLORS.bob} strokeWidth="2" />
      <text x="680" y="199" textAnchor="middle" fill={COLORS.bob} fontSize="12" fontWeight="600">Bob</text>

      {/* Validator UTXO in Head B */}
      {hasWrappedB && (
        <>
          <rect x="555" y="225" width="90" height="35" rx="6"
            fill={disputedB ? COLORS.disputed : COLORS.script} opacity="0.15"
            stroke={disputedB ? COLORS.disputed : COLORS.script} strokeWidth="1.5"
          />
          <text x="600" y="240" textAnchor="middle"
            fill={disputedB ? COLORS.disputed : COLORS.script} fontSize="9" fontWeight="600">
            {disputedB ? "⚠ Disputed" : "🔒 Wrapped"}
          </text>
          <text x="600" y="253" textAnchor="middle"
            fill={disputedB ? COLORS.disputed : COLORS.script} fontSize="9">
            {lovelaceToAda(headBScriptUtxos)} ₳
          </text>
        </>
      )}

      {/* ── Ida bridge between heads ─────────────────────────── */}
      <line x1="308" y1="195" x2="492" y2="195"
        stroke={COLORS.ida} strokeWidth="2"
        strokeDasharray={idaBridgeActive ? "8 4" : "6 4"}
        opacity={idaBridgeActive ? 0.8 : 0.4}
      >
        {idaBridgeActive && (
          <animate attributeName="stroke-dashoffset" from="24" to="0" dur="1.5s" repeatCount="indefinite" />
        )}
      </line>
      <text x="400" y="188" textAnchor="middle" fill={COLORS.ida} fontSize="10" fontWeight="500">
        Intermediary
      </text>

      {/* ── Connection lines Head ↔ L1 ───────────────────────── */}
      <line x1="200" y1="280" x2="200" y2="330"
        stroke={l1Active ? COLORS.headA : "hsl(var(--border))"}
        strokeWidth={l1Active ? 2 : 1.5}
        strokeDasharray={l1Active ? "6 3" : "none"}
        opacity={l1Active ? 0.8 : 0.3}
      >
        {l1Active && (
          <animate attributeName="stroke-dashoffset" from="18" to="0" dur="0.8s" repeatCount="indefinite" />
        )}
      </line>

      <line x1="600" y1="280" x2="600" y2="330"
        stroke={l1Active ? COLORS.headB : "hsl(var(--border))"}
        strokeWidth={l1Active ? 2 : 1.5}
        strokeDasharray={l1Active ? "6 3" : "none"}
        opacity={l1Active ? 0.8 : 0.3}
      >
        {l1Active && (
          <animate attributeName="stroke-dashoffset" from="18" to="0" dur="0.8s" repeatCount="indefinite" />
        )}
      </line>

      {/* Flow arrows during closing/merge — downward arrows showing L2→L1 */}
      {(phase === "closing" || phase === "closed") && (
        <>
          <polygon points="195,320 200,330 205,320" fill={COLORS.headA} opacity="0.7" />
          <polygon points="595,320 600,330 605,320" fill={COLORS.headB} opacity="0.7" />
        </>
      )}

      {/* ── Title ─────────────────────────────────────────────── */}
      <text x="400" y="30" textAnchor="middle" fill="hsl(var(--foreground))" fontSize="16" fontWeight="700">
        eUTXO L2 Interop — Two-Head Topology
      </text>

      {/* Phase indicator */}
      <text x="400" y="55" textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="12">
        Phase: <tspan fontWeight="600" fill={
          phase === "disputed" || phase === "closed" ? COLORS.disputed :
          phase === "merged" || phase === "heads_open" ? "#22c55e" :
          "hsl(var(--foreground))"
        }>{phase.replace("_", " ").toUpperCase()}</tspan>
      </text>

      {/* Legend */}
      <g transform="translate(40, 70)">
        <circle cx="0" cy="0" r="5" fill="#22c55e" />
        <text x="10" y="4" fill="hsl(var(--muted-foreground))" fontSize="9">Open</text>
        <circle cx="55" cy="0" r="5" fill="#ef4444" />
        <text x="65" y="4" fill="hsl(var(--muted-foreground))" fontSize="9">Closed</text>
        <circle cx="120" cy="0" r="5" fill="#94a3b8" />
        <text x="130" y="4" fill="hsl(var(--muted-foreground))" fontSize="9">Idle</text>
        <rect x="170" y="-6" width="12" height="12" rx="2" fill={COLORS.script} opacity="0.3" stroke={COLORS.script} strokeWidth="1" />
        <text x="186" y="4" fill="hsl(var(--muted-foreground))" fontSize="9">Wrapped</text>
        <rect x="240" y="-6" width="12" height="12" rx="2" fill={COLORS.disputed} opacity="0.3" stroke={COLORS.disputed} strokeWidth="1" />
        <text x="256" y="4" fill="hsl(var(--muted-foreground))" fontSize="9">Disputed</text>
      </g>
    </svg>
  );
}
