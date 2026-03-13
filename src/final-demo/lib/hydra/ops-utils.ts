import { credentialToAddress, fromUnit, getAddressDetails, type Assets } from "@lucid-evolution/lucid";
import type { DesiredOutput } from "./ops-types";

export function bech32ToDataAddress(addr: string) {
  const address = getAddressDetails(addr);
  const mapCredential = (cred: { type: "Key" | "Script"; hash: string }) =>
    cred.type === "Key"
      ? { Verification_key_cred: { Key: cred.hash } }
      : { Script_cred: { Key: cred.hash } };

  if (!address.paymentCredential) {
    throw new Error(`Address ${addr} missing payment credential`);
  }

  return {
    payment_credential: mapCredential(address.paymentCredential),
    stake_credential: address.stakeCredential
      ? { inline: mapCredential(address.stakeCredential) }
      : null,
  };
}

export function desiredOutputToDatum(output: DesiredOutput): { address: unknown; datum: string | null } {
  return {
    address: bech32ToDataAddress(output.address),
    datum: output.datum ?? null,
  };
}

export function assetToPolicyAndToken(unit: string): { policyId: string; tokenName: string } {
  const parsed = fromUnit(unit.trim());
  if (!parsed.policyId || !parsed.assetName) {
    throw new Error("LOTTERY_ASSET must include policyId and tokenName");
  }
  return { policyId: parsed.policyId, tokenName: parsed.assetName };
}

export function toLovelaceAssets(amountLovelace: string): Assets {
  return { lovelace: BigInt(amountLovelace) };
}

export function scriptCredentialAddress(network: "Custom", scriptHash: string): string {
  return credentialToAddress(network, { type: "Script", hash: scriptHash });
}
