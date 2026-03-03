type QueueCounters = {
  claims: number;
  retriesScheduled: number;
  terminalFailures: number;
  staleLockRecoveries: number;
  manualRetries: number;
  manualForceRetries: number;
};

function emptyCounters(): QueueCounters {
  return {
    claims: 0,
    retriesScheduled: 0,
    terminalFailures: 0,
    staleLockRecoveries: 0,
    manualRetries: 0,
    manualForceRetries: 0,
  };
}

const totals: QueueCounters = emptyCounters();
const sinceLast: QueueCounters = emptyCounters();

export function recordClaims(count: number) {
  if (count <= 0) return;
  totals.claims += count;
  sinceLast.claims += count;
}

export function recordStaleLockRecovery(count: number) {
  if (count <= 0) return;
  totals.staleLockRecoveries += count;
  sinceLast.staleLockRecoveries += count;
}

export function recordFailureOutcome(canRetry: boolean) {
  if (canRetry) {
    totals.retriesScheduled += 1;
    sinceLast.retriesScheduled += 1;
    return;
  }
  totals.terminalFailures += 1;
  sinceLast.terminalFailures += 1;
}

export function recordManualRetry(force: boolean) {
  totals.manualRetries += 1;
  sinceLast.manualRetries += 1;
  if (!force) return;
  totals.manualForceRetries += 1;
  sinceLast.manualForceRetries += 1;
}

export function flushQueueCounters(windowMs: number) {
  const windowMinutes = Math.max(windowMs / 60_000, 0.0001);
  const snapshot = {
    windowMs,
    window: { ...sinceLast },
    totals: { ...totals },
    ratesPerMin: {
      claimRate: Number((sinceLast.claims / windowMinutes).toFixed(2)),
      retriesScheduledRate: Number((sinceLast.retriesScheduled / windowMinutes).toFixed(2)),
      terminalFailureRate: Number((sinceLast.terminalFailures / windowMinutes).toFixed(2)),
      staleLockRecoveryRate: Number((sinceLast.staleLockRecoveries / windowMinutes).toFixed(2)),
    },
  };
  sinceLast.claims = 0;
  sinceLast.retriesScheduled = 0;
  sinceLast.terminalFailures = 0;
  sinceLast.staleLockRecoveries = 0;
  sinceLast.manualRetries = 0;
  sinceLast.manualForceRetries = 0;
  return snapshot;
}
