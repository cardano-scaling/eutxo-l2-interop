/**
 * Admin collects multiple losing ticket UTxOs in a single transaction.
 * The lottery UTxO is passed as a reference input (not consumed).
 * Only tickets belonging to the selected lottery (by lottery_id) are collected.
 */

import { HydraHandler } from "../lib/hydra/handler";
import { HydraProvider } from "../lib/hydra/provider";
import { applyParamsToScript, Data, fromUnit, Lucid, SpendingValidator, validatorToScriptHash } from "@lucid-evolution/lucid";
import { logger } from "../lib/logger";
import { readFileSync } from "fs";
import { join } from "path";
import { SLOT_CONFIG_NETWORK } from "@lucid-evolution/plutus";
import { getScriptInfo, getUserDetails } from "../lib/utils";


import {
    LotteryDatum,
    LotteryDatumT,
    TicketDatum,
    TicketDatumT,
    TicketRedeemer,
    TicketRedeemerT,
} from "../lib/types";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const rli = createInterface({ input, output, terminal: true });

const startupTime = readFileSync(join(process.cwd(), "../infra/startup_time.txt"), "utf8");
const startupTimeMs = parseInt(startupTime);

SLOT_CONFIG_NETWORK["Custom"] = {
    zeroTime: startupTimeMs,
    zeroSlot: 0,
    slotLength: 1000,
};

const adminDetails = await getUserDetails("admin", rli);

const lotteryAsset = await rli.question(
    "Lottery NFT asset (policyId + tokenName hex): \n"
);
const batchSizeStr = await rli.question(
    "How many losing tickets to collect in this batch? (leave blank for all): \n"
);

const { assetName: lotteryTokenName } = fromUnit(lotteryAsset.trim());

const [lotteryScriptBytes, lotteryScriptHash] = getScriptInfo(
    { filename: "lottery", scriptName: "lottery" },
    "spend"
);
const [ticketScriptBytesRaw] = getScriptInfo(
    { filename: "lottery", scriptName: "ticket" },
    "spend"
);
// Apply the lottery script hash as parameter to get the correct on-chain ticket script
const ticketScriptBytes = applyParamsToScript(ticketScriptBytesRaw, [lotteryScriptHash]);
const ticketScriptHash = validatorToScriptHash({ type: "PlutusV3", script: ticketScriptBytes });

const handler = new HydraHandler(adminDetails.senderNodeUrl!);
const lucid = await Lucid(new HydraProvider(handler), "Custom");

lucid.selectWallet.fromPrivateKey(adminDetails.sk.to_bech32());

// ----- Fetch lottery UTxO (used as reference input) -----
const lotteryUtxos = await lucid.utxosAt({ type: "Script", hash: lotteryScriptHash });
const lotteryUtxo = lotteryUtxos.find((utxo) => {
    const qty = utxo.assets[lotteryAsset.trim()];
    return qty !== undefined && qty >= 1n;
});
if (!lotteryUtxo) throw new Error(`Cannot find lottery UTxO for asset ${lotteryAsset.trim()}`);

const lotteryDatum = Data.from<LotteryDatumT>(
    lotteryUtxo.datum ?? Data.void(),
    LotteryDatum
);
const { admin } = lotteryDatum;

logger.info(`Lottery paid_winner: ${lotteryDatum.paid_winner}`);
if (!lotteryDatum.paid_winner) {
    throw new Error("Winner has not been paid yet. Cannot collect losing tickets.");
}

// ----- Find all ticket UTxOs for THIS lottery -----
const allTicketUtxos = await lucid.utxosAt({ type: "Script", hash: ticketScriptHash });
const losingTickets = allTicketUtxos.filter((utxo) => {
    try {
        const td = Data.from<TicketDatumT>(utxo.datum ?? Data.void(), TicketDatum);
        return td.lottery_id === (lotteryTokenName ?? "");
    } catch {
        return false;
    }
});

if (losingTickets.length === 0) {
    logger.info("No losing tickets found for this lottery.");
    process.exit(0);
}

// Apply optional batch size limit
const batchSize = batchSizeStr.trim() ? parseInt(batchSizeStr.trim()) : losingTickets.length;
const ticketBatch = losingTickets.slice(0, batchSize);

logger.info(`Collecting ${ticketBatch.length} losing ticket(s) (${losingTickets.length} found total)`);

const loseRedeemer = Data.to<TicketRedeemerT>({ Lose: [] }, TicketRedeemer);
const ticketScript: SpendingValidator = { type: "PlutusV3", script: ticketScriptBytes };

const tx = await lucid
    .newTx()
    .readFrom([lotteryUtxo]) // reference input — not consumed
    .collectFrom(ticketBatch, loseRedeemer)
    .attach.SpendingValidator(ticketScript)
    .addSignerKey(admin)
    .complete();

const txSigned = await tx.sign.withWallet().complete();

const snapshotBeforeTx = await handler.getSnapshot();
logger.info("Snapshot before tx");
logger.info(snapshotBeforeTx);

const submittedTx = await txSigned.submit();
logger.info(`Tx submitted: ${submittedTx}`);
while (!await lucid.awaitTx(submittedTx, 3000)) { }

const snapshotAfterTx = await handler.getSnapshot();
logger.info("Snapshot after tx");
logger.info(snapshotAfterTx);

process.exit(0);
