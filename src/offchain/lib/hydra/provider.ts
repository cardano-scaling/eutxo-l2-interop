import { Address, CML, OutRef, ProtocolParameters, Provider, Unit, UTxO, Credential, RewardAddress, Delegation, Datum, DatumHash, TxHash, Transaction, EvalRedeemer } from "@lucid-evolution/lucid";
import { join } from 'path';
import { HydraHandler } from './handler';
import { logger } from '../logger';
import { readFileSync } from "fs";

// load and convert protocol parameters
const protocolParametersFromFile = JSON.parse(readFileSync(join(process.cwd(), '../infra/protocol-parameters.json'), 'utf8'));

class HydraProvider implements Provider {

  constructor(private readonly hydra: HydraHandler) {
    this.hydra = hydra;
  }

  async getProtocolParameters(): Promise<ProtocolParameters> {
    const protocolParameters: ProtocolParameters = {
      minFeeA: protocolParametersFromFile.txFeeFixed,
      minFeeB: protocolParametersFromFile.txFeePerByte,
      maxTxSize: protocolParametersFromFile.maxTxSize,
      maxValSize: protocolParametersFromFile.maxValueSize,
      keyDeposit: BigInt(protocolParametersFromFile.stakeAddressDeposit),
      poolDeposit: BigInt(protocolParametersFromFile.stakePoolDeposit),
      drepDeposit: BigInt(protocolParametersFromFile.dRepDeposit),
      govActionDeposit: BigInt(protocolParametersFromFile.govActionDeposit),
      priceMem: protocolParametersFromFile.executionUnitPrices.priceMemory,
      priceStep: protocolParametersFromFile.executionUnitPrices.priceSteps,
      maxTxExMem: BigInt(protocolParametersFromFile.maxTxExecutionUnits.memory),
      maxTxExSteps: BigInt(protocolParametersFromFile.maxTxExecutionUnits.steps),
      coinsPerUtxoByte: BigInt(protocolParametersFromFile.utxoCostPerByte),
      collateralPercentage: protocolParametersFromFile.collateralPercentage,
      maxCollateralInputs: protocolParametersFromFile.maxCollateralInputs,
      minFeeRefScriptCostPerByte: protocolParametersFromFile.minFeeRefScriptCostPerByte,
      costModels: protocolParametersFromFile.costModels,
    }
    return protocolParameters;
  }

  async getUtxos(addressOrCredential: Address | Credential): Promise<UTxO[]> {
    const result: UTxO[] = [];

    const snapshotUTxOs = await this.hydra.getSnapshot();
    const addressAsBech32 = typeof addressOrCredential === 'string'
      ? addressOrCredential // already bech32
      : CML.Address.from_hex(addressOrCredential.hash).to_bech32();
    snapshotUTxOs.forEach((utxo) => {
      if (utxo.address === addressAsBech32) {
        result.push(utxo);
      }
    });
    return result;
  }

  async getUtxosWithUnit(addressOrCredential: Address | Credential, unit: Unit): Promise<UTxO[]> {
    const result: UTxO[] = [];
    const utxos = await this.getUtxos(addressOrCredential);
    utxos.filter((utxo) => utxo.assets[unit] > 0n);
    return result;
  }

  async getUtxoByUnit(unit: Unit): Promise<UTxO> {
    const utxos = await this.hydra.getSnapshot();
    const utxosWithUnit = utxos.filter((utxo) => utxo.assets[unit] > 0n);
    if (utxosWithUnit.length !== 1) {
      throw new Error(`UTxOs with unit ${unit} found: ${utxosWithUnit}`);
    }
    return utxosWithUnit[0];
  }

  async getUtxosByOutRef(outRefs: Array<OutRef>): Promise<UTxO[]> {
    const utxos = await this.hydra.getSnapshot();
    return utxos.filter((utxo) => outRefs.some(
      (outRef) =>
        outRef.txHash === utxo.txHash
          && outRef.outputIndex === utxo.outputIndex
      ),
    );
  }

  async getDelegation(rewardAddress: RewardAddress): Promise<Delegation> {
    throw new Error('Not implemented');
  }

  async getDatum(datumHash: DatumHash): Promise<Datum> {
    throw new Error('Not implemented');
  }

  async awaitTx(txHash: TxHash, checkInterval: number = 5000): Promise<boolean> {
    logger.info(`Waiting for ${checkInterval} milliseconds`);
    let snapshot = await this.hydra.getSnapshot();
    while (!snapshot.some((utxo) => utxo.txHash === txHash)) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      snapshot = await this.hydra.getSnapshot();
    }
    return true;
  }

  async submitTx(tx: Transaction): Promise<TxHash> {
    const txValidity = await this.hydra.sendTx(tx);
    if (txValidity === 'TxValid') {
      // calculate tx hash
      const cmlTx = CML.Transaction.from_cbor_hex(tx)
      const txHash = CML.hash_transaction(cmlTx.body());
      return txHash.to_hex();
    }
    throw new Error('Transaction not valid');
  }

  async evaluateTx(tx: Transaction, additionalUTxOs?: UTxO[]): Promise<EvalRedeemer[]> {
    throw new Error('Not implemented');
  }
}

export { HydraProvider };