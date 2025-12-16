import { Assets, fromUnit, LucidEvolution, Network, credentialToAddress, getAddressDetails, validatorToAddress } from "@lucid-evolution/lucid";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MapAssetsT, AddressT } from "./types";

// Load plutus.json - In Next.js API routes, process.cwd() is the client directory
// Go up one level to reach src/onchain from src/client
const plutusJson = JSON.parse(readFileSync(join(process.cwd(), '../onchain/plutus.json'), 'utf8'));

/**
 * Get script info from plutus.json
 */
export function getScriptInfo(
  scriptName: string | { filename: string, scriptName: string },
  scriptPurpose: string = "spend"
): [string, string] {
  // load selected script
  const script = typeof scriptName === 'string'
    ? plutusJson.validators.find(
        ({ title }) => title === `${scriptName}.${scriptName}.${scriptPurpose}`
    )
    : plutusJson.validators.find(
        ({ title }) => title === `${scriptName.filename}.${scriptName.scriptName}.${scriptPurpose}`
    )

  if (!script) {
    throw `${scriptName} script not found in plutus.json`
  }

  const scriptBytes = script.compiledCode
  const scriptHash = script.hash

  return [scriptBytes, scriptHash]
}

/**
 * Converts an Assets list from LucidEvo to the desired nested maps format
 */
export function assetsToDataPairs(assets: Assets): MapAssetsT {
  const policiesToAssets: Map<string, Map<string, bigint>> = new Map();
  for (const [unit, amount] of Object.entries(assets)) {
    const { policyId, assetName } = fromUnit(unit);
    const policy = policyId === 'lovelace' ? '' : policyId;
    const policyAssets = policiesToAssets.get(policy);
    if (policyAssets) {
      policyAssets.set(assetName ?? '', amount);
    } else {
      const assetNamesToAmountMap: Map<string, bigint> = new Map();
      assetNamesToAmountMap.set(assetName ?? '', amount);
      policiesToAssets.set(policy, assetNamesToAmountMap);
    }
  }
  return policiesToAssets;
}

/**
 * Converts the nested maps to the LucidEvo Assets
 */
export function dataPairsToAssets(mapAssets: MapAssetsT): Assets {
  let newAssets: Assets = {}
  for (const [policyId, tokens] of mapAssets.entries()) {
    const pol = policyId === '' ? 'lovelace' : policyId
    for (const [assetName, qty] of tokens.entries()) {
      const asset = pol + assetName
      newAssets[asset] = qty
    }
  }

  return newAssets
}

/**
 * Get network from Lucid instance
 */
export function getNetworkFromLucid(lucid: LucidEvolution): Network {
  const network = lucid.config().network;
  if (!network) {
    throw new Error('Lucid network configuration is not set.');
  }
  return network;
}

/**
 * Converts a data address to a bech32 address, supports only inline staking credential
 */
export function dataAddressToBech32(lucid: LucidEvolution, add: AddressT): string {
  const extractCredential = (cred: any): { type: "Key" | "Script"; hash: string } =>
    "Verification_key_cred" in cred
      ? { type: "Key", hash: cred.Verification_key_cred.Key }
      : { type: "Script", hash: cred.Script_cred.Key };

  const network = getNetworkFromLucid(lucid);
  const payment = extractCredential(add.payment_credential);
  const stake = add.stake_credential?.inline
    ? extractCredential(add.stake_credential.inline)
    : undefined;

  return credentialToAddress(
    network,
    payment,
    stake
  );
}

/**
 * Converts a bech32 address to a data address, supports only inline staking credential
 */
export function bech32ToDataAddress(addr: string): AddressT {
  const address = getAddressDetails(addr);

  const mapCredential = (cred: { type: "Key" | "Script"; hash: string }) =>
    cred.type === "Key"
      ? { Verification_key_cred: { Key: cred.hash } }
      : { Script_cred: { Key: cred.hash } };

  if (!address.paymentCredential) {
    throw new Error(`Address ${addr} missing payment credential`)
  }

  return {
    payment_credential: mapCredential(address.paymentCredential),
    stake_credential: address.stakeCredential
      ? { inline: mapCredential(address.stakeCredential) }
      : null,
  };
}

/**
 * Get contract address from plutus.json validator
 * @param scriptName - Name of the script (e.g., 'htlc', 'vesting')
 * @param network - Network to use for address generation
 * @returns Contract address as bech32 string
 */
export function getContractAddress(scriptName: string, network: Network = 'Custom'): string {
  const [scriptBytes] = getScriptInfo(scriptName, 'spend');
  const script: { type: "PlutusV3"; script: string } = {
    type: "PlutusV3",
    script: scriptBytes,
  };
  return validatorToAddress(network, script);
}

