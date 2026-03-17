import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import blake2b from "blake2b";
import { SLOT_CONFIG_NETWORK } from "@lucid-evolution/plutus";
import {
  CML,
  Data,
  Lucid,
  type MintingPolicy,
  validatorToAddress,
} from "@lucid-evolution/lucid";
import {
  LotteryDatum,
  type LotteryDatumT,
  LotteryMintRedeemer,
  type LotteryMintRedeemerT,
  OutputReference,
  type OutputReferenceT,
} from "../lib/hydra/ops-lottery-types";
import { HydraOpsHandler } from "../lib/hydra/ops-handler";
import { HydraOpsProvider } from "../lib/hydra/ops-provider";
import { getLotteryScriptInfo } from "../lib/hydra/ops-scripts";
import { credentialsPath, startupTimePath } from "../lib/runtime-paths";

const HEAD_B_JON_API_URL = "http://127.0.0.1:4328";
const LOTTERY_REGISTRY_API_URL = "http://127.0.0.1:3000/api/lottery/active";
const LOTTERY_REGISTRY_ROLE_HEADER = "x-final-demo-role";
const LOTTERY_REGISTRY_ROLE_VALUE = "admin";
// Use a far-future default so the on-chain "validity entirely before close"
// check passes even with local clock / slot conversion drift.
const DEFAULT_CLOSE_DELAY_MS = 30 * 24 * 60 * 60 * 1000;

function loadStartupTimeMs(): number {
  const startupTime = readFileSync(startupTimePath(), "utf8").trim();
  const parsed = Number(startupTime);
  if (!Number.isFinite(parsed)) {
    throw new Error("Invalid startup_time.txt value");
  }
  return parsed;
}

function loadJonKeys(): { privateKeyBech32: string; vkeyHashHex: string } {
  const skPath = credentialsPath("jon", "jon-funds.sk");
  const vkPath = credentialsPath("jon", "jon-funds.vk");
  const skJson = JSON.parse(readFileSync(skPath, "utf8")) as { cborHex: string };
  const vkJson = JSON.parse(readFileSync(vkPath, "utf8")) as { cborHex: string };

  const skBytes = Buffer.from(skJson.cborHex, "hex");
  const vkBytes = Buffer.from(vkJson.cborHex, "hex");
  const sk = CML.PrivateKey.from_normal_bytes(skBytes.subarray(2));
  const vk = CML.PublicKey.from_bytes(vkBytes.subarray(2));
  return {
    privateKeyBech32: sk.to_bech32(),
    vkeyHashHex: vk.hash().to_hex(),
  };
}

function tokenNameFromOutputRef(ref: OutputReferenceT): string {
  const refCbor = Data.to<OutputReferenceT>(ref, OutputReference);
  const refBytes = Buffer.from(refCbor, "hex");
  return blake2b(32).update(refBytes).digest("hex");
}

