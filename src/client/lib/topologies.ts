import { HydraHeadConfig } from "./config";
import { UserName } from "./users";

export type TopologyId = "two-heads" | "single-path" | "hub-and-spoke";

// Actual users (excluding automated intermediaries ida and jon)
export type PaymentUser = 'alice' | 'bob' | 'charlie';

// Payment step in a path
export type PaymentStep = {
  from: {
    name: UserName;  // Can include 'ida' in steps (as intermediary)
    head: string;    // 'a', 'b', 'c', etc.
  };
  to: {
    name: UserName;  // Can include 'ida' in steps (as intermediary)
    head: string;
  };
};

// PaymentPaths only has actual users as keys (not intermediaries)
// Inner record is Partial to allow placeholders for topologies not yet configured
export type PaymentPaths = Partial<Record<PaymentUser, Partial<Record<PaymentUser, PaymentStep[]>>>>

export type TopologyConfig = {
  id: TopologyId;
  name: string;
  description: string;
  heads: HydraHeadConfig[];
  paymentPaths: PaymentPaths;
};

// Two-heads topology
// Head A: alice, ida-1 (ports 4011, 4019)
// Head B: bob, ida-2 (ports 4022, 4029)
const twoHeadsConfig: TopologyConfig = {
  id: "two-heads",
  name: "Two Heads",
  description: "Alice/Ida ↔ Bob/Ida",
  heads: [
    {
      name: "Head A",
      route: "head-a",
      headId: "0000000000000000000000000000000000000000000000000000000000000001",
      tag: "Open",
      nodes: {
        alice: "http://localhost:4011",
        ida: "http://localhost:4019",
      },
    },
    {
      name: "Head B",
      route: "head-b",
      headId: "0000000000000000000000000000000000000000000000000000000000000002",
      tag: "Open",
      nodes: {
        bob: "http://localhost:4022",
        ida: "http://localhost:4029",
      },
    },
  ],
  paymentPaths: {
    alice: {
      bob: [
        { from: { name: 'alice', head: 'a' }, to: { name: 'ida', head: 'a' } },
        { from: { name: 'ida', head: 'b' }, to: { name: 'bob', head: 'b' } }
      ],
    },
    bob: {
      alice: [
        { from: { name: 'bob', head: 'b' }, to: { name: 'ida', head: 'b' } },
        { from: { name: 'ida', head: 'a' }, to: { name: 'alice', head: 'a' } }
      ],
    },
  },
};

// Single-path topology
// Head A: alice, ida-1 (ports 4111, 4119)
// Head B: bob, ida-2, jon-1 (ports 4122, 4129, 4128)
// Head C: charlie, jon-2 (ports 4133, 4138)
const singlePathConfig: TopologyConfig = {
  id: "single-path",
  name: "Single Path",
  description: "Alice/Ida ↔ Bob/Ida/Jon ↔ Charlie/Jon",
  heads: [
    {
      name: "Head A",
      route: "head-a",
      headId: "0000000000000000000000000000000000000000000000000000000000000001",
      tag: "Open",
      nodes: {
        alice: "http://localhost:4111",
        ida: "http://localhost:4119",
      },
    },
    {
      name: "Head B",
      route: "head-b",
      headId: "0000000000000000000000000000000000000000000000000000000000000002",
      tag: "Open",
      nodes: {
        bob: "http://localhost:4122",
        jon: "http://localhost:4128",
        ida: "http://localhost:4129",
      },
    },
    {
      name: "Head C",
      route: "head-c",
      headId: "0000000000000000000000000000000000000000000000000000000000000003",
      tag: "Open",
      nodes: {
        charlie: "http://localhost:4133",
        jon: "http://localhost:4138",
      },
    },
  ],
  paymentPaths: {
    alice: {
      bob: [
        { from: { name: 'alice', head: 'a' }, to: { name: 'ida', head: 'a' } },
        { from: { name: 'ida', head: 'b' }, to: { name: 'bob', head: 'b' } },
      ],
      charlie: [
        { from: { name: 'alice', head: 'a' }, to: { name: 'ida', head: 'a' } },
        { from: { name: 'ida', head: 'b' }, to: { name: 'jon', head: 'b' } },
        { from: { name: 'jon', head: 'c' }, to: { name: 'charlie', head: 'c' } },
      ],
    },
    bob: {
      alice: [
        { from: { name: 'bob', head: 'b' }, to: { name: 'ida', head: 'b' } },
        { from: { name: 'ida', head: 'a' }, to: { name: 'alice', head: 'a' } },
      ],
      charlie: [
        { from: { name: 'bob', head: 'b' }, to: { name: 'jon', head: 'b' } },
        { from: { name: 'jon', head: 'c' }, to: { name: 'charlie', head: 'c' } },
      ],
    },
    charlie: {
      alice: [
        { from: { name: 'charlie', head: 'c' }, to: { name: 'jon', head: 'c' } },
        { from: { name: 'jon', head: 'b' }, to: { name: 'ida', head: 'b' } },
        { from: { name: 'ida', head: 'a' }, to: { name: 'alice', head: 'a' } },
      ],
      bob: [
        { from: { name: 'charlie', head: 'c' }, to: { name: 'jon', head: 'c' } },
        { from: { name: 'jon', head: 'b' }, to: { name: 'bob', head: 'b' } },
      ],
    },
  },
};

