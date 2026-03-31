import { credentialToAddress, fromUnit, getAddressDetails, type Assets, type LucidEvolution } from "@lucid-evolution/lucid";
import type { DesiredOutput } from "./ops-types";
import { lucidNetworkName } from "./network";

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

export function assetsToDataPairs(assets: Assets): Map<string, Map<string, bigint>> {
  const policiesToAssets: Map<string, Map<string, bigint>> = new Map();
  for (const [unit, amount] of Object.entries(assets)) {
    const { policyId, assetName } = fromUnit(unit);
    const policy = policyId === "lovelace" ? "" : policyId;
    const policyAssets = policiesToAssets.get(policy);
    if (policyAssets) {
      policyAssets.set(assetName ?? "", amount);
    } else {
      const assetNamesToAmountMap: Map<string, bigint> = new Map();
      assetNamesToAmountMap.set(assetName ?? "", amount);
      policiesToAssets.set(policy, assetNamesToAmountMap);
    }
  }
  return policiesToAssets;
}

export function dataPairsToAssets(
  mapAssets: Map<string, Map<string, bigint | number | string>>,
): Assets {
  const newAssets: Assets = {};
  for (const [policyId, tokens] of mapAssets.entries()) {
    const policy = policyId === "" ? "lovelace" : policyId;
    for (const [assetName, rawQty] of tokens.entries()) {
      const qty = typeof rawQty === "bigint"
        ? rawQty
        : typeof rawQty === "number"
          ? (() => {
            if (!Number.isFinite(rawQty) || !Number.isInteger(rawQty)) {
              throw new Error(`Invalid non-integer asset quantity: ${String(rawQty)}`);
            }
            return BigInt(rawQty);
          })()
          : BigInt(rawQty);
      const unit = policy + assetName;
      newAssets[unit] = qty;
    }
  }
  return newAssets;
}

export function dataAddressToBech32(
  _lucid: LucidEvolution,
  add: {
    payment_credential: { Verification_key_cred: { Key: string } } | { Script_cred: { Key: string } };
    stake_credential: { inline: { Verification_key_cred: { Key: string } } | { Script_cred: { Key: string } } } | null;
  },
): string {
  const extractCredential = (cred: any): { type: "Key" | "Script"; hash: string } =>
    "Verification_key_cred" in cred
      ? { type: "Key", hash: cred.Verification_key_cred.Key }
      : { type: "Script", hash: cred.Script_cred.Key };
  const payment = extractCredential(add.payment_credential);
  const stake = add.stake_credential?.inline ? extractCredential(add.stake_credential.inline) : undefined;
  return credentialToAddress(lucidNetworkName(), payment, stake);
}

export function scriptCredentialAddress(network: "Custom" | "Preprod" | "Preview" | "Mainnet", scriptHash: string): string {
  return credentialToAddress(network, { type: "Script", hash: scriptHash });
}
