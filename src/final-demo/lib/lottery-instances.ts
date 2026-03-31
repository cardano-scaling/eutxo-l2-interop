import { prisma } from "./db";

export type SupportedLotteryHead = "headA" | "headB" | "headC";

export type ActiveLotteryInstance = {
  id: string;
  headName: SupportedLotteryHead;
  assetUnit: string;
  policyId: string;
  tokenNameHex: string;
  mintTxHash: string;
  contractAddress: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
};

type LotteryRecord = {
  id: string;
  headName: string;
  policyId: string;
  tokenNameHex: string;
  mintTxHash: string;
  contractAddress: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
};

function normalizeHex(input: string, label: string): string {
  const normalized = input.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(normalized)) {
    throw new Error(`${label} must be lowercase hex`);
  }
  return normalized;
}

function assertHead(headName: string): SupportedLotteryHead {
  if (headName !== "headA" && headName !== "headB" && headName !== "headC") {
    throw new Error(`Unsupported headName: ${headName}`);
  }
  return headName;
}

function assertHeadBOnly(headName: string): "headB" {
  if (headName !== "headB") {
    throw new Error("Only headB can hold an active lottery");
  }
  return "headB";
}

function mapRow(row: LotteryRecord): ActiveLotteryInstance {
  const policyId = row.policyId.toLowerCase();
  const tokenNameHex = row.tokenNameHex.toLowerCase();
  return {
    id: row.id,
    headName: assertHead(row.headName),
    assetUnit: `${policyId}${tokenNameHex}`,
    policyId,
    tokenNameHex,
    mintTxHash: row.mintTxHash.toLowerCase(),
    contractAddress: row.contractAddress,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    closedAt: row.closedAt,
  };
}

export async function getActiveLotteryForHead(headName: SupportedLotteryHead): Promise<ActiveLotteryInstance | null> {
  assertHeadBOnly(headName);
  const row = await prisma.lotteryInstance.findFirst({
    where: {
      headName,
      status: "active",
    },
    orderBy: {
      createdAt: "desc",
    },
  });
  if (!row) return null;
  return mapRow(row);
}

export async function registerActiveLotteryForHead(input: {
  headName: SupportedLotteryHead;
  policyId: string;
  tokenNameHex: string;
  mintTxHash: string;
  contractAddress: string;
}): Promise<ActiveLotteryInstance> {
  assertHeadBOnly(input.headName);
  const policyId = normalizeHex(input.policyId, "policyId");
  if (policyId.length !== 56) {
    throw new Error("policyId must be 56 hex chars");
  }
  const tokenNameHex = normalizeHex(input.tokenNameHex, "tokenNameHex");
  const mintTxHash = normalizeHex(input.mintTxHash, "mintTxHash");
  const id = crypto.randomUUID();
  const now = new Date();

  const activeCount = await prisma.lotteryInstance.count({
    where: {
      status: "active",
    },
  });
  if (activeCount > 0) {
    throw new Error("Cannot register a new lottery while another active lottery exists");
  }

  const created = await prisma.lotteryInstance.create({
    data: {
      id,
      headName: input.headName,
      policyId,
      tokenNameHex,
      mintTxHash,
      contractAddress: input.contractAddress,
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
  });
  return mapRow(created);
}

