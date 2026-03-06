/**
 * Admin pays the winner by spending the lottery UTxO with the PayWinner
 * redeemer and simultaneously spending the winning ticket UTxO.
 */

import { HydraHandler } from "../lib/hydra/handler";
import { HydraProvider } from "../lib/hydra/provider";
import { applyParamsToScript, Data, Lucid, SpendingValidator, validatorToScriptHash } from "@lucid-evolution/lucid";


import { logger } from "../lib/logger";
import { readFileSync } from "fs";
import { join } from "path";
import { SLOT_CONFIG_NETWORK } from "@lucid-evolution/plutus";
import { dataAddressToBech32, getScriptInfo, getUserDetails } from "../lib/utils";
import {
    LotteryDatum,
    LotteryDatumT,
    LotteryRedeemer,
    LotteryRedeemerT,
    OutputReferenceT,
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
const winnerTxHash = await rli.question("Winning ticket UTxO txHash: \n");
const winnerOutputIndexStr = await rli.question("Winning ticket UTxO output index: \n");

const winnerOutputIndex = BigInt(winnerOutputIndexStr.trim());


const [lotteryScriptBytes, lotteryScriptHash] = getScriptInfo(
    { filename: "lottery", scriptName: "lottery" },
    "spend"
);
const [ticketScriptBytesRaw, _ticketRawHash] = getScriptInfo(
    { filename: "lottery", scriptName: "ticket" },
    "spend"
);
// Apply the lottery script hash as parameter to get the correct on-chain ticket script
const ticketScriptBytes = applyParamsToScript(ticketScriptBytesRaw, [lotteryScriptHash]);
const ticketScriptHash = validatorToScriptHash({ type: "PlutusV3", script: ticketScriptBytes });

const handler = new HydraHandler(adminDetails.senderNodeUrl!);
const lucid = await Lucid(new HydraProvider(handler), "Custom");

lucid.selectWallet.fromPrivateKey(adminDetails.sk.to_bech32());

// ----- Fetch lottery UTxO -----
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
const { prize, close_timestamp, admin } = lotteryDatum;

// ----- Fetch winning ticket UTxO -----
const ticketUtxos = await lucid.utxosAt({ type: "Script", hash: ticketScriptHash });
const winnerUtxo = ticketUtxos.find(
    (u) => u.txHash === winnerTxHash.trim() && u.outputIndex === Number(winnerOutputIndex)
);
if (!winnerUtxo) throw new Error(`Cannot find winner UTxO ${winnerTxHash.trim()}#${winnerOutputIndex}`);

const ticketDatum = Data.from<TicketDatumT>(
    winnerUtxo.datum ?? Data.void(),
    TicketDatum
);
const { desired_output } = ticketDatum;

// ----- Build redeemers -----
const winnerRef: OutputReferenceT = {
    transaction_id: winnerUtxo.txHash,
    output_index: BigInt(winnerUtxo.outputIndex),
};

const lotteryRedeemer = Data.to<LotteryRedeemerT>(
    { PayWinner: [winnerRef] },
    LotteryRedeemer
);
const ticketRedeemer = Data.to<TicketRedeemerT>({ Win: [] }, TicketRedeemer);

// ----- Updated lottery datum (paid_winner = true) -----
const updatedDatum = Data.to<LotteryDatumT>(
    { ...lotteryDatum, paid_winner: true },
    LotteryDatum
);

const lotteryScript: SpendingValidator = { type: "PlutusV3", script: lotteryScriptBytes };
const ticketScript: SpendingValidator = { type: "PlutusV3", script: ticketScriptBytes };

// validFrom: 5 minutes after close_timestamp
const validFrom = Number(close_timestamp) + 5 * 60 * 1000;

const winnerAddress = dataAddressToBech32(lucid, desired_output.address);
const winnerPayout = { lovelace: BigInt(prize) };

const tx = await lucid
    .newTx()
    .collectFrom([lotteryUtxo], lotteryRedeemer)
    .collectFrom([winnerUtxo], ticketRedeemer)
    .attach.SpendingValidator(lotteryScript)
    .attach.SpendingValidator(ticketScript)
    .pay.ToContract(
        // Continue the lottery UTxO at the same address (minus prize, with updated datum)
        lotteryUtxo.address,
        { kind: "inline", value: updatedDatum },
        // Remaining assets: lottery UTxO value minus the prize paid out
        Object.fromEntries(
            Object.entries(lotteryUtxo.assets).map(([k, v]) =>
                k === "lovelace" ? [k, v - BigInt(prize)] : [k, v]
            )
        )
    )
    .pay.ToAddress(winnerAddress, winnerPayout)
    .addSignerKey(admin)
    .validFrom(validFrom)
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
