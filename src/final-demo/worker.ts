import { executeWorkflow } from "@/lib/executor";
import { STALE_THRESHOLD_MS, syncHeadSnapshotsHeartbeat } from "@/lib/heads";
import { logger } from "@/lib/logger";
import { listPendingWorkflows } from "@/lib/workflows";

const pollMs = Number(process.env.WORKER_POLL_MS || 2000);
const snapshotSyncMs = Number(process.env.HEAD_SNAPSHOT_SYNC_MS || Math.max(1000, Math.floor(STALE_THRESHOLD_MS / 2)));

async function tick() {
  const workflows = await listPendingWorkflows(10);
  for (const wf of workflows) {
    await executeWorkflow(wf);
  }
}

async function syncSnapshots() {
  await syncHeadSnapshotsHeartbeat();
}

logger.info({ pollMs, snapshotSyncMs }, "final-demo worker started");
syncSnapshots().catch((err) => logger.error({ err }, "initial snapshot sync failed"));
setInterval(() => {
  tick().catch((err) => logger.error({ err }, "worker tick failed"));
}, pollMs);
setInterval(() => {
  syncSnapshots().catch((err) => logger.error({ err }, "snapshot sync failed"));
}, snapshotSyncMs);
