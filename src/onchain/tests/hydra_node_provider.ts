/**
 * HydraNodeProvider — Lucid Provider backed by a real Hydra head node.
 *
 * Implements the same Provider interface as HydraEmulator so that Lucid
 * scripts (wrap, verify, unwrap, dispute) can run against real heads
 * without code changes.
 */

import {
  type ActiveDelegation,
  type Credential,
  type Network,
  type OutRef,
  paymentCredentialOf,
  type Provider,
  type RelevantProtocolParameters,
  type Utxo,
} from "https://deno.land/x/lucid@0.20.14/mod.ts";

import { HydraHandler } from "./hydra_handler.ts";

// Resolve relative to this file so it works regardless of CWD (e.g. from demo/)
const PROTOCOL_PARAMETERS_PATH = new URL("./infra/protocol-parameters.json", import.meta.url).pathname;

export class HydraNodeProvider implements Provider {
  network?: Network;
  private handler: HydraHandler;
  private protocolParams?: RelevantProtocolParameters;

  constructor(handler: HydraHandler) {
    this.handler = handler;
    this.network = { Emulator: 42 };
  }

  /** Access the underlying handler (e.g. for getHeadStatus, stop). */
  getHandler(): HydraHandler {
    return this.handler;
  }

  // ── Protocol parameters ────────────────────────────────────

  async getProtocolParameters(): Promise<RelevantProtocolParameters> {
    if (this.protocolParams) return this.protocolParams;

    const raw = JSON.parse(await Deno.readTextFile(PROTOCOL_PARAMETERS_PATH));

    this.protocolParams = {
      // Hydra sets fees to 0, but Lucid's WASM builder skips collateral when
      // fee=0. A 1-lovelace fixed fee triggers collateral inclusion for Plutus
      // script txs. Hydra accepts any fee ≥ 0.
      minFeeA: raw.txFeeFixed || 1,
      minFeeB: raw.txFeePerByte ?? 0,
      maxTxSize: raw.maxTxSize ?? 25000,
      maxValSize: raw.maxValueSize ?? 5000,
      keyDeposit: raw.stakeAddressDeposit ?? 2000000,
      poolDeposit: raw.stakePoolDeposit ?? 500000000,
      priceMem: raw.executionUnitPrices?.priceMemory ?? 0,
      priceStep: raw.executionUnitPrices?.priceSteps ?? 0,
      // BigInt — JSON values may exceed Number.MAX_SAFE_INTEGER; WASM expects u64
      maxTxExMem: BigInt(raw.maxTxExecutionUnits?.memory ?? 14000000000000),
      maxTxExSteps: BigInt(raw.maxTxExecutionUnits?.steps ?? 10000000000000000),
      coinsPerUtxoByte: raw.utxoCostPerByte ?? 4310,
      collateralPercentage: raw.collateralPercentage ?? 150,
      maxCollateralInputs: raw.maxCollateralInputs ?? 3,
      minfeeRefscriptCostPerByte: raw.minFeeRefScriptCostPerByte ?? 15,
      costModels: raw.costModels ?? {},
    };

    return this.protocolParams;
  }

  // ── UTxO queries ───────────────────────────────────────────

  async getUtxos(addressOrCredential: string | Credential): Promise<Utxo[]> {
    const snapshot = await this.handler.getSnapshot();
    if (typeof addressOrCredential === "string") {
      return snapshot.filter((u) => u.address === addressOrCredential);
    }
    return snapshot.filter((u) => {
      try {
        return (
          paymentCredentialOf(u.address).hash === addressOrCredential.hash
        );
      } catch {
        return false;
      }
    });
  }

  async getUtxosWithUnit(
    addressOrCredential: string | Credential,
    unit: string,
  ): Promise<Utxo[]> {
    const utxos = await this.getUtxos(addressOrCredential);
    return utxos.filter((u) => (u.assets[unit] ?? 0n) > 0n);
  }

  async getUtxoByUnit(unit: string): Promise<Utxo> {
    const snapshot = await this.handler.getSnapshot();
    const matches = snapshot.filter((u) => (u.assets[unit] ?? 0n) > 0n);
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly 1 UTxO with unit ${unit}, found ${matches.length}`,
      );
    }
    return matches[0];
  }

  async getUtxosByOutRef(outRefs: OutRef[]): Promise<Utxo[]> {
    const snapshot = await this.handler.getSnapshot();
    return snapshot.filter((u) =>
      outRefs.some(
        (r) => r.txHash === u.txHash && r.outputIndex === u.outputIndex,
      ),
    );
  }

  // ── Not applicable in Hydra heads ──────────────────────────

  getDatum(_datumHash: string): Promise<string> {
    throw new Error("getDatum not supported on Hydra heads");
  }

  getDelegation(_rewardAddress: string): Promise<ActiveDelegation> {
    throw new Error("getDelegation not supported on Hydra heads");
  }

  // ── Transaction lifecycle ──────────────────────────────────

  /**
   * Submit a signed transaction into the Hydra head.
   * Sends NewTx via WebSocket, waits for TxValid, returns the tx hash.
   */
  async submit(tx: string): Promise<string> {
    return await this.handler.sendTx(tx);
  }

  /**
   * Wait until a transaction appears in the head's snapshot.
   * Hydra confirms txs instantly, so this typically resolves on first poll.
   */
  async awaitTx(txHash: string, checkInterval = 1000): Promise<boolean> {
    for (let i = 0; i < 20; i++) {
      const snapshot = await this.handler.getSnapshot();
      if (snapshot.some((u) => u.txHash === txHash)) return true;
      await new Promise((r) => setTimeout(r, checkInterval));
    }
    return false;
  }
}
