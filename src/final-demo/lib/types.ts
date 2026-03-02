export type HeadStatus = "connected" | "disconnected" | "idle" | "open" | "closed";

export interface HeadReadModel {
  status: HeadStatus;
  detail: string;
  updatedAt: string;
  ageMs: number;
  isStale: boolean;
}

export interface HeadsStateReadModel {
  headA: HeadReadModel;
  headB: HeadReadModel;
  headC: HeadReadModel;
  updatedAt: string;
  ageMs: number;
  isStale: boolean;
  staleThresholdMs: number;
}

export interface ApiErrorEnvelope {
  errorCode: string;
  message: string;
  requestId: string;
}