// Hub-and-spoke topology
// Head A: alice, ida-1 (ports 4211, 4219)
// Head B: bob, ida-2 (ports 4222, 4229)
// Head C: charlie, ida-3 (ports 4233, 4239)
// Note: Hub head (ida-4, dave-4) is not exposed as a separate head in the UI
const hubAndSpokeConfig: TopologyConfig = {
  id: "hub-and-spoke",
  name: "Hub and Spoke",
  description: "3 spokes: Alice/Ida, Bob/Ida, Charlie/Ida",
  heads: [
    {
      name: "Head A",
      route: "head-a",
      headId: "0000000000000000000000000000000000000000000000000000000000000001",
      tag: "Open",
      nodes: {
        alice: "http://localhost:4211",
        ida: "http://localhost:4219",
      },
    },
    {
      name: "Head B",
      route: "head-b",
      headId: "0000000000000000000000000000000000000000000000000000000000000002",
      tag: "Open",
      nodes: {
        bob: "http://localhost:4222",
        ida: "http://localhost:4229",
      },
    },
    {
      name: "Head C",
      route: "head-c",
      headId: "0000000000000000000000000000000000000000000000000000000000000003",
      tag: "Open",
      nodes: {
        charlie: "http://localhost:4233",
        ida: "http://localhost:4239",
      },
    },
  ],
  paymentPaths: {
    alice: {
      bob: [
        { from: { name: 'alice', head: 'a' }, to: { name: 'ida', head: 'a' } },
        { from: { name: 'ida', head: 'b' }, to: { name: 'bob', head: 'b' } },
      ],
      charlie: [
        { from: { name: 'alice', head: 'a' }, to: { name: 'ida', head: 'a' } },
        { from: { name: 'ida', head: 'c' }, to: { name: 'charlie', head: 'c' } },
      ],
    },
    bob: {
      alice: [
        { from: { name: 'bob', head: 'b' }, to: { name: 'ida', head: 'b' } },
        { from: { name: 'ida', head: 'a' }, to: { name: 'alice', head: 'a' } },
      ],
      charlie: [
        { from: { name: 'bob', head: 'b' }, to: { name: 'ida', head: 'b' } },
        { from: { name: 'ida', head: 'c' }, to: { name: 'charlie', head: 'c' } },
      ],
    },
    charlie: {
      alice: [
        { from: { name: 'charlie', head: 'c' }, to: { name: 'ida', head: 'c' } },
        { from: { name: 'ida', head: 'a' }, to: { name: 'alice', head: 'a' } },
      ],
      bob: [
        { from: { name: 'charlie', head: 'c' }, to: { name: 'ida', head: 'c' } },
        { from: { name: 'ida', head: 'b' }, to: { name: 'bob', head: 'b' } },
      ],
    },
  },
};

export const TOPOLOGIES: Record<TopologyId, TopologyConfig> = {
  "two-heads": twoHeadsConfig,
  "single-path": singlePathConfig,
  "hub-and-spoke": hubAndSpokeConfig,
};

export function getTopologyConfig(id: TopologyId): TopologyConfig {
  return TOPOLOGIES[id];
}

export function getAllTopologies(): TopologyConfig[] {
  return Object.values(TOPOLOGIES);
}

/**
 * Find payment path from one user/head to another
 * Returns null if no path is found
 */
export function findPaymentPath(
  topology: TopologyConfig | null,
  fromUser: PaymentUser,
  fromHead: `head-${"a" | "b" | "c"}`,
  toUser: PaymentUser,
  toHead: `head-${"a" | "b" | "c"}`
): PaymentStep[] | null {
  if (!topology) return null;
  // Get the head letter (e.g., 'head-a' -> 'a')
  const fromHeadLetter = fromHead.replace('head-', '');
  const toHeadLetter = toHead.replace('head-', '');
  
  // Look up path in nested structure (only actual users as keys)
  const userPaths = topology.paymentPaths[fromUser];
  if (!userPaths) return null;
  
  const steps = userPaths[toUser];
  if (!steps) return null;
  
  // Validate that the path matches the requested heads
  // First step should start from fromHead, last step should end at toHead
  if (steps.length === 0) return null;
  
  const firstStep = steps[0];
  const lastStep = steps[steps.length - 1];
  
  if (firstStep.from.head !== fromHeadLetter || lastStep.to.head !== toHeadLetter) {
    return null;
  }
  
  return steps;
}

/**
 * Check if a payment step is automated (initiated by an intermediary like ida or jon)
 */
export function isAutomatedStep(step: PaymentStep): boolean {
  const automatedIntermediaries: UserName[] = ['ida', 'jon'];
  return automatedIntermediaries.includes(step.from.name);
}

/**
 * Check if a payment step receiver is an automated intermediary (ida or jon)
 */
export function isIntermediaryReceiver(step: PaymentStep): boolean {
  const automatedIntermediaries: UserName[] = ['ida', 'jon'];
  return automatedIntermediaries.includes(step.to.name);
}
