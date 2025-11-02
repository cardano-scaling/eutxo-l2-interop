/**
 * This script is used to build a lock transaction with a fixed datum and 10 ADAs
 */

import { HydraHandler } from "../lib/hydra/handler";
import { HydraProvider } from "../lib/hydra/provider";
import { Data, Lucid, SpendingValidator, validatorToAddress } from "@lucid-evolution/lucid";
import { logger } from "../lib/logger";
import { getNetworkFromLucid, getScriptInfo, getUserDetails } from "../lib/utils"
import { HtlcDatum, HtlcDatumT } from "../lib/types";
import { createInterface} from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';


const rli = createInterface({ input, output, terminal: true });

const senderDetails = await getUserDetails("sender", rli)

const receiverDetails = await getUserDetails("receiver", rli)

// instantiate the hydra handler, provider, and lucid
const handler = new HydraHandler(senderDetails.senderNodeUrl!);
const lucid = await Lucid(new HydraProvider(handler), "Custom");
lucid.selectWallet.fromPrivateKey(senderDetails.sk.to_bech32());

// Ask user for the hash
const hash = await rli.question("What's the Hash for this HTLC?\n");
const amountStr = await rli.question("What's the amount to lock (in lovelace) for this HTLC?\n");
const amount = BigInt(amountStr.trim())

// 2 hours from now
const timeout = BigInt(Date.now() + 2 * 60 * 60 * 1000)

let htlcDatum = {
    hash: hash,
    timeout: timeout,
    sender: senderDetails.vk.hash().to_hex(),
    receiver: receiverDetails.vk.hash().to_hex(),
}

let datum = Data.to<HtlcDatumT>(htlcDatum, HtlcDatum)

const [htlcScriptBytes,_] = getScriptInfo("htlc")

let script: SpendingValidator = {
    type: "PlutusV3",
    script: htlcScriptBytes
};

const network = getNetworkFromLucid(lucid);
let scriptAddress = validatorToAddress(network, script)


const tx = await lucid
  .newTx()
  .pay.ToContract(
    scriptAddress,
    { kind: "inline", value: datum},
    { lovelace: amount },
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
