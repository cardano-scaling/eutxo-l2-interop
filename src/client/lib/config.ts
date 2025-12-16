export type HydraHeadConfig = {
  name: string;
  route: string;
  headId: string;
  tag: string;
  httpUrl: string;
};

export const hydraHeads: HydraHeadConfig[] = [
  {
    name: "Head A",
    route: "head-a",
    headId: "6f66666c696e652d0000000000000000000000000000000000000000000000000000000000000001",
    tag: "Open",
    httpUrl: "http://localhost:4001",
  },
  {
    name: "Head B",
    route: "head-b",
    headId: "8a45133c696e652d0000000000000000000000000000000000000000000000000000000000000002",
    tag: "Open",
    httpUrl: "http://localhost:4002",
  },
];
