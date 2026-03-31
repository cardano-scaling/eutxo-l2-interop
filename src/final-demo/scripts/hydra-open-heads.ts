import { stat } from "node:fs/promises";
import {
  MIN_COMMIT_LOVELACE,
  pickCommitUtxo,
} from "./lib/node-commit-utils";
import { isCustomNetworkMode } from "../lib/hydra/network";
import { commitHeadCParticipant } from "./lib/hydra-open-heads/commitHeadC";
import { headA, headB, headC, l1ReadyFile } from "./lib/hydra-open-heads/config";
import { installLifecycleRefreshHooks, loadParticipantUtxos, refreshL1Utxos, refreshL1UtxosSafe } from "./lib/hydra-open-heads/l1snapshot";
import { openHead } from "./lib/hydra-open-heads/openHead";
import { runOnceWithRefreshRetry } from "./lib/hydra-open-heads/retry";
import type { Operation } from "./lib/hydra-open-heads/types";

function parseOperation(argv: string[]): Operation {
  if (argv.includes("--open-head-a")) return "open_head_a";
  if (argv.includes("--open-head-b")) return "open_head_b";
  if (argv.includes("--commit-head-c-admin")) return "commit_head_c_admin";
  if (argv.includes("--commit-head-c-charlie")) return "commit_head_c_charlie";
  if (argv.includes("--open-heads-ab")) return "open_heads_ab";
  throw new Error(`Invalid operation: ${argv.join(" ")}. Missing one of the following options: --open-head-a, --open-head-b, --commit-head-c-admin, --commit-head-c-charlie, --open-heads-ab`);
}

async function main(): Promise<void> {
  installLifecycleRefreshHooks();
  if (isCustomNetworkMode()) {
    try {
      await stat(l1ReadyFile);
    } catch {
      console.error(`Infrastructure not ready - missing sentinel ${l1ReadyFile}`);
      process.exit(1);
    }
  }

  try {
    await refreshL1Utxos("startup");

    const operation = parseOperation(process.argv.slice(2));
    const runOnce = async () => {
      const aliceUtxos = await loadParticipantUtxos("alice");
      const bobUtxos = await loadParticipantUtxos("bob");
      const idaUtxos = await loadParticipantUtxos("ida");
      const jonUtxos = await loadParticipantUtxos("jon");
      const charlieUtxos = await loadParticipantUtxos("charlie");

      const idaEligible = idaUtxos.filter((u) => u.assets.lovelace >= MIN_COMMIT_LOVELACE);
      const idaCommitA = idaEligible.length >= 2 ? idaEligible[0] : pickCommitUtxo(idaUtxos);
      const idaCommitB = idaEligible.length >= 2 ? idaEligible[1] : null;
      const idaCommitAny = pickCommitUtxo(idaUtxos);

      const aliceCommit = pickCommitUtxo(aliceUtxos);
      const bobCommit = pickCommitUtxo(bobUtxos);
      const jonCommit = pickCommitUtxo(jonUtxos);
      const charlieCommit = pickCommitUtxo(charlieUtxos);
      const idaCommitHeadC = pickCommitUtxo(idaUtxos);

      if (operation === "open_heads_ab") {
        await openHead("A", [headA.p1, headA.p2], [aliceCommit, idaCommitA]);
        await openHead("B", [headB.p1, headB.p2, headB.p3], [bobCommit, idaCommitB, jonCommit]);
        return;
      }
      if (operation === "open_head_a") {
        await openHead("A", [headA.p1, headA.p2], [aliceCommit, idaCommitAny]);
        return;
      }
      if (operation === "open_head_b") {
        await openHead("B", [headB.p1, headB.p2, headB.p3], [bobCommit, idaCommitAny, jonCommit]);
        return;
      }
      if (operation === "commit_head_c_charlie") {
        await commitHeadCParticipant(headC.p1, headC.p2, charlieCommit);
        return;
      }
      await commitHeadCParticipant(headC.p2, headC.p1, idaCommitHeadC);
    };

    await runOnceWithRefreshRetry(runOnce, refreshL1Utxos);

    if (operation === "open_heads_ab") {
      console.log("\nBoth A and B heads open flows completed.");
    } else if (operation === "open_head_a") {
      console.log("\nHead A open flow completed.");
    } else if (operation === "open_head_b") {
      console.log("\nHead B open flow completed.");
    } else if (operation === "commit_head_c_admin") {
      console.log("\nHead C admin partial init completed.");
    } else {
      console.log("\nHead C Charlie partial init completed.");
    }
  } finally {
    await refreshL1UtxosSafe("main-finally");
  }
}

main().catch((error) => {
  console.error("Failed to open final-demo heads:", error);
  process.exit(1);
});
