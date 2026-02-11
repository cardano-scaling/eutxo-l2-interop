/**
 * CardanoCliProvider — Lucid Provider for Cardano L1 via HTTP query API.
 *
 * Queries UTXOs and protocol parameters through a lightweight HTTP service
 * running inside the cardano-node container (socat + cardano-cli on port 1442).
 * Submits signed transactions through cardano-submit-api on port 8090.
 *
 * Requires: --allow-net (for fetch calls).
 */

import {
  Addresses,
  type ActiveDelegation,
  type Assets,
  type Credential,
  type Network,
  type OutRef,
  paymentCredentialOf,
  type Provider,
  type RelevantProtocolParameters,
  type Utxo,
  fromHex,
} from "https://deno.land/x/lucid@0.20.14/mod.ts";

// ============================================================
// Configuration
// ============================================================

const CARDANO_QUERY_API = "http://127.0.0.1:1442";
const CARDANO_SUBMIT_API = "http://127.0.0.1:8090/api/submit/tx";

// ============================================================
// CardanoCliProvider
// ============================================================

export class CardanoCliProvider implements Provider {
  network?: Network;
  private protocolParams?: RelevantProtocolParameters;

  constructor() {
    // Custom testnet with magic 42
    this.network = { Emulator: 42 };
  }

  // ── Protocol parameters ───────────────────────────────────

  async getProtocolParameters(): Promise<RelevantProtocolParameters> {
    if (this.protocolParams) return this.protocolParams;

    const response = await fetch(`${CARDANO_QUERY_API}/protocol-parameters`);
    if (!response.ok) {
      throw new Error(`Protocol parameters query failed: ${response.status} - ${await response.text()}`);
    }
    // Parse with BigInt revival: integers > MAX_SAFE_INTEGER (e.g. PlutusV2
    // costModel sentinels = i64::MAX) must stay exact or the WASM chokes on
    // the float approximation.  The regex wraps any bare integer ≥16 digits
    // in quotes so the JSON reviver can convert them to BigInt.
    const jsonText = await response.text();
    const raw = JSON.parse(
      jsonText.replace(/(?<=[\s,:\[])(-?\d{16,})(?=[\s,\]\}])/g, '"$1"'),
      (_key, value) =>
        typeof value === "string" && /^-?\d{16,}$/.test(value)
          ? BigInt(value)
          : value,
    );

    this.protocolParams = {
      minFeeA: raw.txFeeFixed ?? 44,
      minFeeB: raw.txFeePerByte ?? 155381,
      maxTxSize: raw.maxTxSize ?? 16384,
      maxValSize: raw.maxValueSize ?? 5000,
      keyDeposit: raw.stakeAddressDeposit ?? 2000000,
      poolDeposit: raw.stakePoolDeposit ?? 500000000,
      priceMem: raw.executionUnitPrices?.priceMemory ?? 0.0577,
      priceStep: raw.executionUnitPrices?.priceSteps ?? 0.0000721,
      maxTxExMem: BigInt(raw.maxTxExecutionUnits?.memory ?? 14000000),
      maxTxExSteps: BigInt(raw.maxTxExecutionUnits?.steps ?? 10000000000),
      coinsPerUtxoByte: raw.utxoCostPerByte ?? 4310,
      collateralPercentage: raw.collateralPercentage ?? 150,
      maxCollateralInputs: raw.maxCollateralInputs ?? 3,
      minfeeRefscriptCostPerByte: raw.minFeeRefScriptCostPerByte ?? 15,
      costModels: raw.costModels ?? {},
    };

