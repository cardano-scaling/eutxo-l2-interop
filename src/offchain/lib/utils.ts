import { CML, LucidEvolution, Network } from "@lucid-evolution/lucid";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Interface } from 'node:readline/promises';
import plutusJson from '../../onchain/plutus.json';

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

export { getNetworkFromLucid, getUserDetails, getScriptInfo }