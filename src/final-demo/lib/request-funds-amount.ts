/** Upper bound for a single request-funds transfer (10 ADA). */
export const REQUEST_FUNDS_MAX_LOVELACE = 10_000_000n;

/** Default amount when the UI does not override (6 ADA). */
export const REQUEST_FUNDS_DEFAULT_LOVELACE = 6_000_000n;

export function requestFundsDefaultLovelaceString(): string {
  return REQUEST_FUNDS_DEFAULT_LOVELACE.toString();
}

export function requestFundsMaxLovelaceString(): string {
  return REQUEST_FUNDS_MAX_LOVELACE.toString();
}

/** Parse a decimal digits string to lovelace, or null if invalid. */
export function parseRequestFundsLovelaceString(raw: string): bigint | null {
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return null;
  try {
    return BigInt(t);
  } catch {
    return null;
  }
}

export function isRequestFundsAmountAllowed(amount: bigint): boolean {
  return amount > 0n && amount <= REQUEST_FUNDS_MAX_LOVELACE;
}
