/**
 * Do perform of a wrap operation for head 1.
 * Wrap operation means moving funds to the lp script. This could be archieved without using this mechanism in
 * the current version of the adhoc ledger, but for a future enhancement where the perform tx inputs will be constrained
 * by the validator, we will need to use this mechanism.
 */

import { HydraHandler } from "../lib/hydra/handler";
import { HydraProvider } from "../lib/hydra/provider";
import { Lucid, validatorToAddress } from "@lucid-evolution/lucid";
import { logger } from "../lib/logger";
import { readFileSync } from 'fs';
import { join } from 'path';
import { Data, SLOT_CONFIG_NETWORK } from "@lucid-evolution/plutus";
import { getNetworkFromLucid, getScriptInfo, getUserNodeAndKeys } from "../lib/utils";

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
  sk: idaPrivateKey,
  vk: idaVerificationKey
} = getUserNodeAndKeys({ name: "ida", head: 1 });

// instantiate the hydra handler, provider, and lucid for alice
const aliceNodeHandler = new HydraHandler(aliceNodeHeadUrl);
const lucidAlice = await Lucid(new HydraProvider(aliceNodeHandler), "Custom");

// get lp script from head 1, from filesystem
const [lpScript, lpScriptHash] = getScriptInfo({ filename: "adhoc_ledger_v2", scriptName: "lp_v2" }, "spend");
const lpScriptAddress = validatorToAddress(
  getNetworkFromLucid(lucidAlice),
  { type: "PlutusV3", script: lpScript }
);
// search for the utxo owned by alice that has the verified token attached
lucidAlice.selectWallet.fromPrivateKey(alicePrivateKey.to_bech32());
const [aliceScriptUtxo] = await lucidAlice.utxosAt(lpScriptAddress);

const LpMintRedeemerSchema = Data.Enum([
  Data.Object({ MintVerified: Data.Tuple([]) }),
  Data.Object({ BurnVerified: Data.Tuple([]) }),
]);

type LpMintRedeemerT = Data.Static<typeof LpMintRedeemerSchema>;
const LpMintRedeemer = LpMintRedeemerSchema as unknown as LpMintRedeemerT;

const LpSpendRedeemerSchema = Data.Enum([
  Data.Object({ Verify: Data.Tuple([]) }),
  Data.Object({ Perform: Data.Tuple([]) }),
]);
type LpSpendRedeemerT = Data.Static<typeof LpSpendRedeemerSchema>;
const LpSpendRedeemer = LpSpendRedeemerSchema as unknown as LpSpendRedeemerT;

const VerificationKeyHashSchema = Data.Bytes()

const LpDatumSchema = Data.Object({
  owner: VerificationKeyHashSchema,
  intermediaries: Data.Array(VerificationKeyHashSchema)
})
type LpDatumT = Data.Static<typeof LpDatumSchema>
const LpDatum = LpDatumSchema as unknown as LpDatumT

const alicePerformTx = await lucidAlice
  .newTx()
  .collectFrom([aliceScriptUtxo], Data.to<LpSpendRedeemerT>({ Perform: [] }, LpSpendRedeemer))
  .mintAssets({ [lpScriptHash]: -1n }, Data.to<LpMintRedeemerT>({ BurnVerified: [] }, LpMintRedeemer))
  .attach.MintingPolicy({ type: "PlutusV3", script: lpScript })
  // pay the alice utxo to the lp script with the validity token
  .pay.ToContract(
    lpScriptAddress,
    {
      kind: "inline",
      value: Data.to<LpDatumT>({
        owner: aliceVerificationKey.hash().to_hex(),
        intermediaries: [idaVerificationKey.hash().to_hex()]
      }, LpDatum),
    },
    { lovelace: aliceScriptUtxo.assets.lovelace },
  )
  // collect the needed signatures: intermediaries and owner
  .addSignerKey(idaVerificationKey.hash().to_hex())
  .addSignerKey(aliceVerificationKey.hash().to_hex())
  .complete()

const alicePerformTxSigned = await alicePerformTx
  .sign.withWallet()
  .sign.withPrivateKey(idaPrivateKey.to_bech32())
  .complete();

const snapshotBeforeTx = await aliceNodeHandler.getSnapshot();
logger.info('Snapshot before tx');
logger.info(snapshotBeforeTx);

const submittedTx = await alicePerformTxSigned.submit();
logger.info(submittedTx);
while (!await lucidAlice.awaitTx(submittedTx, 3000)) {}

const snapshotAfterTx = await aliceNodeHandler.getSnapshot();
logger.info('Snapshot after tx');
logger.info(snapshotAfterTx);

process.exit(0);
