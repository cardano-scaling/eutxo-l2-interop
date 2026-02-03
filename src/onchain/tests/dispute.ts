import { Addresses, Crypto, Data, Emulator, Lucid } from "https://deno.land/x/lucid@0.20.14/mod.ts";
import {
  AdhocLedgerV4WrappedDatum,
  AdhocLedgerV4WrappedSpend,
  CardanoTransactionOutputReference
} from "./plutus.ts";

// Import reusable functions from wrap.ts
import { setupWrapEnvironment, performWrapTransactions } from "./wrap.ts";

// Main dispute test
async function main() {
  // Setup environment using imported function
  const env = setupWrapEnvironment();

  // Perform wrap transactions using imported function
  const { wrappedValidator, wrappedAddress, wrappedDatum } = await performWrapTransactions(
    env.lucid1A, env.lucid2B, env.privateKey1, env.privateKey2, env.emulatorA, env.emulatorB
  );

  //
  // DISPUTE UTXO IN A: Alice disputes her 5 ADA from head A
  //
  const wrappedUtxosA = await env.lucid1A.utxosAt(wrappedAddress);
  if (wrappedUtxosA.length === 0) {
    throw new Error("No wrapped UTXOs found in head A");
  }

  // Create updated datum with disputed = true for the dispute transaction
  const disputedDatumA: AdhocLedgerV4WrappedDatum = {
    ...wrappedDatum,
    disputed: true,
  };

  const disputeTxA = await env.lucid1A.newTx()
    .addSigner(Crypto.privateKeyToDetails(env.privateKey1).credential.hash)
    .collectFrom(wrappedUtxosA, Data.to("Dispute", AdhocLedgerV4WrappedSpend.redeemer))
    .payToContract(wrappedAddress, { Inline: Data.to(disputedDatumA, AdhocLedgerV4WrappedSpend.datumOpt) }, { lovelace: 5000000n })
    .attachScript(wrappedValidator)
    .commit();
  const signedDisputeTxA = await disputeTxA.sign().commit();
  const disputeTxAHash = await signedDisputeTxA.submit();
  env.emulatorA.awaitTx(disputeTxAHash);
  console.log("DISPUTE TX A:", disputeTxAHash);

  //
  // DISPUTE UTXO IN B: Ida disputes 5 ADA from head B and sends to Alice
  //
  const wrappedUtxosB = await env.lucid2B.utxosAt(wrappedAddress);
  if (wrappedUtxosB.length === 0) {
    throw new Error("No wrapped UTXOs found in head B");
  }

  // Create updated datum with disputed = true for the dispute transaction
  const disputedDatumB: AdhocLedgerV4WrappedDatum = {
    ...wrappedDatum,
    disputed: true,
  };

  const disputeTxB = await env.lucid2B.newTx()
    .addSigner(Crypto.privateKeyToDetails(env.privateKey2).credential.hash)
    .collectFrom(wrappedUtxosB, Data.to("Dispute", AdhocLedgerV4WrappedSpend.redeemer))
    .payToContract(wrappedAddress, { Inline: Data.to(disputedDatumB, AdhocLedgerV4WrappedSpend.datumOpt) }, { lovelace: 5000000n })
    .attachScript(wrappedValidator)
    .commit();
  const signedDisputeTxB = await disputeTxB.sign().commit();
  const disputeTxBHash = await signedDisputeTxB.submit();
  env.emulatorB.awaitTx(disputeTxBHash);
  console.log("DISPUTE TX B:", disputeTxBHash);

  //
  // Check final balances to ensure disputeping worked correctly
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