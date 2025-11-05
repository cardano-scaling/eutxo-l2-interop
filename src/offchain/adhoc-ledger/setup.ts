/**
 * Initial setup of the adhoc ledger: create the Reserved UTxO in both heads.
 * Is easier if Ida does it, since it is present in both heads.
 */

import { HydraHandler } from "../lib/hydra/handler";
import { HydraProvider } from "../lib/hydra/provider";
import { applyDoubleCborEncoding, applyParamsToScript, CML, Lucid, validatorToAddress, validatorToScriptHash } from "@lucid-evolution/lucid";
import { logger } from "../lib/logger";
import { readFileSync } from 'fs';
import { join } from 'path';
import { Data, SLOT_CONFIG_NETWORK } from "@lucid-evolution/plutus";
import { getNetworkFromLucid, getScriptInfo } from "../lib/utils";

const startupTime = readFileSync(join(process.cwd(), '../infra/startup_time.txt'), 'utf8');
const startupTimeMs = parseInt(startupTime);

SLOT_CONFIG_NETWORK["Custom"] = {
  zeroTime: startupTimeMs,
  zeroSlot: 0,
  slotLength: 1000
};

const [lpScriptBytes, _] = getScriptInfo({ filename: "adhoc_ledger", scriptName: "lp" }, "mint")
const idaNodeHead1Url = "http://127.0.0.1:4003";
const idaNodeHead2Url = "http://127.0.0.1:4004";

// instantiate the hydra handler, provider, and lucid
const idaNode1Handler = new HydraHandler(idaNodeHead1Url);
const lucid1 = await Lucid(new HydraProvider(idaNode1Handler), "Custom");

// get ida private key
const skPath = join(process.cwd(), `../infra/credentials/ida/ida-funds.sk`);
const sk = JSON.parse(readFileSync(skPath, 'utf8'));
const skBytes = Buffer.from(sk.cborHex, 'hex');
const idaPrivateKey = CML.PrivateKey.from_normal_bytes(skBytes.subarray(2));

// select ida wallet
lucid1.selectWallet.fromPrivateKey(idaPrivateKey.to_bech32());

// build initial datum
const OutputReferenceSchema = Data.Object({
  transaction_id: Data.Bytes(),
  output_index: Data.Integer(),
})
type OutputReferenceT = Data.Static<typeof OutputReferenceSchema>
const OutputReference = OutputReferenceSchema as unknown as OutputReferenceT

const ReservedDatumSchema = Data.Object({
  reserved_utxos: Data.Map(
    Data.Bytes(), // perform tx has
    Data.Array(OutputReferenceSchema) // list of reserved output reference
  ),
})
type ReservedDatumT = Data.Static<typeof ReservedDatumSchema>
const ReservedDatum = ReservedDatumSchema as unknown as ReservedDatumT

const reservedDatum = {
  reserved_utxos: new Map(),
}

// build initial redeemer
const redeemer = Data.void()

// build script parameter
const [idaUtxo] = await lucid1.wallet().getUtxos()
const lpScriptParam = {
  transaction_id: idaUtxo.txHash,
  output_index: BigInt(idaUtxo.outputIndex),
}

const ValidatorParamSchema = Data.Tuple([OutputReferenceSchema])
type ValidatorParamT = Data.Static<typeof ValidatorParamSchema>;
const ValidatorParam = ValidatorParamSchema as unknown as ValidatorParamT;

const lpScript = applyParamsToScript<ValidatorParamT>(
  applyDoubleCborEncoding(lpScriptBytes),
  [lpScriptParam],
  ValidatorParam
)
const lpScriptHash = validatorToScriptHash({ type: "PlutusV3", script: lpScript })

let datum = Data.to<ReservedDatumT>(reservedDatum, ReservedDatum)
const network = getNetworkFromLucid(lucid1);
const lpScriptAddress = validatorToAddress(network, { type: "PlutusV3", script: lpScript })

logger.info('Setup on head 1');

// create the reserved UTxO on head 1
const tx = await lucid1
  .newTx()
  .collectFrom([idaUtxo])
  .pay.ToContract(
    lpScriptAddress,
    { kind: "inline", value: datum },
    { [lpScriptHash]: 1n },
  )
  .mintAssets({ [lpScriptHash]: 1n }, redeemer)
  .attach.Script({ type: "PlutusV3", script: lpScript })
  .complete();

const txSigned = await tx.sign.withWallet().complete();

const snapshotBeforeTx = await idaNode1Handler.getSnapshot();
logger.info('Snapshot before tx');
logger.info(snapshotBeforeTx);

const submittedTx = await txSigned.submit();
logger.info(submittedTx);
while (!await lucid1.awaitTx(submittedTx, 3000)) {}

const snapshotAfterTx = await idaNode1Handler.getSnapshot();
logger.info('Snapshot after tx');
logger.info(snapshotAfterTx);

logger.info('Now setup on head 2');

// now do the setup on head 2
const idaNode2Handler = new HydraHandler(idaNodeHead2Url);
const lucid2 = await Lucid(new HydraProvider(idaNode2Handler), "Custom");
lucid2.selectWallet.fromPrivateKey(idaPrivateKey.to_bech32());

const [idaUtxo2] = await lucid2.wallet().getUtxos();
const lpScriptParam2 = {
  transaction_id: idaUtxo2.txHash,
  output_index: BigInt(idaUtxo2.outputIndex),
}

const lpScript2 = applyParamsToScript<ValidatorParamT>(
  applyDoubleCborEncoding(lpScriptBytes),
  [lpScriptParam2],
  ValidatorParam
)
const lpScriptHash2 = validatorToScriptHash({ type: "PlutusV3", script: lpScript2 })
const lpScriptAddress2 = validatorToAddress(network, { type: "PlutusV3", script: lpScript2 })

// create the reserved UTxO on head 2
const tx2 = await lucid2
  .newTx()
  .collectFrom([idaUtxo2])
  .pay.ToContract(
    lpScriptAddress2,
    { kind: "inline", value: datum },
    { [lpScriptHash2]: 1n },
  )
  .mintAssets({ [lpScriptHash2]: 1n }, redeemer)
  .attach.Script({ type: "PlutusV3", script: lpScript2 })
  .complete();

const tx2Signed = await tx2.sign.withWallet().complete();

const snapshotBeforeTx2 = await idaNode2Handler.getSnapshot();
logger.info('Snapshot before tx2');
logger.info(snapshotBeforeTx2);

const submittedTx2 = await tx2Signed.submit();
logger.info(submittedTx2);
while (!await lucid2.awaitTx(submittedTx2, 3000)) {}

const snapshotAfterTx2 = await idaNode2Handler.getSnapshot();
logger.info('Snapshot after tx2');
logger.info(snapshotAfterTx2);

process.exit(0);

