import { executeWorkflow } from "@/lib/executor";
import { logger } from "@/lib/logger";
import { listPendingWorkflows } from "@/lib/workflows";

const pollMs = Number(process.env.WORKER_POLL_MS || 2000);

async function tick() {
  const workflows = await listPendingWorkflows(10);
  for (const wf of workflows) {
    await executeWorkflow(wf);
  }
}

logger.info({ pollMs }, "final-demo worker started");
setInterval(() => {
  tick().catch((err) => logger.error({ err }, "worker tick failed"));
}, pollMs);
