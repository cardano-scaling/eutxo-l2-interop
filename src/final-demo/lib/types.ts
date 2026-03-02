export type HeadStatus = "connected" | "disconnected" | "idle" | "open" | "closed";

export interface HeadsState {
  headA: { status: HeadStatus; detail?: string };
  headB: { status: HeadStatus; detail?: string };
  headC: { status: HeadStatus; detail?: string };
  updatedAt: string;
}
