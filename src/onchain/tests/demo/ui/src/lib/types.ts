/** Types shared between frontend and backend */

export interface DemoEvent {
  type: "info" | "success" | "error" | "warn" | "action";
  message: string;
  timestamp: number;
  data?: unknown;
}

export interface ParticipantInfo {
  name: string;
  address: string;
  pkh: string;
}

export interface UtxoInfo {
  txHash: string;
  outputIndex: number;
  assets: Record<string, string>; // serialized bigints
  address: string;
  datum?: string;
}

export interface HeadState {
  status: string;
  utxos: UtxoInfo[];
}

export type DemoPhase =
  | "idle"
  | "initializing"
  | "heads_open"
  | "wrapped"
  | "disputed"
  | "closing"
  | "closed"
  | "merged"
  | "unwrapped";

export interface DemoSnapshot {
  headA: HeadState;
  headB: HeadState;
  l1: {
    alice: UtxoInfo[];
    ida: UtxoInfo[];
    bob: UtxoInfo[];
    script: UtxoInfo[];
  };
  participants: {
    alice: ParticipantInfo;
    ida: ParticipantInfo;
    bob: ParticipantInfo;
  };
  wrappedAddress: string;
  phase: DemoPhase;
  busy: boolean;
  busyAction: string;
}

/**
 * Participant colors — synced with src/client/ sidebar & utxo-item colors
 *   Alice = red, Bob = orange, Ida = teal
 */
export const USER_COLORS = {
  alice: { hex: "#ef4444", bg: "bg-red-50",    border: "border-red-300",    text: "text-red-700",    badge: "bg-red-100 text-red-700" },
  bob:   { hex: "#f97316", bg: "bg-orange-50", border: "border-orange-300", text: "text-orange-700", badge: "bg-orange-100 text-orange-700" },
  ida:   { hex: "#14b8a6", bg: "bg-teal-50",   border: "border-teal-300",   text: "text-teal-700",   badge: "bg-teal-100 text-teal-700" },
} as const;

export const PHASE_LABELS: Record<DemoPhase, string> = {
  idle: "Idle",
  initializing: "Initializing",
  heads_open: "Heads Open",
  wrapped: "Wrapped",
  disputed: "Disputed",
  closing: "Closing…",
  closed: "Closed (L1)",
  merged: "Merged",
  unwrapped: "Unwrapped",
};
