import type { HydraHandler } from "../node-hydra-handler";
import { MIN_COMMIT_LOVELACE } from "../node-commit-utils";
import type { Participant, Utxo } from "./types";

/**
 * Require every participant's hydra-node API before Init or commits.
 * Sending Init while a peer is down can strand the head (that peer never observes the on-chain init).
 */
export async function assertAllHydraPeersReachable(
  headLabel: string,
  participants: Participant[],
  coordinator: HydraHandler,
  peerHandlers: HydraHandler[],
): Promise<void> {
  const entries: { name: string; h: HydraHandler }[] = [
    { name: participants[0]!.name, h: coordinator },
    ...participants.slice(1).map((p, i) => ({ name: p.name, h: peerHandlers[i]! })),
  ];
  const failures: string[] = [];
  await Promise.all(
    entries.map(async ({ name, h }) => {
      try {
        await h.getHeadStatus();
      } catch (e) {
        failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),
  );
  if (failures.length > 0) {
    throw new Error(
      `[${headLabel}] Not every hydra-node for this head is reachable; refusing Init/commits until all are up.\n  ${failures.join("\n  ")}`,
    );
  }
}

/**
 * Before the first on-chain Init from Idle, every party must have a picked commit UTxO from `runtime/l1-utxos.json`.
 * Otherwise we would post Init and then be unable to complete commits (e.g. empty snapshot for one party).
 */
export function assertCommitSnapshotReadyForInit(
  headLabel: string,
  participants: Participant[],
  commitUtxos: Array<Utxo | null>,
): void {
  const missing: string[] = [];
  for (let i = 0; i < participants.length; i++) {
    if (commitUtxos[i] === null) {
      const p = participants[i]!;
      missing.push(
        `${p.name}: need ≥2 UTxOs and ≥2 with ≥${MIN_COMMIT_LOVELACE} lovelace (see pickCommitUtxo in node-commit-utils.ts); update runtime/l1-utxos.json or refresh from chain.`,
      );
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `[${headLabel}] Refusing Init until every participant has an eligible commit UTxO:\n  ${missing.join("\n  ")}`,
    );
  }
}
