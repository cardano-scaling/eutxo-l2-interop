import { Addresses, Crypto, Data, Emulator, Lucid } from "https://deno.land/x/lucid@0.20.14/mod.ts";
import {
  AdhocLedgerV4WrappedDatum,
  AdhocLedgerV4WrappedSpend,
  CardanoTransactionOutputReference
} from "./plutus.ts";

// Import reusable functions from wrap.ts
import { setupWrapEnvironment, performWrapTransactions } from "./wrap.ts";

// Main unwrap test
async function main() {
  // Setup environment using imported function
  const env = setupWrapEnvironment();

  // Perform wrap transactions using imported function
  const { wrappedValidator, wrappedAddress, wrappedDatum } = await performWrapTransactions(
    env.lucid1A, env.lucid2B, env.privateKey1, env.privateKey2, env.emulatorA, env.emulatorB
  );

  //
  // UNWRAP UTXO IN A: Alice unwraps her 5 ADA from head A
  //
  const wrappedUtxosA = await env.lucid1A.utxosAt(wrappedAddress);
  if (wrappedUtxosA.length === 0) {
    throw new Error("No wrapped UTXOs found in head A");
  }

  const unwrapTxA = await env.lucid1A.newTx()
    .addSigner(Crypto.privateKeyToDetails(env.privateKey1).credential.hash)
    .collectFrom(wrappedUtxosA, Data.to("Unwrap", AdhocLedgerV4WrappedSpend.redeemer))
    .attachScript(wrappedValidator)
    .commit();
  const signedUnwrapTxA = await unwrapTxA.sign().commit();
  const unwrapTxAHash = await signedUnwrapTxA.submit();
  env.emulatorA.awaitTx(unwrapTxAHash);
  console.log("UNWRAP TX A:", unwrapTxAHash);

  //
  // UNWRAP UTXO IN B: Ida unwraps her 5 ADA from head B
  //
  const wrappedUtxosB = await env.lucid2B.utxosAt(wrappedAddress);
  if (wrappedUtxosB.length === 0) {
    throw new Error("No wrapped UTXOs found in head B");
  }

  const unwrapTxB = await env.lucid2B.newTx()
    .addSigner(Crypto.privateKeyToDetails(env.privateKey2).credential.hash)
    .collectFrom(wrappedUtxosB, Data.to("Unwrap", AdhocLedgerV4WrappedSpend.redeemer))
    .attachScript(wrappedValidator)
    .commit();
  const signedUnwrapTxB = await unwrapTxB.sign().commit();
  const unwrapTxBHash = await signedUnwrapTxB.submit();
  env.emulatorB.awaitTx(unwrapTxBHash);
  console.log("UNWRAP TX B:", unwrapTxBHash);

  //
  // Check final balances to ensure unwrapping worked correctly
  //
  const finalAliceBalanceA = await env.lucid1A.wallet.getUtxos();
  const finalAliceBalanceInA = finalAliceBalanceA.reduce((acc, utxo) =>
    acc + utxo.assets.lovelace, 0n);

  const finalIdaBalanceB = await env.lucid2B.wallet.getUtxos();
  const finalIdaBalanceInB = finalIdaBalanceB.reduce((acc, utxo) =>
    acc + utxo.assets.lovelace, 0n);

  console.log("Alice's final balance in head A:", finalAliceBalanceInA.toString());
  console.log("Ida's final balance in head B:", finalIdaBalanceInB.toString());
}

// Run test
main();
