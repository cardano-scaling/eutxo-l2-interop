import { HydraHeadConfig } from "./config";

export type ValidationResult = {
  valid: boolean;
  errors: string[];
};

/**
 * Validates that all nodes in a topology are running
 * by checking the /snapshot/utxo endpoint
 */
export async function validateTopology(
  heads: HydraHeadConfig[]
): Promise<ValidationResult> {
  const errors: string[] = [];
  const timeout = 3000; // 3 seconds timeout per node

  // Validate all nodes in all heads
  const validationPromises: Promise<boolean>[] = [];

  for (const head of heads) {
    const nodeEntries = Object.entries(head.nodes).filter(([_, url]) => url);
    
    if (nodeEntries.length === 0) {
      errors.push(`${head.name}: No nodes configured`);
      validationPromises.push(Promise.resolve(false));
      continue;
    }

    // Validate each node in the head
    for (const [userName, nodeUrl] of nodeEntries) {

      const promise = (async () => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeout);

          const response = await fetch(`${nodeUrl}/snapshot/utxo`, {
            method: "GET",
            signal: controller.signal,
            headers: {
              Accept: "application/json",
            },
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            errors.push(
              `${head.name} (${userName} @ ${nodeUrl}): HTTP ${response.status} ${response.statusText}`
            );
            return false;
          }

          // Try to parse response (even if empty object is fine)
          await response.json();
          return true;
        } catch (error) {
          if (error instanceof Error) {
            if (error.name === "AbortError") {
              errors.push(
                `${head.name} (${userName} @ ${nodeUrl}): Timeout - node not responding`
              );
            } else if (error.message.includes("fetch") || error.message.includes("ECONNREFUSED")) {
              errors.push(
                `${head.name} (${userName} @ ${nodeUrl}): Connection refused - node not running`
              );
            } else {
              errors.push(
                `${head.name} (${userName} @ ${nodeUrl}): ${error.message}`
              );
            }
          } else {
            errors.push(
              `${head.name} (${userName} @ ${nodeUrl}): Unknown error`
            );
          }
          return false;
        }
      })();

      validationPromises.push(promise);
    }
  }

  const results = await Promise.all(validationPromises);
  const valid = results.every((result) => result === true) && errors.length === 0;

  return { valid, errors };
}

