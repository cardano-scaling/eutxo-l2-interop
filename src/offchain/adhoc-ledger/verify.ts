/**
 * Do verify a wrap operation for head 1.
 * Collect a UTxO from alice's address, pay it to the lp script and mint and attach a validity token to said utxo.
 * TODO The intermediaries should do the same operation in head 2 .
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
// search for a utxo owned by alice
lucidAlice.selectWallet.fromPrivateKey(alicePrivateKey.to_bech32());
const [aliceUtxo,] = await lucidAlice.wallet().getUtxos()

const LpMintRedeemerSchema = Data.Enum([
  Data.Object({ MintVerified: Data.Tuple([]) }),
  Data.Object({ BurnVerified: Data.Tuple([]) }),
]);

type LpMintRedeemerT = Data.Static<typeof LpMintRedeemerSchema>;
const LpMintRedeemer = LpMintRedeemerSchema as unknown as LpMintRedeemerT;

const VerificationKeyHashSchema = Data.Bytes()

const LpDatumSchema = Data.Object({
  owner: VerificationKeyHashSchema,
  intermediaries: Data.Array(VerificationKeyHashSchema)
})
type LpDatumT = Data.Static<typeof LpDatumSchema>
const LpDatum = LpDatumSchema as unknown as LpDatumT

const aliceVerifyTx = await lucidAlice
  .newTx()
  .collectFrom([aliceUtxo])
  .mintAssets({ [lpScriptHash]: 1n }, Data.to<LpMintRedeemerT>({ MintVerified: [] }, LpMintRedeemer))
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
    { lovelace: 100_000_000n, [lpScriptHash]: 1n },
  )
  // collect the needed signatures: intermediaries
  .addSignerKey(idaVerificationKey.hash().to_hex())
  .complete()

const aliceVerifyTxSigned = await aliceVerifyTx
  .sign.withWallet()
  .sign.withPrivateKey(idaPrivateKey.to_bech32())
  .complete();

const snapshotBeforeTx = await aliceNodeHandler.getSnapshot();
logger.info('Snapshot before tx');
logger.info(snapshotBeforeTx);

const submittedTx = await aliceVerifyTxSigned.submit();
logger.info(submittedTx);
while (!await lucidAlice.awaitTx(submittedTx, 3000)) {}

const snapshotAfterTx = await aliceNodeHandler.getSnapshot();
logger.info('Snapshot after tx');
logger.info(snapshotAfterTx);

process.exit(0);
