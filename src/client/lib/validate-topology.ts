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
  const timeout = 3000; // 3 seconds timeout per head

  // Validate all heads in parallel
  const validationPromises = heads.map(async (head) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(`${head.httpUrl}/snapshot/utxo`, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        errors.push(
          `${head.name} (${head.httpUrl}): HTTP ${response.status} ${response.statusText}`
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
            `${head.name} (${head.httpUrl}): Timeout - node not responding`
          );
        } else if (error.message.includes("fetch")) {
          errors.push(
            `${head.name} (${head.httpUrl}): Connection refused - node not running`
          );
        } else {
          errors.push(
            `${head.name} (${head.httpUrl}): ${error.message}`
          );
        }
      } else {
        errors.push(
          `${head.name} (${head.httpUrl}): Unknown error`
        );
      }
      return false;
    }
  });

  const results = await Promise.all(validationPromises);
  const valid = results.every((result) => result === true);

  return { valid, errors };
}

