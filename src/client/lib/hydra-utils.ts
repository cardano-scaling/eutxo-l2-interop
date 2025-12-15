import { Assets, fromUnit } from "@lucid-evolution/lucid";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MapAssetsT } from "./types";

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
