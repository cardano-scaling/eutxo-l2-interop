import { HydraHandler } from "./lib/hydra";
import { Lucid } from "@lucid-evolution/lucid";
import { logger } from "./lib/logger";

const lucid = await Lucid();
// a sample tx for testing the hydra node initial setup and handler
const txSigned = {"tag":"NewTx","transaction":{"type": "Witnessed Tx ConwayEra","description": "Ledger Cddl Format","cborHex": "84a300d90102818258200000000000000000000000000000000000000000000000000000000000000000000182a200581d6080d997ce31b99dab96ce34983a1fdda7c9285fc3afc129c9032cdc20011b00005a0a3bd53000a200581d6080d997ce31b99dab96ce34983a1fdda7c9285fc3afc129c9032cdc20011b000000e8d4a510000200a100d9010281825820216f72947d1b97d56825c5f9f8a2e6f14234c03171853264f2f552a2685b25e05840cf0468e486ab818fdb980e8122b6679f436fb576f084eddd9eb55fa3a82a7fec4178ba89b45d9898d255345df88fef769f565c82c964e12e745286da8c30550df5f6"}}

const handler = new HydraHandler(lucid, 'http://127.0.0.1:4001');

const snapshotBeforeTx = await handler.getSnapshot();
logger.info('Snapshot before tx');
logger.info(snapshotBeforeTx);

const tx = await handler.sendTx(txSigned.transaction.cborHex);
logger.info(tx);

logger.info('Waiting for 5 seconds');
await new Promise(resolve => setTimeout(resolve, 5000));

const snapshotAfterTx = await handler.getSnapshot();
logger.info('Snapshot after tx');
logger.info(snapshotAfterTx);


