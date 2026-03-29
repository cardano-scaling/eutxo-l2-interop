import { HydraHandler } from "../node-hydra-handler";
import { commitParticipant, loadPrivateKeyHex } from "../node-commit-utils";
import type { Participant, Utxo } from "./types";

export async function commitHeadCParticipant(
  participant: Participant,
  counterpart: Participant,
  commitUtxo: Utxo | null,
): Promise<void> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Partial init head C: committing ${participant.name} funds`);
  console.log("=".repeat(60));
  const statusHandler = new HydraHandler(participant.api);
  let status: "Idle" | "Initial" | "Open" | "Closed" | "FanoutPossible" | "Final";
  try {
    status = await statusHandler.initIfNeeded();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Timeout waiting for HeadIsInitializing")) {
      statusHandler.stop();
      throw error;
    }
    const current = await statusHandler.getHeadStatus();
    if (current === "Initial" || current === "Open") {
      status = current;
      console.log(`Head C status already ${current}; continuing without re-init.`);
    } else {
      statusHandler.stop();
      throw error;
    }
  }
  if (status === "Open") {
    console.log("Head C already open.");
    statusHandler.stop();
    return;
  }
  statusHandler.stop();
  if (!commitUtxo) {
    if (status === "Initial") {
      const openWatcher = new HydraHandler(counterpart.api);
      try {
        try {
          await openWatcher.listen("HeadIsOpen", 30_000);
          console.log("Head C is now open.");
          return;
        } catch {
          console.log(
            "Head C is initializing but no eligible commit UTxO was found for this participant. Waiting for counterpart/open completion.",
          );
          return;
        }
      } finally {
        openWatcher.stop();
      }
    }
    throw new Error(
      `HEAD_C_COMMIT_PRECONDITION_FAILED: ${participant.name} needs at least 2 eligible UTxOs (one kept as Hydra fuel, one for commit).`,
    );
  }
  const skHex = await loadPrivateKeyHex(participant.skPath);
  try {
    await commitParticipant(participant.name, participant.api, skHex, commitUtxo);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("NoFuelUTXOFound")) {
      throw error;
    }
    const statusProbe = new HydraHandler(participant.api);
    try {
      const current = await statusProbe.getHeadStatus();
      if (current === "Initial" || current === "Open") {
        console.log(`Commit input already consumed; Head C status is ${current}. Treating as idempotent success.`);
      } else {
        throw error;
      }
    } finally {
      statusProbe.stop();
    }
  }

  const openWatcher = new HydraHandler(counterpart.api);
  try {
    const counterpartStatus = await openWatcher.getHeadStatus();
    if (counterpartStatus === "Open") {
      console.log("Head C is now open.");
      return;
    }
    if (counterpartStatus === "Initial") {
      try {
        await openWatcher.listen("HeadIsOpen", 30_000);
        console.log("Head C is now open.");
        return;
      } catch {
        // Keep partial success semantics when counterpart has not committed yet.
      }
    }
  } finally {
    openWatcher.stop();
  }

  console.log(`Head C partial init complete (${participant.name} commit submitted). Waiting for counterpart commit.`);
}
