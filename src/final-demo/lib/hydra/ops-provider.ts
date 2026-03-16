import {
  CML,
  credentialToAddress,
  type Address,
  type Credential,
  type EvalRedeemer,
  type OutRef,
  type ProtocolParameters,
  type Provider,
  type Transaction,
  type TxHash,
  type Unit,
  type UTxO,
} from "@lucid-evolution/lucid";
import { readFileSync } from "node:fs";
import { HydraOpsHandler, txHashFromCbor } from "./ops-handler";
import { configPath } from "@/lib/runtime-paths";

let protocolParametersCache: any | null = null;

function getProtocolParameters(): any {
  if (protocolParametersCache) return protocolParametersCache;
  try {
    protocolParametersCache = JSON.parse(
      readFileSync(configPath("protocol-parameters.json"), "utf8"),
    ) as any;
    return protocolParametersCache;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Missing protocol parameters at config/protocol-parameters.json (${message})`);
  }
}

export class HydraOpsProvider implements Provider {
  constructor(private readonly hydra: HydraOpsHandler) {}

  async getProtocolParameters(): Promise<ProtocolParameters> {
    const protocolParameters = getProtocolParameters();
    return {
      minFeeA: protocolParameters.txFeeFixed,
      minFeeB: protocolParameters.txFeePerByte,
      maxTxSize: protocolParameters.maxTxSize,
      maxValSize: protocolParameters.maxValueSize,
      keyDeposit: BigInt(protocolParameters.stakeAddressDeposit),
      poolDeposit: BigInt(protocolParameters.stakePoolDeposit),
      drepDeposit: BigInt(protocolParameters.dRepDeposit),
      govActionDeposit: BigInt(protocolParameters.govActionDeposit),
      priceMem: protocolParameters.executionUnitPrices.priceMemory,
      priceStep: protocolParameters.executionUnitPrices.priceSteps,
      maxTxExMem: BigInt(protocolParameters.maxTxExecutionUnits.memory),
      maxTxExSteps: BigInt(protocolParameters.maxTxExecutionUnits.steps),
      coinsPerUtxoByte: BigInt(protocolParameters.utxoCostPerByte),
      collateralPercentage: protocolParameters.collateralPercentage,
      maxCollateralInputs: protocolParameters.maxCollateralInputs,
      minFeeRefScriptCostPerByte: protocolParameters.minFeeRefScriptCostPerByte,
      costModels: protocolParameters.costModels,
    };
  }

  async getUtxos(addressOrCredential: Address | Credential): Promise<UTxO[]> {
    const utxos = await this.hydra.getSnapshot();
    if (typeof addressOrCredential === "string") {
      return utxos.filter((utxo) => utxo.address === addressOrCredential);
    }
    const address = credentialToAddress("Custom", addressOrCredential);
    return utxos.filter((utxo) => utxo.address === address);
  }

  async getUtxosWithUnit(addressOrCredential: Address | Credential, unit: Unit): Promise<UTxO[]> {
    const utxos = await this.getUtxos(addressOrCredential);
    return utxos.filter((utxo) => (utxo.assets[unit] ?? 0n) > 0n);
  }

  async getUtxoByUnit(unit: Unit): Promise<UTxO> {
    const utxos = await this.hydra.getSnapshot();
    const found = utxos.filter((utxo) => (utxo.assets[unit] ?? 0n) > 0n);
    if (found.length !== 1) {
      throw new Error(`Expected exactly one UTxO with unit ${unit}, found ${found.length}`);
    }
    return found[0];
  }

  async getUtxosByOutRef(outRefs: OutRef[]): Promise<UTxO[]> {
    const utxos = await this.hydra.getSnapshot();
    return utxos.filter((utxo) =>
      outRefs.some((outRef) => outRef.txHash === utxo.txHash && outRef.outputIndex === utxo.outputIndex),
    );
  }

  async getDelegation(): Promise<any> {
    throw new Error("Not implemented");
  }

  async getDatum(): Promise<any> {
    throw new Error("Not implemented");
  }

  async awaitTx(txHash: TxHash, checkInterval = 2000): Promise<boolean> {
    // Hydra snapshot contains outputs from tx once confirmed in head.
    for (let i = 0; i < 30; i++) {
      const snapshot = await this.hydra.getSnapshot();
      if (snapshot.some((utxo) => utxo.txHash === txHash)) return true;
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }
    return false;
  }

  async submitTx(tx: Transaction): Promise<TxHash> {
    const validity = await this.hydra.sendTx(tx);
    if (validity !== "TxValid") {
      throw new Error(`Hydra rejected tx with status ${validity}`);
    }
    return txHashFromCbor(tx);
  }

  async evaluateTx(_tx: Transaction, _additionalUTxOs?: UTxO[]): Promise<EvalRedeemer[]> {
    throw new Error("Not implemented");
  }
}
