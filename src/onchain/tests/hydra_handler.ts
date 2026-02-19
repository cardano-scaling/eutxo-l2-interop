/**
 * HydraHandler — Deno WebSocket client for Hydra head nodes.
 *
 * Extracted from commit.ts so it can be shared by the commit flow,
 * HydraNodeProvider (Lucid Provider), and future test scripts.
 */

import {
  type Assets,
  type Utxo,
} from "https://deno.land/x/lucid@0.20.14/mod.ts";

// ============================================================
// Constants & Types
// ============================================================

export const ERROR_TAGS = [
  "PeerHandshakeFailure",
  "TxInvalid",
  "InvalidInput",
  "CommandFailed",
  "DecommitInvalid",
];

export type HeadStatus =
  | "Idle"
  | "Initial"
  | "Open"
  | "Closed"
  | "FanoutPossible"
  | "Final";

export interface GreetingsMessage {
  tag: "Greetings";
  headStatus: HeadStatus;
  hydraNodeVersion: string;
  me: { vkey: string };
  snapshotUtxo: Record<string, any> | null;
  timestamp: string;
}

export type HydraUtxo = {
  address: string;
  datum: string | null;
  inlineDatum: any;
  inlineDatumhash: string | null;
  referenceScript: any | null;
  value: Record<string, number | Record<string, number>>;
};

// ============================================================
// HydraHandler
// ============================================================

export class HydraHandler {
  private connection: WebSocket;
  private url: URL;
  private isReady = false;
  private greetingsPromise: Promise<GreetingsMessage>;
  private resolveGreetings!: (msg: GreetingsMessage) => void;

  constructor(url: string) {
    const wsURL = new URL(url);
    wsURL.protocol = wsURL.protocol.replace("http", "ws");
    this.url = wsURL;
    this.greetingsPromise = new Promise((resolve) => {
      this.resolveGreetings = resolve;
    });
    this.connection = new WebSocket(wsURL + "?history=no");
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.connection.onopen = () => {
      this.isReady = true;
    };
    this.connection.onerror = () => console.error("  Error on Hydra websocket");
    this.connection.onclose = () => {
      this.isReady = false;
    };
    this.connection.onmessage = (msg: MessageEvent) => {
      const data = JSON.parse(msg.data);
      if (data.tag === "Greetings") {
        this.resolveGreetings(data as GreetingsMessage);
        console.log(`  [WS] Greetings - status: ${data.headStatus}`);
      }
    };
  }

  private async ensureReady(): Promise<void> {
    if (!this.isReady) {
      await new Promise<void>((resolve) => {
        const orig = this.connection.onopen;
        this.connection.onopen = (ev) => {
          this.isReady = true;
          if (orig) (orig as (ev: Event) => void)(ev);
          resolve();
        };
      });
    }
  }

  async getHeadStatus(): Promise<HeadStatus> {
    await this.ensureReady();
    return (await this.greetingsPromise).headStatus;
  }

  async listen(tag: string, timeout = 60000): Promise<any> {
    return new Promise((resolve, reject) => {
      const tid = setTimeout(
        () => reject(new Error(`Timeout waiting for ${tag}`)),
        timeout,
      );
      this.connection.onmessage = (msg: MessageEvent) => {
        const data = JSON.parse(msg.data);
        console.log(`  [WS] Received: ${data.tag}`);
        if (data.tag === tag) {
          clearTimeout(tid);
          resolve(data);
        } else if (data.tag === "PostTxOnChainFailed") {
          // Hydra node retries automatically — log and keep waiting
          console.log(
            `  [WS] ⚠ PostTxOnChainFailed (node will retry): ${data.postTxError?.tag || "unknown"}`,
          );
        } else if (ERROR_TAGS.includes(data.tag)) {
          clearTimeout(tid);
          reject(new Error(`Error: ${data.tag} - ${JSON.stringify(data)}`));
        }
      };
    });
  }

  async initIfNeeded(): Promise<HeadStatus> {
    const status = await this.getHeadStatus();
    if (status === "Idle") {
      console.log("  Head is Idle, sending Init...");
      this.connection.send(JSON.stringify({ tag: "Init" }));
      await this.listen("HeadIsInitializing");
      return "Initial";
    }
    console.log(`  Head is already ${status}`);
    return status;
  }

  async getSnapshot(): Promise<Utxo[]> {
    const apiURL = `${this.url.origin.replace("ws", "http")}/snapshot/utxo`;
    const response = await fetch(apiURL);
    const data = await response.json();
    return Object.entries(data).map(([outRef, output]: [string, any]) => {
      const [hash, idx] = outRef.split("#");
      return hydraUtxoToLucidUtxo(hash, Number(idx), output);
    });
  }

