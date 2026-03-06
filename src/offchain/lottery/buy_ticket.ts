/**
 * Buyer purchases a lottery ticket by locking ADA at the ticket script
 * with a TicketDatum. The ticket_cost is read from the lottery datum on-chain.
 */

import { HydraHandler } from "../lib/hydra/handler";
import { HydraProvider } from "../lib/hydra/provider";
import { credentialToAddress, Data, fromUnit, Lucid, SpendingValidator, validatorToAddress, validatorToScriptHash, applyParamsToScript } from "@lucid-evolution/lucid";

import { logger } from "../lib/logger";
import { readFileSync } from "fs";
import { join } from "path";
import { SLOT_CONFIG_NETWORK } from "@lucid-evolution/plutus";
import { bech32ToDataAddress, getNetworkFromLucid, getScriptInfo, getUserDetails } from "../lib/utils";
import {
    LotteryDatum,
    LotteryDatumT,
    TicketDatum,
    TicketDatumT,
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

const buyerDetails = await getUserDetails("buyer", rli);

const lotteryAsset = await rli.question(
    "Lottery NFT asset (policyId + tokenName hex, e.g. abcd1234...ef): \n"
);
const desiredAddressStr = await rli.question(
    "Your desired winning address (bech32): \n"
);

const { policyId: lotteryPolicyId, assetName: lotteryTokenName } = fromUnit(lotteryAsset.trim());

// ----- Find lottery UTxO and read ticket_cost from datum -----
const [lotteryScriptBytes, lotteryScriptHash] = getScriptInfo(
    { filename: "lottery", scriptName: "lottery" },
    "spend"
);

const handler = new HydraHandler(buyerDetails.senderNodeUrl!);
const lucid = await Lucid(new HydraProvider(handler), "Custom");
const network = getNetworkFromLucid(lucid);

lucid.selectWallet.fromPrivateKey(buyerDetails.sk.to_bech32());

const lotteryUtxos = await lucid.utxosAt({ type: "Script", hash: lotteryScriptHash });

const lotteryUtxo = lotteryUtxos.find((utxo) => {
    const qty = utxo.assets[lotteryAsset.trim()];
    return qty !== undefined && qty >= 1n;
});

if (!lotteryUtxo) {
    throw new Error(`Could not find lottery UTxO containing asset ${lotteryAsset.trim()}`);
}

const lotteryDatum = Data.from<LotteryDatumT>(
    lotteryUtxo.datum ?? Data.void(),
    LotteryDatum
);

const { ticket_cost } = lotteryDatum;
logger.info(`Ticket cost from lottery datum: ${ticket_cost} lovelace`);

// ----- Ticket script (parametric — apply lottery_script_hash) -----
const [ticketScriptBytesRaw] = getScriptInfo(
    { filename: "lottery", scriptName: "ticket" },
    "spend"
);
// Apply the lottery script hash as the parameter to get the correct on-chain script
const ticketScriptBytes = applyParamsToScript(ticketScriptBytesRaw, [lotteryScriptHash]);
const ticketScriptHash = validatorToScriptHash({ type: "PlutusV3", script: ticketScriptBytes });

const ticketScript: SpendingValidator = {
    type: "PlutusV3",
    script: ticketScriptBytes,
};

const ticketScriptAddress = validatorToAddress(network, ticketScript);

// Build the desired output pointing at the buyer's address (no datum required)
const desiredAddress = bech32ToDataAddress(desiredAddressStr.trim());

const ticketDatum: TicketDatumT = {
    lottery_id: lotteryTokenName ?? "",
    desired_output: {
        address: desiredAddress,
        datum: null,
    },
};
const inlineDatum = Data.to<TicketDatumT>(ticketDatum, TicketDatum);

// Minimum ADA for UTxO (2 ADA) + ticket_cost
const ticketValue = { lovelace: ticket_cost };

const tx = await lucid
    .newTx()
    .pay.ToContract(
        ticketScriptAddress,
        { kind: "inline", value: inlineDatum },
        ticketValue
    )
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
