import type { PreparedBuyTicketDraft } from "./ops-types";

const DRAFT_TTL_MS = Number(process.env.HYDRA_OPS_DRAFT_TTL_MS ?? 5 * 60 * 1000);
const drafts = new Map<string, PreparedBuyTicketDraft>();

function pruneExpiredDrafts(nowMs: number) {
  for (const [id, draft] of drafts.entries()) {
    if (draft.expiresAtMs <= nowMs) {
      drafts.delete(id);
    }
  }
}

export function putDraft(draft: PreparedBuyTicketDraft): PreparedBuyTicketDraft {
  const nowMs = Date.now();
  pruneExpiredDrafts(nowMs);
  drafts.set(draft.id, draft);
  return draft;
}

export function createDraft(
  input: Omit<PreparedBuyTicketDraft, "id" | "createdAtMs" | "expiresAtMs">,
): PreparedBuyTicketDraft {
  const nowMs = Date.now();
  const draft: PreparedBuyTicketDraft = {
    id: crypto.randomUUID(),
    createdAtMs: nowMs,
    expiresAtMs: nowMs + DRAFT_TTL_MS,
    ...input,
  };
  return putDraft(draft);
}

export function takeDraft(id: string): PreparedBuyTicketDraft | null {
  const nowMs = Date.now();
  pruneExpiredDrafts(nowMs);
  const draft = drafts.get(id);
  if (!draft) return null;
  drafts.delete(id);
  return draft;
}
