import { getHeadsState } from "./heads";
import { MOCK_WALLETS, type DemoActor } from "./wallet/mock-wallets";

export type FlowHead = "headA" | "headB" | "headC";
export type SourceHead = "headA" | "headC";

function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

const ACTOR_BY_ADDRESS = new Map<string, DemoActor>();
for (const wallet of MOCK_WALLETS) {
  ACTOR_BY_ADDRESS.set(normalizeAddress(wallet.changeAddress), wallet.actor);
  for (const address of wallet.usedAddresses) {
    ACTOR_BY_ADDRESS.set(normalizeAddress(address), wallet.actor);
  }
}

export function resolveActorByAddress(address: string): DemoActor | null {
  return ACTOR_BY_ADDRESS.get(normalizeAddress(address)) ?? null;
}

export function deriveSourceHead(actor: DemoActor): SourceHead {
  return actor === "charlie" ? "headC" : "headA";
}

export function validateRequestFundsActor(actor: string): actor is "user" {
  return actor === "user";
}

export function validateBuyTicketActor(actor: string): actor is "user" | "charlie" {
  return actor === "user" || actor === "charlie";
}

export function requiredHeadsForRequestFunds(): FlowHead[] {
  return ["headA"];
}

export function requiredHeadsForBuyTicket(actor: "user" | "charlie"): FlowHead[] {
  return actor === "charlie" ? ["headB", "headC"] : ["headA", "headB"];
}

export async function getClosedRequiredHeads(requiredHeads: FlowHead[]): Promise<FlowHead[]> {
  const heads = await getHeadsState();
  const byName = {
    headA: heads.headA.status,
    headB: heads.headB.status,
    headC: heads.headC.status,
  } as const;
  return requiredHeads.filter((name) => byName[name] !== "open");
}
