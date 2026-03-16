import { CML } from "@lucid-evolution/lucid";

export function hexAddressToBech32(addressHex: string): string {
  const normalized = addressHex.trim();
  return CML.Address.from_hex(normalized).to_bech32(undefined);
}

export function normalizeAddressToBech32(address: string): string {
  const normalized = address.trim();
  if (normalized.startsWith("addr")) return normalized;
  return hexAddressToBech32(normalized);
}
