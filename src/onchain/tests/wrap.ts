import { Addresses, Crypto, Data, Emulator, Lucid } from "https://deno.land/x/lucid@0.20.14/mod.ts";
import {
  AdhocLedgerV4WrappedDatum,
  AdhocLedgerV4WrappedSpend,
  CardanoTransactionOutputReference
} from "./plutus.ts";
import { HydraEmulator } from "./hydra_emulator.ts";

// Export reusable setup function
export function setupWrapEnvironment() {
  // ALICE
  const privateKey1 = Crypto.generatePrivateKey();
  const address1 = Addresses.credentialToAddress(
    { Emulator: 0 },
    Crypto.privateKeyToDetails(privateKey1).credential,
  );
  const alice = {
    address: address1,
    assets: { lovelace: 3000000000n },
  };

  // IDA
  const privateKey2 = Crypto.generatePrivateKey();
  const address2 = Addresses.credentialToAddress(
    { Emulator: 0 },
    Crypto.privateKeyToDetails(privateKey2).credential,
  );
  const ida = {
    address: address2,
    assets: { lovelace: 3000000000n },
  };

  // BOB
  const privateKey3 = Crypto.generatePrivateKey();
  const address3 = Addresses.credentialToAddress(
    { Emulator: 0 },
    Crypto.privateKeyToDetails(privateKey3).credential,
  );
  const bob = {
    address: address3,
    assets: { lovelace: 3000000000n },
  };

  // SETUP EMULATORS FOR HYDRA HEADS A AND B
  const emulatorA = HydraEmulator.withAccounts([alice, ida]);
  const emulatorB = HydraEmulator.withAccounts([ida, bob]);

  // ALICE'S LUCID INSTANCE IN HEAD A
  const lucid1A = new Lucid({
    provider: emulatorA,
    wallet: { PrivateKey: privateKey1 },
  });

  // IDA'S LUCID INSTANCE IN HEAD B
  const lucid2B = new Lucid({
    provider: emulatorB,
    wallet: { PrivateKey: privateKey2 },
  });

  return {
    privateKey1, privateKey2, privateKey3,
    address1, address2, address3,
    alice, ida, bob,
    emulatorA, emulatorB,
    lucid1A, lucid2B
  };
}

// Export reusable wrap transaction function
export async function performWrapTransactions(lucid1A: Lucid, lucid2B: Lucid, privateKey1: any, privateKey2: any, emulatorA: HydraEmulator, emulatorB: HydraEmulator) {
  const wrappedValidator = new AdhocLedgerV4WrappedSpend();
  const wrappedAddress = lucid1A.newScript(wrappedValidator).toAddress();

  // WRAP UTXO IN A: Alice wraps 5 ADA in head A
  const wrappedDatum: AdhocLedgerV4WrappedDatum = {
    owner: Crypto.privateKeyToDetails(privateKey1).credential.hash,           // Alice address hash
    intermediaries: new Map([[Crypto.privateKeyToDetails(privateKey2).credential.hash, 5_000_000n]]),  // Ida as intermediary with 5 ADA
    nonce: { transactionId: "", outputIndex: 0n },  // Empty nonce for now
    disputed: false,  // Not disputed initially
    timeout: null,  // No timeout initially
  }
  const wrapTxA = await lucid1A.newTx()
    .payToContract(
      wrappedAddress,
      { Inline: Data.to(wrappedDatum, AdhocLedgerV4WrappedSpend.datumOpt) },
      { lovelace: 5000000n },
    )
    .commit();
  const signedWrapTxA = await wrapTxA.sign().commit();
  const wrapTxAHash = await signedWrapTxA.submit();
  emulatorA.awaitTx(wrapTxAHash);
  console.log("WRAP TX A:", wrapTxAHash);

  // WRAP UTXO IN B: Ida wraps 5 ADA in head B on behalf of Alice
  const wrappedDatumB: AdhocLedgerV4WrappedDatum = {
    owner: Crypto.privateKeyToDetails(privateKey1).credential.hash,           // Alice address hash
    intermediaries: new Map([[Crypto.privateKeyToDetails(privateKey2).credential.hash, 5_000_000n]]),  // Ida as intermediary with 5 ADA
    nonce: { transactionId: "", outputIndex: 0n },  // Empty nonce for now
    disputed: false,  // Not disputed initially
    timeout: null,  // No timeout initially
  }
  const wrapTxB = await lucid2B.newTx()
    .payToContract(
      wrappedAddress,
      { Inline: Data.to(wrappedDatumB, AdhocLedgerV4WrappedSpend.datumOpt) },
      { lovelace: 5000000n },
    )
    .commit();
  const signedWrapTxB = await wrapTxB.sign().commit();
  const wrapTxBHash = await signedWrapTxB.submit();
  emulatorB.awaitTx(wrapTxBHash);
  console.log("WRAP TX B:", wrapTxBHash);

  return { wrappedValidator, wrappedAddress, wrappedDatum };
}

// Check if this file is being executed directly or imported
if (import.meta.main) {
  // This file is being executed directly (e.g., deno run wrap.ts)
  console.log("Running wrap.ts as main module...");

  // Setup environment
  const env = setupWrapEnvironment();

  // Perform wrap transactions
  await performWrapTransactions(env.lucid1A, env.lucid2B, env.privateKey1, env.privateKey2, env.emulatorA, env.emulatorB);

  console.log("Wrap transactions completed successfully!");
} else {
  // This file is being imported by another module
  console.log("wrap.ts imported as module");
}
