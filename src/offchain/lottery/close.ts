/**
 * Admin closes the lottery by spending the lottery UTxO and burning the control NFT.
 * Requires paid_winner to be true on the lottery datum.
 */

import { HydraHandler } from "../lib/hydra/handler";
import { HydraProvider } from "../lib/hydra/provider";
import { Data, Lucid, MintingPolicy, SpendingValidator } from "@lucid-evolution/lucid";
import { logger } from "../lib/logger";
import { readFileSync } from "fs";
import { join } from "path";
import { SLOT_CONFIG_NETWORK } from "@lucid-evolution/plutus";
import { getScriptInfo, getUserDetails } from "../lib/utils";
import {
    LotteryDatum,
    LotteryDatumT,
    LotteryMintRedeemer,
    LotteryMintRedeemerT,
    LotteryRedeemer,
    LotteryRedeemerT,
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

const [lotteryScriptBytes, lotteryScriptHash] = getScriptInfo(
    { filename: "lottery", scriptName: "lottery" },
    "spend"
);
const [lotteryMintBytes] = getScriptInfo(
    { filename: "lottery", scriptName: "lottery" },
    "mint"
);

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
const { admin } = lotteryDatum;

if (!lotteryDatum.paid_winner) {
    throw new Error("Winner has not been paid yet. Cannot close the lottery.");
}

// ----- Build redeemers -----
const spendRedeemer = Data.to<LotteryRedeemerT>({ Close: [] }, LotteryRedeemer);
const mintRedeemer = Data.to<LotteryMintRedeemerT>({ Burn: [] }, LotteryMintRedeemer);

const lotteryScript: SpendingValidator = { type: "PlutusV3", script: lotteryScriptBytes };
const lotteryMintScript: MintingPolicy = { type: "PlutusV3", script: lotteryMintBytes };

// Burn the control NFT (qty = -1)
const burnAssets = { [lotteryAsset.trim()]: -1n };

const tx = await lucid
    .newTx()
    .collectFrom([lotteryUtxo], spendRedeemer)
    .mintAssets(burnAssets, mintRedeemer)
    .attach.SpendingValidator(lotteryScript)
    .attach.MintingPolicy(lotteryMintScript)
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