  /**
   * Send a transaction into the Hydra head via WebSocket.
   * Waits for TxValid and returns the transaction ID.
   */
  async sendTx(txCborHex: string, timeout = 30000): Promise<string> {
    await this.ensureReady();
    this.connection.send(
      JSON.stringify({
        tag: "NewTx",
        transaction: {
          cborHex: txCborHex,
          description: "",
          type: "Tx BabbageEra",
        },
      }),
    );
    return new Promise((resolve, reject) => {
      const tid = setTimeout(
        () => reject(new Error("Timeout waiting for TxValid")),
        timeout,
      );
      this.connection.onmessage = (msg: MessageEvent) => {
        const data = JSON.parse(msg.data);
        console.log(`  [WS] Received: ${data.tag}`);
        if (data.tag === "TxValid") {
          clearTimeout(tid);
          resolve(data.transactionId || "unknown");
        } else if (data.tag === "TxInvalid") {
          clearTimeout(tid);
          reject(
            new Error(
              `Transaction invalid: ${JSON.stringify(data.validationError || data)}`,
            ),
          );
        } else if (ERROR_TAGS.includes(data.tag)) {
          clearTimeout(tid);
          reject(new Error(`Error: ${data.tag} - ${JSON.stringify(data)}`));
        }
        // Ignore other messages (SnapshotConfirmed, etc.)
      };
    });
  }

  /**
   * Close the Hydra head, wait for contestation period, then fanout.
   * Full lifecycle: Close → HeadIsClosed → ReadyToFanout → Fanout → HeadIsFinalized
   *
   * Uses a single onmessage listener to avoid race conditions when the
   * contestation period is short.
   */
  async closeAndFanout(timeout = 120000): Promise<void> {
    await this.ensureReady();

    return new Promise((resolve, reject) => {
      const tid = setTimeout(
        () => reject(new Error("Timeout waiting for head close/fanout lifecycle")),
        timeout,
      );

      let phase: "closing" | "closed" | "fanning_out" = "closing";

      this.connection.onmessage = (msg: MessageEvent) => {
        const data = JSON.parse(msg.data);
        console.log(`  [WS] Received: ${data.tag}`);

        if (data.tag === "HeadIsClosed" && phase === "closing") {
          phase = "closed";
          console.log("  Head is closed, waiting for contestation deadline...");
        } else if (data.tag === "ReadyToFanout" && phase === "closed") {
          phase = "fanning_out";
          console.log("  Ready to fanout, sending Fanout...");
          this.connection.send(JSON.stringify({ tag: "Fanout" }));
        } else if (data.tag === "HeadIsFinalized" && phase === "fanning_out") {
          clearTimeout(tid);
          console.log("  Head is finalized — UTXOs released to L1");
          resolve();
        } else if (data.tag === "PostTxOnChainFailed") {
          console.log(
            `  [WS] ⚠ PostTxOnChainFailed (node will retry): ${data.postTxError?.tag || "unknown"}`,
          );
        } else if (ERROR_TAGS.includes(data.tag)) {
          clearTimeout(tid);
          reject(new Error(`Error during close/fanout: ${data.tag} - ${JSON.stringify(data)}`));
        }
      };

      // Kick off the lifecycle
      console.log("  Sending Close...");
      this.connection.send(JSON.stringify({ tag: "Close" }));
    });
  }

  stop() {
    this.connection.close();
  }
}

// ============================================================
// UTxO Conversion
// ============================================================

export function lucidUtxoToHydraUtxo(utxo: Utxo): HydraUtxo {
  const value: Record<string, number | Record<string, number>> = {};
  for (const [unit, amount] of Object.entries(utxo.assets)) {
    if (unit === "lovelace") {
      value["lovelace"] = Number(amount);
    } else {
      const pid = unit.slice(0, 56);
      const an = unit.slice(56);
      const cur = (value[pid] as Record<string, number>) || {};
      cur[an] = Number(amount);
      value[pid] = cur;
    }
  }
  return {
    address: utxo.address,
    value,
    datum: null,
    inlineDatum: utxo.datum || null,
    inlineDatumhash: utxo.datumHash || null,
    referenceScript: utxo.scriptRef || null,
  };
}

export function hydraUtxoToLucidUtxo(
  hash: string,
  idx: number,
  output: any,
): Utxo {
  const assets: Assets = {};
  for (const [policy, value] of Object.entries(output.value)) {
    if (policy === "lovelace") {
      assets[policy] = BigInt(value as number);
    } else {
      for (const [an, amount] of Object.entries(value as any)) {
        assets[`${policy}${an}`] = BigInt(amount as number);
      }
    }
  }
  return {
    txHash: hash,
    outputIndex: idx,
    assets,
    address: output.address,
    datum: output.inlineDatumRaw || undefined,
  };
}
