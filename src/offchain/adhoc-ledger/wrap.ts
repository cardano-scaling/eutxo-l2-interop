/**
 * Wrap UTxOs in the ad-hoc ledger.
 * Alice will wrap UTxOs in head 1, and Ida will wrap UTxOs in head 2.
 */

import { HydraHandler } from "../lib/hydra/handler";
import { HydraProvider } from "../lib/hydra/provider";
import { applyDoubleCborEncoding, applyParamsToScript, Lucid, validatorToAddress, validatorToScriptHash } from "@lucid-evolution/lucid";
import { logger } from "../lib/logger";
import { readFileSync } from 'fs';
import { join } from 'path';
import { Data, SLOT_CONFIG_NETWORK } from "@lucid-evolution/plutus";
import { getNetworkFromLucid, getUserNodeAndKeys, utxoSetSymmetricDiff } from "../lib/utils";

const startupTime = readFileSync(join(process.cwd(), '../infra/startup_time.txt'), 'utf8');
const startupTimeMs = parseInt(startupTime);

SLOT_CONFIG_NETWORK["Custom"] = {
  zeroTime: startupTimeMs,
  zeroSlot: 0,
  slotLength: 1000
};

const {
  nodeUrl: aliceNodeHeadUrl,
  sk: alicePrivateKey,
  vk: aliceVerificationKey
} = getUserNodeAndKeys({ name: "alice", head: 1 });
const {
  nodeUrl: idaNodeHeadUrl,
  sk: idaPrivateKey,
  vk: idaVerificationKey
} = getUserNodeAndKeys({ name: "ida", head: 2 });

// instantiate the hydra handler, provider, and lucid for alice
const aliceNodeHandler = new HydraHandler(aliceNodeHeadUrl);
const lucidAlice = await Lucid(new HydraProvider(aliceNodeHandler), "Custom");

// select alice wallet
lucidAlice.selectWallet.fromPrivateKey(alicePrivateKey.to_bech32());

// get script from filesystem (with applied parameter)
const lpScript1 = readFileSync(join(process.cwd(), `./adhoc-ledger/lp_script_head_1.cbor`), 'utf8');
console.log(lpScript1);
const network = getNetworkFromLucid(lucidAlice);
const lpScriptAddress1 = validatorToAddress(network, { type: "PlutusV3", script: lpScript1 })

// build wrapped utxo datum

const VerificationKeyHashSchema = Data.Bytes()
const ScriptHashSchema = Data.Bytes()

const CredentialSchema = Data.Enum([
  Data.Object({
    VerificationKeyHash: Data.Tuple([VerificationKeyHashSchema])
  }),
  Data.Object({
    ScriptHash: Data.Tuple([ScriptHashSchema])
  })
]);
// map the VerificationKey and Script field, since they are always singletons
type CredentialT = Data.Static<typeof CredentialSchema>
const Credential = CredentialSchema as unknown as CredentialT

const WrappedDatumSchema = Data.Object({
  owner: CredentialSchema,
  intermediaries: Data.Array(CredentialSchema)
})
type WrappedDatumT = Data.Static<typeof WrappedDatumSchema>
const WrappedDatum = WrappedDatumSchema as unknown as WrappedDatumT

const wrappedUtxoDatum1: WrappedDatumT = {
  // owner is alice
  owner: { VerificationKeyHash: [aliceVerificationKey.hash().to_hex()] },
  // intermediaries are [ida]
  intermediaries: [
    { VerificationKeyHash: [idaVerificationKey.hash().to_hex()] },
  ],
}
const datum1 = Data.to<WrappedDatumT>(wrappedUtxoDatum1, WrappedDatum)

logger.info('Wrap UTxOs on head 1');

const tx = await lucidAlice
  .newTx()
  .pay.ToContract(
    lpScriptAddress1,
    { kind: "inline", value: datum1 },
    { lovelace: 999_999_999n },
  )
  .complete();

const txSigned = await tx.sign.withWallet().complete();

const snapshotBeforeTx = await aliceNodeHandler.getSnapshot();
logger.info('Snapshot before tx');
logger.info(snapshotBeforeTx);

const submittedTx = await txSigned.submit();
logger.info(submittedTx);
while (!await lucidAlice.awaitTx(submittedTx, 3000)) {}

const snapshotAfterTx = await aliceNodeHandler.getSnapshot();
logger.info('Snapshot after tx');
logger.info(snapshotAfterTx);

logger.info('UTxO set diff:');
logger.info(utxoSetSymmetricDiff(snapshotBeforeTx, snapshotAfterTx));


logger.info('Now wrap UTxOs on head 2');

// instantiate the hydra handler, provider, and lucid for ida
const idaNodeHandler = new HydraHandler(idaNodeHeadUrl);
const lucidIda = await Lucid(new HydraProvider(idaNodeHandler), "Custom");

// select ida wallet
lucidIda.selectWallet.fromPrivateKey(idaPrivateKey.to_bech32());

// get script from filesystem (with applied parameter)
const lpScript2 = readFileSync(join(process.cwd(), `./adhoc-ledger/lp_script_head_2.cbor`), 'utf8');
console.log(lpScript2);
const lpScriptAddress2 = validatorToAddress(network, { type: "PlutusV3", script: lpScript2 })

const wrappedUtxoDatum2: WrappedDatumT = {
  // owner is ida
  owner: { VerificationKeyHash: [idaVerificationKey.hash().to_hex()] },
  // intermediaries are [ida]
  intermediaries: [
    { VerificationKeyHash: [idaVerificationKey.hash().to_hex()] },
  ],
}
const datum2 = Data.to<WrappedDatumT>(wrappedUtxoDatum2, WrappedDatum)

const tx2 = await lucidIda
  .newTx()
  .pay.ToContract(
    lpScriptAddress2,
    { kind: "inline", value: datum2 },
    { lovelace: 999_999_999n },
  )
  .complete();

const tx2Signed = await tx2.sign.withWallet().complete();

const snapshotBeforeTx2 = await idaNodeHandler.getSnapshot();
logger.info('Snapshot before tx2');
logger.info(snapshotBeforeTx2);

const submittedTx2 = await tx2Signed.submit();
logger.info(submittedTx2);
while (!await lucidIda.awaitTx(submittedTx2, 3000)) {}

const snapshotAfterTx2 = await idaNodeHandler.getSnapshot();
logger.info('Snapshot after tx2');
logger.info(snapshotAfterTx2);

logger.info('UTxO set diff:');
logger.info(utxoSetSymmetricDiff(snapshotBeforeTx2, snapshotAfterTx2));

process.exit(0);

