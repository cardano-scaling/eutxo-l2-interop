import { executeWorkflow } from "@/lib/executor";
import { STALE_THRESHOLD_MS, syncHeadSnapshotsHeartbeat } from "@/lib/heads";
import { logger } from "@/lib/logger";
import { flushQueueCounters } from "@/lib/queue-metrics";
import { claimDueWorkflows } from "@/lib/workflows";
import { getQueueHealthSnapshot } from "@/lib/workflows";
import { reconcileBuyTicketClaims } from "@/lib/workflows";

const pollMs = Number(process.env.WORKER_POLL_MS || 2000);
const snapshotSyncMs = Number(process.env.HEAD_SNAPSHOT_SYNC_MS || Math.max(1000, Math.floor(STALE_THRESHOLD_MS / 2)));
const queueMetricsLogMs = Number(process.env.WORKER_QUEUE_METRICS_LOG_MS || 30000);
const buyTicketReconcileEveryTicks = Math.max(1, Number(process.env.BUY_TICKET_RECONCILE_EVERY_TICKS || 5));
const buyTicketReconcileLimit = Math.max(1, Number(process.env.BUY_TICKET_RECONCILE_LIMIT || 10));
let tickInFlight = false;
let tickCount = 0;
const workerId = `worker-${process.pid}`;

async function tick() {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    tickCount += 1;
    if (tickCount % buyTicketReconcileEveryTicks === 0) {
      const recon = await reconcileBuyTicketClaims(buyTicketReconcileLimit);
      if (recon.requeued > 0) {
        logger.info({ recon }, "buy-ticket reconciler re-queued workflows");
      }
    }
    const workflows = await claimDueWorkflows(10, workerId);
    for (const wf of workflows) {
      await executeWorkflow(wf, workerId);
    }
  } finally {
    tickInFlight = false;
  }
}

async function syncSnapshots() {
  await syncHeadSnapshotsHeartbeat();
}

async function logQueueHealth() {
  const [dbSnapshot, counters] = await Promise.all([
    getQueueHealthSnapshot(),
    Promise.resolve(flushQueueCounters(queueMetricsLogMs)),
  ]);
  logger.info({ queue: dbSnapshot, counters }, "worker queue health");
}

logger.info({ pollMs, snapshotSyncMs, queueMetricsLogMs }, "final-demo worker started");
syncSnapshots().catch((err) => logger.error({ err }, "initial snapshot sync failed"));
setInterval(() => {
  tick().catch((err) => logger.error({ err }, "worker tick failed"));
}, pollMs);
setInterval(() => {
  syncSnapshots().catch((err) => logger.error({ err }, "snapshot sync failed"));
}, snapshotSyncMs);
setInterval(() => {
  logQueueHealth().catch((err) => logger.error({ err }, "queue metrics log failed"));
}, queueMetricsLogMs);
