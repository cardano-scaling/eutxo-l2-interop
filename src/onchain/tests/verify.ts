import { Addresses, Crypto, Data, Emulator, Lucid } from "https://deno.land/x/lucid@0.20.14/mod.ts";
import {
  AdhocLedgerV4WrappedDatum,
  AdhocLedgerV4WrappedSpend,
  AdhocLedgerV4VerifiedDatum,
  AdhocLedgerV4VerifiedSpend,
  AdhocLedgerV4WrappedOutput,
  CardanoTransactionOutputReference
} from "./plutus.ts";

// Import reusable functions from wrap.ts
import { setupWrapEnvironment, performWrapTransactions } from "./wrap.ts";

// Main verification test
async function main() {
  // Setup environment using imported function
  const env = setupWrapEnvironment();

  // Perform wrap transactions using imported function
  const { wrappedValidator, wrappedAddress, wrappedDatum } = await performWrapTransactions(
    env.lucid1A, env.lucid2B, env.privateKey1, env.privateKey2, env.emulatorA, env.emulatorB
  );

  //
  // VERIFY TRANSACTION: Consume Alice's wrapped UTXO and pay to verified contract
  //

  // Create verified validator and address
  const verifiedValidator = new AdhocLedgerV4VerifiedSpend();
  const verifiedAddress = env.lucid1A.newScript(verifiedValidator).toAddress();

  // Get Alice's wrapped UTXO from head A
  const wrappedUtxosA = await env.lucid1A.utxosAt(wrappedAddress);
  if (wrappedUtxosA.length === 0) {
    throw new Error("No wrapped UTXOs found in head A");
  }

  // Create wrapped output for verified datum in head A (using same structure as in performWrapTransactions)
  const wrappedOutputA: AdhocLedgerV4WrappedOutput = {
    datum: wrappedDatum,
    lovelace: 5000000n,
  };

  // Create output with Bob as owner
  const bobOutputA: AdhocLedgerV4WrappedOutput = {
    datum: {
      owner: Crypto.privateKeyToDetails(env.privateKey3).credential.hash, // Bob
      intermediaries: new Map(),  // Empty intermediaries for Bob output
      nonce: { transactionId: "", outputIndex: 0n },  // Empty nonce for Bob output
      disputed: false,  // Not disputed initially
    },
    lovelace: 5000000n,
  };

  // Create verified datum containing wrapped output and Bob output
  const verifiedDatumA: AdhocLedgerV4VerifiedDatum = {
    inputs: [wrappedOutputA],
    outputs: [bobOutputA],
  };

  // Create verification transaction
  const verifyTxA = await env.lucid1A.newTx()
    .addSigner(Crypto.privateKeyToDetails(env.privateKey1).credential.hash)
    .collectFrom(wrappedUtxosA, Data.to("Verify", AdhocLedgerV4WrappedSpend.redeemer))
    .payToContract(
      verifiedAddress,
      { Inline: Data.to(verifiedDatumA, AdhocLedgerV4VerifiedSpend.datumOpt) },
      { lovelace: 5000000n },
    )
    .attachScript(wrappedValidator)
    .commit();

  const signedVerifyTxA = await verifyTxA.sign().commit();
  const verifyTxAHash = await signedVerifyTxA.submit();
  env.emulatorA.awaitTx(verifyTxAHash);
  console.log("VERIFY TX A:", verifyTxAHash);

  //
  // VERIFY TRANSACTION IN HEAD B: Verify wrapped UTXO in head B and pay to verified contract
  //

  // Get Ida's wrapped UTXO from head B
  const wrappedUtxosB = await env.lucid2B.utxosAt(wrappedAddress);
  if (wrappedUtxosB.length === 0) {
    throw new Error("No wrapped UTXOs found in head B");
  }

  // Create wrapped output for verified datum in head B (using same structure as in performWrapTransactions)
  const wrappedOutputB2: AdhocLedgerV4WrappedOutput = {
    datum: wrappedDatum,
    lovelace: 5000000n,
  };

  // Create output with Bob as owner for head B
  const bobOutputB: AdhocLedgerV4WrappedOutput = {
    datum: {
      owner: Crypto.privateKeyToDetails(env.privateKey3).credential.hash, // Bob
      intermediaries: new Map(),  // Empty intermediaries for Bob output
      nonce: { transactionId: "", outputIndex: 0n },  // Empty nonce for Bob output
      disputed: false,  // Not disputed initially
    },
    lovelace: 5000000n,
  };

  // Create verified datum containing wrapped output and Bob output for head B
  const verifiedDatumB: AdhocLedgerV4VerifiedDatum = {
    inputs: [wrappedOutputB2],
    outputs: [bobOutputB],
  };

  // Create verification transaction in head B
  const verifyTxB = await env.lucid2B.newTx()
    .addSigner(Crypto.privateKeyToDetails(env.privateKey2).credential.hash)
    .collectFrom(wrappedUtxosB, Data.to("Verify", AdhocLedgerV4WrappedSpend.redeemer))
    .payToContract(
      verifiedAddress,
      { Inline: Data.to(verifiedDatumB, AdhocLedgerV4VerifiedSpend.datumOpt) },
      { lovelace: 5000000n },
    )
    .attachScript(wrappedValidator)
    .commit();

  const signedVerifyTxB = await verifyTxB.sign().commit();
  const verifyTxBHash = await signedVerifyTxB.submit();
  env.emulatorB.awaitTx(verifyTxBHash);
  console.log("VERIFY TX B:", verifyTxBHash);

  //
  // VERIFY:
  // Check final state
  //
  const finalAliceBalanceA = await env.lucid1A.wallet.getUtxos();
  const finalAliceBalanceInA = finalAliceBalanceA.reduce((acc, utxo) =>
    acc + utxo.assets.lovelace, 0n);

  const verifiedUtxos = await env.lucid1A.utxosAt(verifiedAddress);

  console.log("Alice's final balance in head A:", finalAliceBalanceInA.toString());
  console.log("Verified UTXOs count:", verifiedUtxos.length);
  console.log("Verified contract address:", verifiedAddress);

  //
  // PERFORM:
  // Test complete - wrap and verify transactions executed successfully
  //
}

// Run the test
main();