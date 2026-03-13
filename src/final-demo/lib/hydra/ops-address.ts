import { CML } from "@lucid-evolution/lucid";

export function hexAddressToBech32(addressHex: string): string {
  const normalized = addressHex.trim();
  return CML.Address.from_hex(normalized).to_bech32(undefined);
}
