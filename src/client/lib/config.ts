export type HydraHeadConfig = {
  name: string;
  route: string;
  headId: string;
  headSeed: string;
  tag: string;
  httpUrl: string;
};

export const hydraHeads: HydraHeadConfig[] = [
  {
    name: "Head A",
    route: "head-a",
    headId: "bd3c89a5-1111-4d5a-8b6c-111111111111",
    headSeed: "seed-a-000000",
    tag: "Open",
    httpUrl: "http://localhost:4001",
  },
  {
    name: "Head B",
    route: "head-b",
    headId: "8c50efc2-2222-4c3c-aaf1-222222222222",
    headSeed: "seed-b-000000",
    tag: "Open",
    httpUrl: "http://localhost:4002",
  },
];

export const htlcContract = {
  address: "addr_test1qqhtlccontractplaceholder0000000000000000000",
};

export const htlcTransmitterAddress =
  "addr_test1qqhtlctransmitterplaceholder00000000000000000";
