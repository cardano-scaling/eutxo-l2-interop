/**
 * This script is used to build a lock transaction with a fixed datum and 10 ADAs
 */

import { HydraHandler } from "./lib/hydra/handler";
import { HydraProvider } from "./lib/hydra/provider";
import { CBORHex, CML, Data, Lucid, LucidEvolution, ScriptType, SpendingValidator, toHex, validatorToAddress } from "@lucid-evolution/lucid";
import { logger } from "./lib/logger";
import { readFileSync } from 'fs';
import { join } from 'path';
import { getNetworkFromLucid } from "./lib/utils"
import { HtlcDatum, HtlcDatumT } from "./lib/types";
import plutusBlueprint from '../onchain/plutus.json' assert { type: 'json' };


// load the alice funds signing key
const aliceFundsSkPath = join(process.cwd(), '../infra/credentials/alice/alice-funds.sk');
const aliceFundsSk = JSON.parse(readFileSync(aliceFundsSkPath, 'utf8'));

const aliceFundsVkPath = join(process.cwd(), '../infra/credentials/alice/alice-funds.vk');
const aliceFundsVk = JSON.parse(readFileSync(aliceFundsVkPath, 'utf8'));

// and the ida funds address to send the funds to
const idaFundsVkPath = join(process.cwd(), '../infra/credentials/ida/ida-funds.vk');
const idaFundsVk = JSON.parse(readFileSync(idaFundsVkPath, 'utf8'));

const idaFundsCborBytes = Buffer.from(idaFundsVk.cborHex, 'hex');
console.log(idaFundsVk.cborHex)

const aliceSkBytes = Buffer.from(aliceFundsSk.cborHex, 'hex');

// skip the cbor header (5820) to get the actual 32-byte key
// 58 is the cbor type for byte string
// 20 is the length of the byte string
const aliceSk = CML.PrivateKey.from_normal_bytes(aliceSkBytes.subarray(2));

logger.info(`Loaded signing key: ${aliceSk.to_bech32()}`);
logger.info(`Loaded signing key: ${toHex(aliceSk.to_raw_bytes())}`);

const aliceVkBytes = Buffer.from(aliceFundsVk.cborHex, 'hex');
const aliceVk = CML.PublicKey.from_bytes(aliceVkBytes.subarray(2));

const idaVkBytes = Buffer.from(idaFundsVk.cborHex, 'hex');
const idaVk = CML.PublicKey.from_bytes(idaVkBytes.subarray(2))

// instantiate the hydra handler, provider, and lucid
const handler = new HydraHandler('http://127.0.0.1:4001');
const lucid = await Lucid(new HydraProvider(handler), "Custom");
lucid.selectWallet.fromPrivateKey(aliceSk.to_bech32());

let htlcDatum = {
    hash: "",
    timeout: 100n,
    sender: aliceVk.hash().to_hex(),
    receiver: idaVk.hash().to_hex(),
}

let datum = Data.to<HtlcDatumT>(htlcDatum, HtlcDatum)

let script: SpendingValidator = {
    type: "PlutusV3",
    script: plutusBlueprint.validators[0].compiledCode
};

const network = getNetworkFromLucid(lucid);
let scriptAddress = validatorToAddress(network, script)


const tx = await lucid
  .newTx()
  .pay.ToContract(
    scriptAddress,
    { kind: "inline", value: datum},
    { lovelace: 1_000_000_000n },
  )
  .complete();


const txSigned = await tx.sign.withWallet().complete();

const snapshotBeforeTx = await handler.getSnapshot();
logger.info('Snapshot before tx');
logger.info(snapshotBeforeTx);

const submittedTx = await txSigned.submit();
logger.info(submittedTx);
while (!await lucid.awaitTx(submittedTx, 3000)) {}

const snapshotAfterTx = await handler.getSnapshot();
logger.info('Snapshot after tx');
logger.info(snapshotAfterTx);

process.exit(0);
