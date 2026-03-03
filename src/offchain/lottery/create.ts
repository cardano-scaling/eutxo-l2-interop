/**
 * Admin creates a new lottery by minting the control NFT and locking
 * the prize funds at the lottery script address.
 */

import { HydraHandler } from "../lib/hydra/handler";
import { HydraProvider } from "../lib/hydra/provider";
import { Data, Lucid, MintingPolicy, validatorToAddress } from "@lucid-evolution/lucid";
import { logger } from "../lib/logger";
import { readFileSync } from "fs";
import { join } from "path";
import { SLOT_CONFIG_NETWORK } from "@lucid-evolution/plutus";
import { getNetworkFromLucid, getScriptInfo, getUserDetails } from "../lib/utils";
import { LotteryDatum, LotteryDatumT, LotteryMintRedeemer, LotteryMintRedeemerT, OutputReference, OutputReferenceT } from "../lib/types";

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import blake2b from "blake2b";

const rli = createInterface({ input, output, terminal: true });

const startupTime = readFileSync(join(process.cwd(), "../infra/startup_time.txt"), "utf8");
const startupTimeMs = parseInt(startupTime);

SLOT_CONFIG_NETWORK["Custom"] = {
    zeroTime: startupTimeMs,
    zeroSlot: 0,
    slotLength: 1000,
};

const adminDetails = await getUserDetails("admin", rli);

const prizeStr = await rli.question("Prize amount (lovelace):\n");
const ticketCostStr = await rli.question("Ticket cost (lovelace):\n");
const closeTimestampStr = await rli.question("Close timestamp (POSIX milliseconds):\n");

const prize = BigInt(prizeStr.trim());
const ticketCost = BigInt(ticketCostStr.trim());
const closeTimestamp = BigInt(closeTimestampStr.trim());

const [lotteryScriptBytes, lotteryScriptHash] = getScriptInfo(
    { filename: "lottery", scriptName: "lottery" },
    "spend"
);

const handler = new HydraHandler(adminDetails.senderNodeUrl!);
const lucid = await Lucid(new HydraProvider(handler), "Custom");
const network = getNetworkFromLucid(lucid);

lucid.selectWallet.fromPrivateKey(adminDetails.sk.to_bech32());

// Pick the first UTxO as the seed for the NFT token name
const adminUtxos = await lucid.wallet().getUtxos();
if (adminUtxos.length === 0) throw new Error("No UTxOs found in admin wallet");
const seedUtxo = adminUtxos[0];

const refCbor = Data.to<OutputReferenceT>(
    {
        transaction_id: seedUtxo.txHash,
        output_index: BigInt(seedUtxo.outputIndex),
    },
    OutputReference
);


// TN = blake2b_256(cbor.serialise(ref))   — matches the on-chain logic
const refBytes = Buffer.from(refCbor, "hex");
const tokenNameBytes = blake2b(32).update(refBytes).digest("hex");
const tokenName = tokenNameBytes;

logger.info(`Lottery NFT token name: ${tokenName}`);

const mintScript: MintingPolicy = {
    type: "PlutusV3",
    script: lotteryScriptBytes,
};

const mintRedeemer = Data.to<LotteryMintRedeemerT>(
    { Mint: [{ transaction_id: seedUtxo.txHash, output_index: BigInt(seedUtxo.outputIndex) }] },
    LotteryMintRedeemer
);

const lotteryScriptAddress = validatorToAddress(network, {
    type: "PlutusV3",
    script: lotteryScriptBytes,
});

const datum: LotteryDatumT = {
    prize,
    ticket_cost: ticketCost,
    paid_winner: false,
    close_timestamp: closeTimestamp,
    admin: adminDetails.vk.hash().to_hex(),
};
const inlineDatum = Data.to<LotteryDatumT>(datum, LotteryDatum);

const policyId = lotteryScriptHash;
const assetUnit = `${policyId}${tokenName}`;

// validTo: 1 minute from now
const validTo = Date.now() + 60 * 1000;
console.log("Valid to:", validTo);
console.log("Close timestamp:", closeTimestamp);

const tx = await lucid
    .newTx()
    .collectFrom([seedUtxo])
    .mintAssets({ [assetUnit]: 1n }, mintRedeemer)
    .attach.MintingPolicy(mintScript)
    .pay.ToContract(
        lotteryScriptAddress,
        { kind: "inline", value: inlineDatum },
        { lovelace: prize, [assetUnit]: 1n }
    )
    .addSignerKey(adminDetails.vk.hash().to_hex())
    .validTo(validTo)
    .complete();

const txSigned = await tx.sign.withWallet().complete();

const snapshotBeforeTx = await handler.getSnapshot();
logger.info("Snapshot before tx");
logger.info(snapshotBeforeTx);

const submittedTx = await txSigned.submit();
logger.info(`Tx submitted: ${submittedTx}`);
logger.info(`Lottery NFT asset: ${assetUnit}`);
while (!await lucid.awaitTx(submittedTx, 3000)) { }

const snapshotAfterTx = await handler.getSnapshot();
logger.info("Snapshot after tx");
logger.info(snapshotAfterTx);

process.exit(0);
