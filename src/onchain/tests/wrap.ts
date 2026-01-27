import { Addresses, Crypto, Data, Emulator, Lucid } from "https://deno.land/x/lucid@0.20.14/mod.ts";
import {
  AdhocLedgerV4WrappedDatum,
  AdhocLedgerV4WrappedSpend,
  CardanoTransactionOutputReference
} from "./plutus.ts";

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
const emulatorA = new Emulator([alice, ida]);
const emulatorB = new Emulator([ida, bob]);

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

//
// WRAP UTXO IN A: Alice wraps 5 ADA in head A
//
const wrappedValidator = new AdhocLedgerV4WrappedSpend();
const wrappedAddress = lucid1A.newScript(wrappedValidator).toAddress();
const wrappedDatum: AdhocLedgerV4WrappedDatum = {
  owner: "",           // TODO: Alice address here!
  intermediaries: [],  // TODO: Ida address here!
}
const wrapTxA = await lucid1A.newTx()
  .payToContract(
    wrappedAddress,
          { Inline: Data.to({
        owner: "",           // TODO: Alice address here!
        intermediaries: [],  // TODO: Ida address here!
      },
  AdhocLedgerV4WrappedSpend.datumOpt) },
    { lovelace: 5000000n },
  )
  .commit();
// console.log("TX:", wrapTxA.toString());
const signedWrapTxA = await wrapTxA.sign().commit();
const wrapTxAHash = await signedWrapTxA.submit();
// console.log("WRAP TX A:", signedWrapTxA.toString());
emulatorA.awaitTx(wrapTxAHash);
console.log("WRAP TX A:", wrapTxAHash);

//
// WRAP UTXO IN B: Ida wraps 5 ADA in head B on behalf of Alice
//
const wrappedAddressB = lucid2B.newScript(wrappedValidator).toAddress();
const wrappedDatumB: AdhocLedgerV4WrappedDatum = {
  owner: "",           // TODO: Alice address here!
  intermediaries: [],  // TODO: Ida address here!
}
const wrapTxB = await lucid2B.newTx()
  .payToContract(
    wrappedAddress,
    { Inline: Data.to(wrappedDatumB, AdhocLedgerV4WrappedSpend.datumOpt) },
    { lovelace: 5000000n },
  )
  .commit();
// console.log("TX:", wrapTxB.toString());
const signedWrapTxB = await wrapTxB.sign().commit();
const wrapTxBHash = await signedWrapTxB.submit();
// console.log("WRAP TX B:", signedWrapTxB.toString());
emulatorB.awaitTx(wrapTxBHash);
console.log("WRAP TX B:", wrapTxBHash);


// 
// VERIFY:
// 


// 
// PERFORM:
// 
