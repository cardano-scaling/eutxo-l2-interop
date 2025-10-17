/**
 * Bob claims the funds from the HTLC contract locked by the intermediary.
 */

import { HydraHandler } from "./lib/hydra/handler";
import { HydraProvider } from "./lib/hydra/provider";
import { CML, Lucid, toHex } from "@lucid-evolution/lucid";
import { logger } from "./lib/logger";
import { readFileSync } from 'fs';
import { join } from 'path';
import { Data, SLOT_CONFIG_NETWORK } from "@lucid-evolution/plutus";
import plutusJson from '../onchain/plutus.json';
import { HtlcDatum, HtlcDatumT, HtlcRedeemer, HtlcRedeemerT } from "./lib/types";
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rli = createInterface({ input, output, terminal: true });

// Ask user for the preimage
const preimage = await rli.question("What's the preimage for this HTLC?\n");

const startupTime = readFileSync(join(process.cwd(), '../infra/startup_time.txt'), 'utf8');
const startupTimeMs = parseInt(startupTime);

SLOT_CONFIG_NETWORK["Custom"] = {
  zeroTime: startupTimeMs,
  zeroSlot: 0,
  slotLength: 1000
};

// load the alice funds signing key
const idaFundsSkPath = join(process.cwd(), '../infra/credentials/ida/ida-funds.sk');
const idaFundsSk = JSON.parse(readFileSync(idaFundsSkPath, 'utf8'));

// load htlc script
const htlcScript = plutusJson.validators[0].compiledCode;
const htlcScriptHash = plutusJson.validators[0].hash;

// instantiate the hydra handler, provider, and lucid
const idaHydraNodeHandler = new HydraHandler('http://127.0.0.1:4003');
const idaLucid = await Lucid(new HydraProvider(idaHydraNodeHandler), "Custom");

const idaAddress = join(process.cwd(), '../infra/credentials/ida/ida-funds.addr');

// create private key from the signing key
// The cborHex contains cbor-encoded bytes, we need to decode it
// cbor format: 5820 (byte string of 32 bytes) + 32 bytes of key
const idaCborBytes = Buffer.from(idaFundsSk.cborHex, 'hex');
// skip the cbor header (5820) to get the actual 32-byte key
// 58 is the cbor type for byte string
// 20 is the length of the byte string
const idaKeyBytes = idaCborBytes.slice(2);

const idaPrivateKey = CML.PrivateKey.from_normal_bytes(idaKeyBytes);

const idaFundsVkPath = join(process.cwd(), '../infra/credentials/ida/ida-funds.vk');
const idaFundsVk = JSON.parse(readFileSync(idaFundsVkPath, 'utf8'));
const idaVkBytes = Buffer.from(idaFundsVk.cborHex, 'hex');
const idaVk = CML.PublicKey.from_bytes(idaVkBytes.subarray(2));

idaLucid.selectWallet.fromPrivateKey(idaPrivateKey.to_bech32());

const htlcUTxOs = await idaLucid.utxosAt({ type: "Script", hash: htlcScriptHash });

// TODO select the correct HTLC UTxO to claim from cli?
const [htlcUTxO,] = htlcUTxOs.filter(async (utxo) => {;
  const { receiver } = Data.from<HtlcDatumT>(
    utxo.datum ?? Data.void(),
    HtlcDatum
  );
  return receiver === idaVk.hash().to_hex()
});

const { timeout } = Data.from<HtlcDatumT>(
  htlcUTxO.datum ?? Data.void(),
  HtlcDatum
);

// claim the funds from the HTLC contract
const tx = await idaLucid
  .newTx()
  .collectFrom([htlcUTxO], Data.to<HtlcRedeemerT>({ Claim: [toHex(Buffer.from(preimage))] }, HtlcRedeemer))
  .validTo(Number(timeout))
  .addSigner(idaAddress)
  .attach.Script({ type: "PlutusV3", script: htlcScript })
  .complete();

const txSigned = await tx.sign.withWallet().complete();

const snapshotBeforeTx = await idaHydraNodeHandler.getSnapshot();
logger.info('Snapshot before tx');
logger.info(snapshotBeforeTx);

const submittedTx = await txSigned.submit();
logger.info(submittedTx);
while (!await idaLucid.awaitTx(submittedTx, 3000)) {}

const snapshotAfterTx = await idaHydraNodeHandler.getSnapshot();
logger.info('Snapshot after tx');
logger.info(snapshotAfterTx);

process.exit(0);

