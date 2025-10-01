import { CML, LucidEvolution, UTxO, utxoToCore } from '@lucid-evolution/lucid';

export function buildInputs(sortedInputs: UTxO[]): CML.TransactionInputList {
  const inputs = CML.TransactionInputList.new();
  sortedInputs.map((utxo) => {
    const cmlInput = utxoToCore(utxo).input();
    inputs.add(cmlInput);
  });
  return inputs;
}

export function buildTxBody(
  inputs: CML.TransactionInputList,
  outputs: CML.TransactionOutputList,
  minting: CML.Mint | undefined
): CML.TransactionBody {
  const fee = 0n;
  const txBody = CML.TransactionBody.new(inputs, outputs, fee);
  if (minting) {
    txBody.set_mint(minting);
  }
  return txBody;
}

export function setCollateralInputs(
  txBody: CML.TransactionBody,
  adminCollateral: UTxO
) {
  const collateral = CML.TransactionInputList.new();
  const cmlInput = utxoToCore(adminCollateral).input();
  collateral.add(cmlInput);
  txBody.set_collateral_inputs(collateral);
}

export function setRequiredSigners(
  txBody: CML.TransactionBody,
  adminKey: string
) {
  const signer = CML.Ed25519KeyHash.from_hex(adminKey);
  const signers = CML.Ed25519KeyHashList.new();
  signers.add(signer);
  txBody.set_required_signers(signers);
}

export function setPlutusScripts(
  txWitnessSet: CML.TransactionWitnessSet,
  validator: string
) {
  const scripts = CML.PlutusV3ScriptList.new();
  const script = CML.PlutusV3Script.from_cbor_hex(validator);
  scripts.add(script);
  txWitnessSet.set_plutus_v3_scripts(scripts);
}

export function addMintRedeemer(
  legacyRedeemers: CML.LegacyRedeemerList,
  mintRedeemer?: string
) {
  if (!mintRedeemer) return;
  legacyRedeemers.add(
    CML.LegacyRedeemer.new(
      CML.RedeemerTag.Mint,
      0n,
      CML.PlutusData.from_cbor_hex(mintRedeemer),
      CML.ExUnits.new(3_000_000n, 3_000_000_000n)
    )
  );
}

export function setRedeemers(
  txWitnessSet: CML.TransactionWitnessSet,
  legacyRedeemers: CML.LegacyRedeemerList
) {
  const redeemers = CML.Redeemers.new_arr_legacy_redeemer(legacyRedeemers);
  txWitnessSet.set_redeemers(redeemers);
}

export function setScriptDataHash(
  lucid: LucidEvolution,
  txBody: CML.TransactionBody,
  txWitnessSet: CML.TransactionWitnessSet
) {
  const costModels = lucid.config().costModels;
  if (!costModels) {
    throw new Error('Cost models not set in Lucid configuration');
  }
  const language = CML.LanguageList.new();
  language.add(CML.Language.PlutusV3);
  const scriptDataHash = CML.calc_script_data_hash(
    txWitnessSet.redeemers()!,
    CML.PlutusDataList.new(),
    costModels,
    language
  );
  if (!scriptDataHash) {
    throw new Error(`Could not calculate script data hash`);
  } else {
    txBody.set_script_data_hash(scriptDataHash);
  }
}