    return this.protocolParams;
  }

  // ── UTxO queries ──────────────────────────────────────────

  /** Query L1 UTXOs at an address via the cardano query API. */
  async getUtxos(addressOrCredential: string | Credential): Promise<Utxo[]> {
    const addr = typeof addressOrCredential === "string"
      ? addressOrCredential
      : Addresses.credentialToAddress(this.network!, addressOrCredential);

    return this.queryUtxosByAddress(addr);
  }

  /** Low-level: fetch UTXOs from the query API by bech32 address. */
  private async queryUtxosByAddress(addr: string): Promise<Utxo[]> {
    const response = await fetch(
      `${CARDANO_QUERY_API}/utxo?address=${encodeURIComponent(addr)}`,
    );
    if (!response.ok) {
      throw new Error(`UTXO query failed: ${response.status} - ${await response.text()}`);
    }
    const data: Record<string, any> = await response.json();

    return Object.entries(data).map(([outRef, output]) => {
      const [txHash, idx] = outRef.split("#");
      return cliOutputToUtxo(txHash, Number(idx), output);
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
    throw new Error(
      `CardanoCliProvider.getUtxoByUnit not supported (unit: ${unit})`,
    );
  }

  async getUtxosByOutRef(outRefs: OutRef[]): Promise<Utxo[]> {
    const results: Utxo[] = [];
    for (const ref of outRefs) {
      const txin = `${ref.txHash}%23${ref.outputIndex}`;
      const response = await fetch(
        `${CARDANO_QUERY_API}/utxo?txin=${txin}`,
      );
      if (!response.ok) {
        console.warn(`getUtxosByOutRef: failed for ${ref.txHash}#${ref.outputIndex}: ${response.status}`);
        continue;
      }
      const data: Record<string, any> = await response.json();
      for (const [outRefStr, output] of Object.entries(data)) {
        const [txHash, idx] = outRefStr.split("#");
        results.push(cliOutputToUtxo(txHash, Number(idx), output));
      }
    }
    return results;
  }

  // ── Datum / Delegation ────────────────────────────────────

  getDatum(_datumHash: string): Promise<string> {
    throw new Error("getDatum not supported on CardanoCliProvider");
  }

  getDelegation(_rewardAddress: string): Promise<ActiveDelegation> {
    throw new Error("getDelegation not supported on CardanoCliProvider");
  }

  // ── Transaction lifecycle ─────────────────────────────────

  /** Submit a signed transaction to L1 via cardano-submit-api. */
  async submit(tx: string): Promise<string> {
    const txBytes = fromHex(tx);
    const response = await fetch(CARDANO_SUBMIT_API, {
      method: "POST",
      headers: { "Content-Type": "application/cbor" },
      body: txBytes,
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`L1 submit failed: ${response.status} - ${error}`);
    }
    const result = await response.text();
    return result.trim().replace(/"/g, "");
  }

  /** Poll until a transaction output appears on L1. */
  async awaitTx(txHash: string, checkInterval = 3000): Promise<boolean> {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, checkInterval));
      try {
        const utxos = await this.getUtxosByOutRef([{ txHash, outputIndex: 0 }]);
        if (utxos.length > 0) return true;
      } catch { /* keep polling */ }
    }
    return true; // best-effort — assume settled after timeout
  }
}

// ============================================================
// cardano-cli JSON output → Lucid Utxo
// ============================================================

function cliOutputToUtxo(txHash: string, idx: number, output: any): Utxo {
  const assets: Assets = {};

  // output.value can be:
  //   { "lovelace": N }  (lovelace only)
  //   { "lovelace": N, "<policyId>": { "<assetName>": M } }  (multi-asset)
  for (const [policy, value] of Object.entries(output.value)) {
    if (policy === "lovelace") {
      assets["lovelace"] = BigInt(value as number);
    } else {
      for (const [assetName, amount] of Object.entries(value as any)) {
        assets[`${policy}${assetName}`] = BigInt(amount as number);
      }
    }
  }

  return {
    txHash,
    outputIndex: idx,
    assets,
    address: output.address,
    datum: output.inlineDatumRaw || undefined,
    datumHash: output.datumhash || undefined,
    scriptRef: output.referenceScript || undefined,
  };
}
