/**
 * This script is used to build a lock transaction with a fixed datum and 10 ADAs
 */

import { HydraHandler } from "./lib/hydra/handler";
import { HydraProvider } from "./lib/hydra/provider";
import { Data, Lucid, SLOT_CONFIG_NETWORK, SpendingValidator } from "@lucid-evolution/lucid";
import { logger } from "./lib/logger";
import { readFileSync } from 'fs';
import { join } from 'path';
import { getScriptInfo, getUserDetails } from "./lib/utils"
import { HtlcDatum, HtlcDatumT, Spend } from "./lib/types";
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rli = createInterface({ input, output, terminal: true });

const senderDetails = await getUserDetails("sender", rli)

const startupTime = readFileSync(join(process.cwd(), '../infra/startup_time.txt'), 'utf8');
const startupTimeMs = parseInt(startupTime);

SLOT_CONFIG_NETWORK["Custom"] = {
  zeroTime: startupTimeMs,
  zeroSlot: 0,
  slotLength: 1000
};

// instantiate the hydra handler, provider, and lucid
const handler = new HydraHandler(senderDetails.senderNodeUrl!);
const lucid = await Lucid(new HydraProvider(handler), "Custom");
lucid.selectWallet.fromPrivateKey(senderDetails.sk.to_bech32());

const [htlcScriptBytes, htlcScriptHash] = getScriptInfo("htlc")

let script: SpendingValidator = {
  type: "PlutusV3",
  script: htlcScriptBytes
};

const htlcUTxOs = await lucid.utxosAt({ type: "Script", hash: htlcScriptHash });

// TODO select the correct HTLC UTxO to claim from cli?
const [htlcUTxO,] = htlcUTxOs.filter(async (utxo) => {;
  const { sender } = Data.from<HtlcDatumT>(
    utxo.datum ?? Data.void(),
    HtlcDatum
  );
  return sender === senderDetails.vk.hash().to_hex()
});

const tx = await lucid
  .newTx()
  .validFrom(Date.now())
  .addSignerKey(senderDetails.vk.hash().to_hex())
  .collectFrom([htlcUTxO], Spend.Refund)
  .attach.SpendingValidator(script)
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
