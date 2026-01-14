import { HydraHeadConfig } from "./config";

export type TopologyId = "two-heads" | "single-path" | "hub-and-spoke";

export type TopologyConfig = {
  id: TopologyId;
  name: string;
  description: string;
  heads: HydraHeadConfig[];
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
      httpUrl: "http://localhost:4011",
    },
    {
      name: "Head B",
      route: "head-b",
      headId: "0000000000000000000000000000000000000000000000000000000000000002",
      tag: "Open",
      httpUrl: "http://localhost:4022",
    },
  ],
};

// Single-path topology
// Head A: alice, ida-1 (ports 4111, 4119)
// Head B: ida-2, bob-1 (ports 4129, 4122)
// Head C: bob-2, charlie (ports 4132, 4133)
const singlePathConfig: TopologyConfig = {
  id: "single-path",
  name: "Single Path",
  description: "Alice/Ida ↔ Ida/Bob ↔ Bob/Charlie",
  heads: [
    {
      name: "Head A",
      route: "head-a",
      headId: "0000000000000000000000000000000000000000000000000000000000000001",
      tag: "Open",
      httpUrl: "http://localhost:4111",
    },
    {
      name: "Head B",
      route: "head-b",
      headId: "0000000000000000000000000000000000000000000000000000000000000002",
      tag: "Open",
      httpUrl: "http://localhost:4129",
    },
    {
      name: "Head C",
      route: "head-c",
      headId: "0000000000000000000000000000000000000000000000000000000000000003",
      tag: "Open",
      httpUrl: "http://localhost:4132",
    },
  ],
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
      httpUrl: "http://localhost:4211",
    },
    {
      name: "Head B",
      route: "head-b",
      headId: "0000000000000000000000000000000000000000000000000000000000000002",
      tag: "Open",
      httpUrl: "http://localhost:4222",
    },
    {
      name: "Head C",
      route: "head-c",
      headId: "0000000000000000000000000000000000000000000000000000000000000003",
      tag: "Open",
      httpUrl: "http://localhost:4233",
    },
  ],
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

