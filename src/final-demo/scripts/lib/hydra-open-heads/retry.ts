/**
 * Normalize errors so two throws of the "same" failure compare equal (best-effort).
 */
export function stableErrorKey(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim().replace(/\s+/g, " ");
  }
  return String(error).trim().replace(/\s+/g, " ");
}

/**
 * Run `runOnce`; on failure refresh L1 snapshot and run once more.
 * If the second attempt fails with the same `stableErrorKey` as the first, throw a circuit-breaker error
 * (refresh did not change the outcome — no point pretending another retry would help).
 */
export async function runOnceWithRefreshRetry(
  runOnce: () => Promise<void>,
  refreshL1Utxos: (reason: string) => Promise<void>,
): Promise<void> {
  try {
    await runOnce();
    return;
  } catch (firstError: unknown) {
    const firstKey = stableErrorKey(firstError);
    console.warn("[retry] Opening heads failed on first attempt. Refreshing l1-utxos and retrying once...");
    console.warn(firstError);
    await refreshL1Utxos("retry-after-failure");
    try {
      await runOnce();
    } catch (secondError: unknown) {
      const secondKey = stableErrorKey(secondError);
      if (firstKey === secondKey && firstKey.length > 0) {
        throw new Error(
          `[circuit-breaker] Same error on two consecutive attempts after l1 refresh (stable key unchanged).\n  key: ${firstKey}`,
          { cause: secondError instanceof Error ? secondError : firstError },
        );
      }
      throw secondError;
    }
  }
}