async function main() {
  const rli = createInterface({ input, output, terminal: true });
  try {
    const startupTimeMs = loadStartupTimeMs();
    SLOT_CONFIG_NETWORK.Custom = {
      zeroTime: startupTimeMs,
      zeroSlot: 0,
      slotLength: 1000,
    };

    const prizeInput = await rli.question("Prize amount (lovelace) [25000000]: ");
    const ticketCostInput = await rli.question("Ticket cost (lovelace) [5000000]: ");
    const closeTimestampInput = await rli.question("Close timestamp POSIX ms [now+30d]: ");

    const prize = BigInt((prizeInput.trim() || "25000000"));
    const ticketCost = BigInt((ticketCostInput.trim() || "5000000"));
    const closeTimestamp = BigInt(
      closeTimestampInput.trim() || String(Date.now() + DEFAULT_CLOSE_DELAY_MS),
    );

    const { privateKeyBech32, vkeyHashHex } = loadJonKeys();
    const spend = getLotteryScriptInfo();
    const handler = new HydraOpsHandler(HEAD_B_JON_API_URL);
    const lucid = await Lucid(new HydraOpsProvider(handler), "Custom");
    lucid.selectWallet.fromPrivateKey(privateKeyBech32);

    let jonUtxos;
    try {
      jonUtxos = await lucid.wallet().getUtxos();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Hydra snapshot request failed with 404")) {
        throw new Error(
          "Head B is not open (Hydra snapshot unavailable). Run `npm run hydra:open-heads` first.",
        );
      }
      throw error;
    }
    if (jonUtxos.length === 0) {
      throw new Error("Jon has no UTxOs available on Head B");
    }
    const seed = jonUtxos[0];
    const ref: OutputReferenceT = {
      transaction_id: seed.txHash,
      output_index: BigInt(seed.outputIndex),
    };

    const tokenName = tokenNameFromOutputRef(ref);
    const assetUnit = `${spend.hash}${tokenName}`;
    const mintRedeemer = Data.to<LotteryMintRedeemerT>({ Mint: [ref] }, LotteryMintRedeemer);
    const datum: LotteryDatumT = {
      prize,
      ticket_cost: ticketCost,
      paid_winner: false,
      close_timestamp: closeTimestamp,
      admin: vkeyHashHex,
    };
    const inlineDatum = Data.to<LotteryDatumT>(datum, LotteryDatum);
    const lotteryScriptAddress = validatorToAddress("Custom", {
      type: "PlutusV3",
      script: spend.compiledCode,
    });
    const validTo = Date.now() + 60_000;
    const closeTimestampMs = Number(closeTimestamp);
    if (!Number.isFinite(closeTimestampMs)) {
      throw new Error("Invalid close timestamp value");
    }
    if (closeTimestampMs <= validTo) {
      throw new Error(
        `close_timestamp must be after tx validTo (close=${closeTimestampMs}, validTo=${validTo})`,
      );
    }
    console.log(`Using close_timestamp=${closeTimestampMs}, tx validTo=${validTo}`);

    const tx = await lucid
      .newTx()
      .collectFrom([seed])
      .mintAssets({ [assetUnit]: 1n }, mintRedeemer)
      .attach.MintingPolicy({ type: "PlutusV3", script: spend.compiledCode } as MintingPolicy)
      .pay.ToContract(
        lotteryScriptAddress,
        { kind: "inline", value: inlineDatum },
        { lovelace: prize, [assetUnit]: 1n },
      )
      .addSignerKey(vkeyHashHex)
      .validTo(validTo)
      .complete();

    const signed = await tx.sign.withWallet().complete();
    const txHash = await signed.submit();
    await lucid.awaitTx(txHash, 3000);

    const snapshot = await handler.getSnapshot();
    const lotteryUtxo = snapshot.find((u) => (u.assets[assetUnit] ?? 0n) >= 1n);

    console.log("\nLottery created on Head B as Jon.");
    console.log(`txHash: ${txHash}`);
    console.log(`LOTTERY_ASSET: ${assetUnit}`);
    if (lotteryUtxo) {
      console.log(`lotteryUtxo: ${lotteryUtxo.txHash}#${lotteryUtxo.outputIndex}`);
    }

    const registrationPayload = {
      headName: "headB",
      policyId: spend.hash,
      tokenNameHex: tokenName,
      mintTxHash: txHash,
      contractAddress: lotteryScriptAddress,
    };

    try {
      const response = await fetch(LOTTERY_REGISTRY_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [LOTTERY_REGISTRY_ROLE_HEADER]: LOTTERY_REGISTRY_ROLE_VALUE,
        },
        body: JSON.stringify(registrationPayload),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`HTTP ${response.status} ${body}`);
      }
      console.log(`Registered active lottery in DB via ${LOTTERY_REGISTRY_API_URL}`);
    } catch (error) {
      console.warn("Failed to auto-register lottery in DB. You can register manually with:");
      console.warn(
        `curl -X POST ${LOTTERY_REGISTRY_API_URL} -H 'content-type: application/json' -H '${LOTTERY_REGISTRY_ROLE_HEADER}: ${LOTTERY_REGISTRY_ROLE_VALUE}' -d '${JSON.stringify(registrationPayload)}'`,
      );
      console.warn(error);
    }
  } finally {
    rli.close();
  }
}

main()
  .then(() => {
    // Ensure the CLI exits even if underlying libs keep sockets alive.
    process.exit(0);
  })
  .catch((error) => {
    console.error("Failed to create lottery on Head B (Jon):", error);
    process.exit(1);
  });

