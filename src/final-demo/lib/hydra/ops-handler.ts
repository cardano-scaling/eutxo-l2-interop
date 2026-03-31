import {
  CML,
  fromUnit,
  type Assets,
  type CBORHex,
  type UTxO,
} from "@lucid-evolution/lucid";
import { WebSocket as NodeWebSocket } from "ws";

export class HydraOpsHandler {
  private readonly wsUrl: URL;
  private readonly httpOrigin: string;
  private readonly txAwaitTimeoutMs: number;

  constructor(baseUrl: string) {
    const http = new URL(baseUrl);
    this.httpOrigin = http.origin;
    const ws = new URL(baseUrl);
    ws.protocol = ws.protocol.replace("http", "ws");
    this.wsUrl = ws;
    const parsed = Number(process.env.HYDRA_OPERATION_TIMEOUT_MS ?? 60_000);
    this.txAwaitTimeoutMs = Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
  }

  async sendTx(txCborHex: CBORHex): Promise<"TxValid"> {
    const ws = new NodeWebSocket(`${this.wsUrl.toString()}?history=no`);
    return new Promise<"TxValid">((resolve, reject) => {
      const timeout = setTimeout(() => {
        try {
          ws.close();
        } catch {
          // noop
        }
        reject(new Error(`Timed out waiting for Hydra TxValid after ${this.txAwaitTimeoutMs}ms`));
      }, this.txAwaitTimeoutMs);

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            tag: "NewTx",
            transaction: { cborHex: txCborHex, description: "", type: "Tx BabbageEra" },
          }),
        );
      };

      ws.onmessage = (event: { data: unknown }) => {
        const data = JSON.parse(String(event.data)) as Record<string, unknown> & { tag?: string };
        if (data.tag === "TxValid") {
          clearTimeout(timeout);
          ws.close();
          resolve("TxValid");
          return;
        }
        if (data.tag && /Invalid|Failed/i.test(data.tag)) {
          clearTimeout(timeout);
          ws.close();
          let details = "";
          try {
            details = JSON.stringify(data);
          } catch {
            details = String(data);
          }
          reject(new Error(`Hydra rejected transaction: ${data.tag} ${details}`));
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Hydra websocket error"));
      };
    });
  }

  async getSnapshot(): Promise<UTxO[]> {
    const response = await fetch(`${this.httpOrigin}/snapshot/utxo`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Hydra snapshot request failed with ${response.status}`);
    }
    const payload = await response.json() as Record<string, any>;
    return Object.entries(payload).map(([ref, output]) => hydraUtxoToLucidUtxo(ref, output));
  }
}

function hydraUtxoToLucidUtxo(ref: string, output: any): UTxO {
  const [txHash, outputIndex] = ref.split("#");
  const assets: Assets = {};
  for (const [policy, value] of Object.entries(output.value as Record<string, any>)) {
    if (policy === "lovelace") {
      assets[policy] = BigInt(value as number);
    } else {
      for (const [assetName, amount] of Object.entries(value as Record<string, number>)) {
        const unit = `${policy}${assetName}`;
        assets[unit] = BigInt(amount);
      }
    }
  }
  const datum = output.inlineDatumRaw ? String(output.inlineDatumRaw) : undefined;
  return {
    txHash,
    outputIndex: Number(outputIndex),
    assets,
    address: String(output.address),
    datum,
  };
}

export function txHashFromCbor(txCborHex: string): string {
  const cmlTx = CML.Transaction.from_cbor_hex(txCborHex);
  return CML.hash_transaction(cmlTx.body()).to_hex();
}
