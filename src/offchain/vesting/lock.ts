/**
 * This script is used to build a lock transaction for the vesting contract
 */

import { HydraHandler } from "../lib/hydra/handler";
import { HydraProvider } from "../lib/hydra/provider";
import { Data, Lucid, SpendingValidator, validatorToAddress } from "@lucid-evolution/lucid";
import { logger } from "../lib/logger";
import { getNetworkFromLucid, getScriptInfo, getUserDetails } from "../lib/utils"
import { VestingDatum, VestingDatumT } from "../lib/types";
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
const amountStr = await rli.question("What's the amount to lock (in lovelace) for this Vesting contract?\n");
const timeoutStr = await rli.question("When will the vesting be available to claim? (In POSIX millisencods)\n");

const amount = BigInt(amountStr.trim())
const timeout = BigInt(timeoutStr.trim())

let vestingDatum = {
    timeout: timeout,
    receiver: receiverDetails.vk.hash().to_hex(),
}

const [vestingScriptBytes,_] = getScriptInfo("vesting")

let datum = Data.to<VestingDatumT>(vestingDatum, VestingDatum)

let script: SpendingValidator = {
    type: "PlutusV3",
    script: vestingScriptBytes
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
function getSpendingScriptInfo(arg0: string): [any, any] {
  throw new Error("Function not implemented.");
}

