import { readFileSync } from "node:fs";
import { CML, Lucid, getAddressDetails } from "@lucid-evolution/lucid";
import { HydraOpsHandler, txHashFromCbor } from "./ops-handler";
import { HydraOpsProvider } from "./ops-provider";
import { hexAddressToBech32 } from "./ops-address";
import { lucidNetworkName } from "./network";
import { ensureHydraSlotConfig } from "./slot-config";
import { credentialsPath } from "@/lib/runtime-paths";

const REQUEST_FUNDS_FIXED_LOVELACE = 20_000_000n;

function getHeadAApiUrl(): string {
  const value = process.env.HYDRA_HEAD_A_API_URL;
  if (!value) {
    throw new Error("HYDRA_HEAD_A_API_URL is not configured");
  }
  return value;
}

function loadAliceFundsPrivateKeyBech32(): string {
  const skPath = credentialsPath("alice", "alice-funds.sk");
  const skJson = JSON.parse(readFileSync(skPath, "utf8")) as { cborHex: string };
  const skBytes = Buffer.from(skJson.cborHex, "hex");
  const sk = CML.PrivateKey.from_normal_bytes(skBytes.subarray(2));
  return sk.to_bech32();
}


function normalizeAddressToBech32(input: string): string {
  const value = input.trim();
  return value.startsWith("addr") ? value : hexAddressToBech32(value);
}

function paymentKeyHashFromAddress(addressBech32: string): string {
  const details = getAddressDetails(addressBech32);
  const paymentCredential = details.paymentCredential;
  if (!paymentCredential || paymentCredential.type !== "Key") {
    throw new Error("request_funds recipient must use a key payment credential address");
  }lucidNetworkName
  return paymentCredential.hash;
}

export async function prepareRequestFundsDraft(input: { address: string }) {
  const recipientAddress = normalizeAddressToBech32(input.address);
  const recipientPaymentKeyHash = paymentKeyHashFromAddress(recipientAddress);
  const handler = new HydraOpsHandler(getHeadAApiUrl());
  ensureHydraSlotConfig();
  const lucid = await Lucid(new HydraOpsProvider(handler), lucidNetworkName());
  lucid.selectWallet.fromPrivateKey(loadAliceFundsPrivateKeyBech32());

  const txBuilder = await lucid
    .newTx()
    .pay.ToAddress(recipientAddress, { lovelace: REQUEST_FUNDS_FIXED_LOVELACE })
    .addSignerKey(recipientPaymentKeyHash)
    .complete();

  const unsignedTxCborHex = txBuilder.toCBOR();
  return {
    unsignedTxCborHex,
    txBodyHash: txBuilder.toHash(),
    amountLovelace: REQUEST_FUNDS_FIXED_LOVELACE.toString(),
  };
}

export async function submitRequestFundsDraft(input: { unsignedTxCborHex: string; witnessHex: string }) {
  const handler = new HydraOpsHandler(getHeadAApiUrl());
  ensureHydraSlotConfig();
  const lucid = await Lucid(new HydraOpsProvider(handler), lucidNetworkName());
  lucid.selectWallet.fromPrivateKey(loadAliceFundsPrivateKeyBech32());
  const signBuilder = lucid
    .fromTx(input.unsignedTxCborHex)
    .assemble([input.witnessHex]);
  const signedTx = await signBuilder.sign.withWallet().complete();
  const signedTxCborHex = signedTx.toCBOR();
  await handler.sendTx(signedTxCborHex);
  const txHash = txHashFromCbor(signedTxCborHex);
  return {
    txHash,
    amountLovelace: REQUEST_FUNDS_FIXED_LOVELACE.toString(),
  };
}

