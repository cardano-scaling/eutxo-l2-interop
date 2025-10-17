/**
 * Ida/Bob claims the funds from the HTLC contract locked by Alice/Ida.
 */

import { HydraHandler } from "./lib/hydra/handler";
import { HydraProvider } from "./lib/hydra/provider";
import { CML, credentialToAddress, Lucid, toHex } from "@lucid-evolution/lucid";
import { logger } from "./lib/logger";
import { readFileSync } from 'fs';
import { join } from 'path';
import { Data, SLOT_CONFIG_NETWORK } from "@lucid-evolution/plutus";
import plutusJson from '../onchain/plutus.json';
import { HtlcDatum, HtlcDatumT, HtlcRedeemer, HtlcRedeemerT } from "./lib/types";
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { getUserDetails } from "./lib/utils";

const rli = createInterface({ input, output, terminal: true });

const startupTime = readFileSync(join(process.cwd(), '../infra/startup_time.txt'), 'utf8');
const startupTimeMs = parseInt(startupTime);

SLOT_CONFIG_NETWORK["Custom"] = {
  zeroTime: startupTimeMs,
  zeroSlot: 0,
  slotLength: 1000
};

const { sk: receiverPrivateKey, vk: receiverVk, receiverNodeUrl: idaNodeUrl } = await getUserDetails("receiver", rli)
const preimage = await rli.question("What's the preimage for this HTLC?\n");
logger.info(`preimage: ${preimage}`);

// load htlc script
const htlcScript = plutusJson.validators[0].compiledCode;
const htlcScriptHash = plutusJson.validators[0].hash;

// instantiate the hydra handler, provider, and lucid
const receiverNodeHandler = new HydraHandler(idaNodeUrl!);
const lucid = await Lucid(new HydraProvider(receiverNodeHandler), "Custom");

const receiverAddress = credentialToAddress("Custom", { type: "Key", hash: receiverVk.hash().to_hex()});

lucid.selectWallet.fromPrivateKey(receiverPrivateKey.to_bech32());

const htlcUTxOs = await lucid.utxosAt({ type: "Script", hash: htlcScriptHash });

// TODO select the correct HTLC UTxO to claim from cli?
const [htlcUTxO,] = htlcUTxOs.filter(async (utxo) => {;
  const { receiver } = Data.from<HtlcDatumT>(
    utxo.datum ?? Data.void(),
    HtlcDatum
  );
  return receiver === receiverVk.hash().to_hex()
});

const { timeout } = Data.from<HtlcDatumT>(
  htlcUTxO.datum ?? Data.void(),
  HtlcDatum
);

// claim the funds from the HTLC contract
const tx = await lucid
  .newTx()
  .collectFrom([htlcUTxO], Data.to<HtlcRedeemerT>({ Claim: [toHex(Buffer.from(preimage))] }, HtlcRedeemer))
  .validTo(Number(timeout) - 1)
  .addSigner(receiverAddress)
  .attach.Script({ type: "PlutusV3", script: htlcScript })
  .complete();

const txSigned = await tx.sign.withWallet().complete();

const snapshotBeforeTx = await receiverNodeHandler.getSnapshot();
logger.info('Snapshot before tx');
logger.info(snapshotBeforeTx);

const submittedTx = await txSigned.submit();
logger.info(submittedTx);
while (!await lucid.awaitTx(submittedTx, 3000)) {}

const snapshotAfterTx = await receiverNodeHandler.getSnapshot();
logger.info('Snapshot after tx');
logger.info(snapshotAfterTx);

process.exit(0);

