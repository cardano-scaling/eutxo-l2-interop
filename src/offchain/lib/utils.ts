import { Assets, CML, credentialToAddress, fromUnit, getAddressDetails, LucidEvolution, Network, TxOutput } from "@lucid-evolution/lucid";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Interface } from 'node:readline/promises';
import plutusJson from '../../onchain/plutus.json';
import { AddressT, MapAssetsT } from "./types";

function getNetworkFromLucid(lucid: LucidEvolution): Network {
    const network = lucid.config().network;
    if (!network) {
      throw new Error('Lucid network configuration is not set.');
    }
    return network;
  }

type UserDetails = {
    sk: CML.PrivateKey;
    vk: CML.PublicKey;
    senderNodeUrl?: string;
    receiverNodeUrl?: string;
}

async function getUserDetails(role: string, rli: Interface): Promise<UserDetails> {

    const ASK_FOR_NAME = `Select which user will be the ${role}:
    1. Alice
    2. Bob
    3. Ida\n`;

    let name = ""
    let senderNodeUrl = undefined
    let receiverNodeUrl = undefined

    while (name === "") {

        const index = await rli.question(ASK_FOR_NAME);

        switch(index) {
            case '1':
                name = "alice"
                senderNodeUrl = "http://127.0.0.1:4001"
                break
            case `2`:
                name = "bob"
                receiverNodeUrl = "http://127.0.0.1:4002"
                break
            case '3':
                name = "ida"
                senderNodeUrl = "http://127.0.0.1:4004"
                receiverNodeUrl = "http://127.0.0.1:4003"
                break
            default:
                rli.write(`Invalid choice ${index}`)
        }
    }

    const skPath = join(process.cwd(), `../infra/credentials/${name}/${name}-funds.sk`);
    const sk = JSON.parse(readFileSync(skPath, 'utf8'));

    const skBytes = Buffer.from(sk.cborHex, 'hex');
    const cmlSk = CML.PrivateKey.from_normal_bytes(skBytes.subarray(2));

    const vkPath = join(process.cwd(), `../infra/credentials/${name}/${name}-funds.vk`);
    const vk = JSON.parse(readFileSync(vkPath, 'utf8'));

    const vkBytes = Buffer.from(vk.cborHex, 'hex');
    const cmlVk = CML.PublicKey.from_bytes(vkBytes.subarray(2));

    const userDetails: UserDetails = {
        sk: cmlSk,
        vk: cmlVk,
        senderNodeUrl,
        receiverNodeUrl,
    }

    return userDetails
}

function getScriptInfo(scriptName: string, scriptPurpose: string = "spend"): [string, string] {
    // load selected script
    const script = plutusJson.validators.find(
    ({ title }) => title === `${scriptName}.${scriptName}.${scriptPurpose}`
    );

    if (!script) {
     throw `${scriptName} script not found in plutus.json`
    }

    const scriptBytes = script.compiledCode;
    const scriptHash = script.hash

    return [scriptBytes, scriptHash]
}

// Converts an Assets list from LucidEvo to the desired nested maps format
function assetsToDataPairs(assets: Assets): MapAssetsT {
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

// Converts the nested maps to the LucidEvo Assets
function dataPairsToAssets(mapAssets: MapAssetsT): Assets {
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

// Convers a data address to a bech32 address, supports only inline staking credential
function dataAddressToBech32(lucid: LucidEvolution, add: AddressT): string {
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

// Converts a bech32 address to a data address, supports only inline staking credential
function bech32ToDataAddress(addr: string): AddressT {
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

export {
  getNetworkFromLucid,
  getUserDetails,
  getScriptInfo,
  assetsToDataPairs,
  dataPairsToAssets,
  bech32ToDataAddress,
  dataAddressToBech32
}
