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

// instantiate the hydra handler, provider, and lucid
const handler = new HydraHandler('http://127.0.0.1:4001');
const lucid = await Lucid(new HydraProvider(handler), "Custom");

// create private key from the signing key
// The cborHex contains cbor-encoded bytes, we need to decode it
// cbor format: 5820 (byte string of 32 bytes) + 32 bytes of key
const cborBytes = Buffer.from(aliceFundsSk.cborHex, 'hex');
logger.info('CBOR hex:', aliceFundsSk.cborHex);

// skip the cbor header (5820) to get the actual 32-byte key
// 58 is the cbor type for byte string
// 20 is the length of the byte string
const keyBytes = cborBytes.slice(2);

const privateKey = CML.PrivateKey.from_normal_bytes(keyBytes);

logger.info(`Loaded signing key: ${privateKey.to_bech32()}`);
logger.info(`Loaded signing key: ${toHex(privateKey.to_raw_bytes())}`);

lucid.selectWallet.fromPrivateKey(privateKey.to_bech32());

let alicePublic = privateKey.to_public()
// simple transaction to send 1 million ADA to bob funds address

let htlcDatum = {
    hash: "",
    timeout: 100n,
    sender: alicePublic.hash().to_hex(),
    receiver: "",
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
