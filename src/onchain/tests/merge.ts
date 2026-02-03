import { Addresses, Crypto, Data, Emulator, Lucid } from "https://deno.land/x/lucid@0.20.14/mod.ts";
import {
  AdhocLedgerV4WrappedDatum,
  AdhocLedgerV4WrappedSpend,
  CardanoTransactionOutputReference
} from "./plutus.ts";
import { HydraEmulator } from "./hydra_emulator.ts";

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

  //
  // CREATE COMBINED EMULATOR FROM BOTH HEADS
  //
  const utxosA = env.emulatorA.getState().getLedger();
  const utxosB = env.emulatorB.getState().getLedger();
  const combinedUtxos = [...utxosA, ...utxosB];
  
  const emulatorMain = HydraEmulator.withUtxos(combinedUtxos);
   
  console.log("Combined emulator created with", combinedUtxos.length, "total UTXOs");
  console.log("UTXOs from head A:", utxosA.length, "from head B:", utxosB.length);
   
  // Verify the combined emulator has all UTXOs (duplicates automatically handled by EmulatorState)
  const combinedLedger = emulatorMain.getState().getLedger();
  console.log("Combined emulator ledger contains", combinedLedger.length, "UTXOs (duplicates removed)");

  //
  // CREATE LUCID INSTANCE FOR COMBINED EMULATOR WITH ALICE KEYS
  //
  const lucidMain = new Lucid({
    provider: emulatorMain,
    wallet: { PrivateKey: env.privateKey1 },
  });
   
  console.log("Created Lucid instance for combined emulator with Alice's keys");
   
  // Test the combined Lucid instance by checking Alice's UTXOs
  const aliceCombinedUtxos = await lucidMain.utxosAt(env.address1);
  console.log("Alice's UTXOs in combined emulator:", aliceCombinedUtxos.length);
  
  const aliceCombinedBalance = aliceCombinedUtxos.reduce((acc, utxo) =>
    acc + utxo.assets.lovelace, 0n);
  console.log("Alice's total balance in combined emulator:", aliceCombinedBalance.toString());

  //
  // SPEND BOTH DISPUTED UTXOS USING COMBINED LUCID INSTANCE
  //
  
  // Get the disputed UTXOs from the wrapped address
  const disputedUtxos = await lucidMain.utxosAt(wrappedAddress);
  console.log("Found", disputedUtxos.length, "UTXOs at wrapped address");

  // Find the specific disputed UTXOs we want to spend
  const disputeUtxoA = disputedUtxos.find(utxo => 
    utxo.txHash === disputeTxAHash && utxo.outputIndex === 0
  );
  const disputeUtxoB = disputedUtxos.find(utxo => 
    utxo.txHash === disputeTxBHash && utxo.outputIndex === 0
  );

  if (!disputeUtxoA) {
    console.log("Dispute UTXO A not found:", disputeTxAHash, "#0");
  }
  if (!disputeUtxoB) {
    console.log("Dispute UTXO B not found:", disputeTxBHash, "#0");
  }

  if (disputeUtxoA && disputeUtxoB) {
    console.log("Found both disputed UTXOs, creating spend transaction...");
    
    // Create transaction to spend both disputed UTXOs
    const spendTxs = await lucidMain.newTx()
      .collectFrom([disputeUtxoA, disputeUtxoB], Data.to("Merge", AdhocLedgerV4WrappedSpend.redeemer))
      .payTo(env.address1, { lovelace: 10000000n }) // Send 10 ADA back to Alice
      .attachScript(wrappedValidator)
      .commit();
    
    const signedSpendTxs = await spendTxs.sign().commit();
    const spendTxsHash = await signedSpendTxs.submit();
    emulatorMain.awaitTx(spendTxsHash);
    
    console.log("SPEND BOTH DISPUTED UTXOS TX:", spendTxsHash);
    
    // Check final balances after spending
    const finalAliceUtxos = await lucidMain.utxosAt(env.address1);
    const finalAliceBalance = finalAliceUtxos.reduce((acc, utxo) =>
      acc + utxo.assets.lovelace, 0n);
    console.log("Alice's final balance after spending disputed UTXOs:", finalAliceBalance.toString());
  }
}

// Run test
main();
