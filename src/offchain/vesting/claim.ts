/**
 * Claims the funds from the Vesting contract.
 */

import { HydraHandler } from "../lib/hydra/handler";
import { HydraProvider } from "../lib/hydra/provider";
import { credentialToAddress, Lucid } from "@lucid-evolution/lucid";
import { logger } from "../lib/logger";
import { readFileSync } from 'fs';
import { join } from 'path';
import { Data, SLOT_CONFIG_NETWORK } from "@lucid-evolution/plutus";
import { VestingDatum, VestingDatumT } from "../lib/types";
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { getScriptInfo, getUserDetails } from "../lib/utils";

const rli = createInterface({ input, output, terminal: true });

const startupTime = readFileSync(join(process.cwd(), '../infra/startup_time.txt'), 'utf8');
const startupTimeMs = parseInt(startupTime);

SLOT_CONFIG_NETWORK["Custom"] = {
  zeroTime: startupTimeMs,
  zeroSlot: 0,
  slotLength: 1000
};

const { sk: receiverPrivateKey, vk: receiverVk, receiverNodeUrl } = await getUserDetails("receiver", rli)


const [vestingScriptBytes, vestingScriptHash] = getScriptInfo("vesting")

// instantiate the hydra handler, provider, and lucid
const receiverNodeHandler = new HydraHandler(receiverNodeUrl!);
const lucid = await Lucid(new HydraProvider(receiverNodeHandler), "Custom");

const receiverAddress = credentialToAddress("Custom", { type: "Key", hash: receiverVk.hash().to_hex()});

lucid.selectWallet.fromPrivateKey(receiverPrivateKey.to_bech32());

const vestingUTxOs = await lucid.utxosAt({ type: "Script", hash: vestingScriptHash });

// TODO select the correct Vesting UTxO to claim from cli?
const [vestingUTxO,] = vestingUTxOs.filter(async (utxo) => {;
  const { receiver } = Data.from<VestingDatumT>(
    utxo.datum ?? Data.void(),
    VestingDatum
  );
  return receiver === receiverVk.hash().to_hex()
});

const { timeout } = Data.from<VestingDatumT>(
  vestingUTxO.datum ?? Data.void(),
  VestingDatum
);

// claim the funds from the Vesting contract
const tx = await lucid
  .newTx()
  .collectFrom([vestingUTxO], Data.void())
  .validFrom(Number(timeout) + 1 * 60 * 1000)
  .addSigner(receiverAddress)
  .attach.Script({ type: "PlutusV3", script: vestingScriptBytes })
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

function getSpendingScriptInfo(arg0: string): [any, any] {
  throw new Error("Function not implemented.");
}

