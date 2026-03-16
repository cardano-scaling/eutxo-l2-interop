import {
  type Assets,
  type Utxo,
} from "https://deno.land/x/lucid@0.20.14/mod.ts";

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
}

export type HydraUtxo = {
  address: string;
  datum: string | null;
  inlineDatum: unknown;
  inlineDatumhash: string | null;
  referenceScript: unknown | null;
  value: Record<string, number | Record<string, number>>;
};

export class HydraHandler {
  private connection: WebSocket;
  private isReady = false;
  private greetingsPromise: Promise<GreetingsMessage>;
  private resolveGreetings!: (msg: GreetingsMessage) => void;
  private _headStatus: HeadStatus = "Idle";

  constructor(url: string) {
    const wsURL = new URL(url);
    wsURL.protocol = wsURL.protocol.replace("http", "ws");
    this.greetingsPromise = new Promise((resolve) => {
      this.resolveGreetings = resolve;
    });
    this.connection = new WebSocket(`${wsURL.toString()}?history=no`);
    this.connection.onopen = () => {
      this.isReady = true;
    };
    this.connection.onclose = () => {
      this.isReady = false;
    };
    this.connection.onmessage = (msg: MessageEvent) => {
      const data = JSON.parse(msg.data);
      this.updateStatus(data);
      if (data.tag === "Greetings") {
        this.resolveGreetings(data as GreetingsMessage);
      }
    };
  }

  private updateStatus(data: any): void {
    switch (data.tag) {
      case "Greetings": this._headStatus = data.headStatus; break;
      case "HeadIsInitializing": this._headStatus = "Initial"; break;
      case "HeadIsOpen": this._headStatus = "Open"; break;
      case "HeadIsClosed": this._headStatus = "Closed"; break;
      case "ReadyToFanout": this._headStatus = "FanoutPossible"; break;
      case "HeadIsFinalized": this._headStatus = "Final"; break;
    }
  }

  private async ensureReady(): Promise<void> {
    if (this.isReady) return;
    if (this.connection.readyState === WebSocket.CLOSED ||
      this.connection.readyState === WebSocket.CLOSING) {
      throw new Error("WebSocket is not open");
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("WebSocket connect timeout")), 10_000);
      const prevOnOpen = this.connection.onopen;
      this.connection.onopen = (ev) => {
        clearTimeout(timeout);
        this.isReady = true;
        if (prevOnOpen) (prevOnOpen as (ev: Event) => void)(ev);
        resolve();
      };
    });
  }

  async getHeadStatus(): Promise<HeadStatus> {
    await this.ensureReady();
    await this.greetingsPromise;
    return this._headStatus;
  }

  async listen(tag: string, timeout = 60_000): Promise<any> {
    return new Promise((resolve, reject) => {
      const tid = setTimeout(() => reject(new Error(`Timeout waiting for ${tag}`)), timeout);
      this.connection.onmessage = (msg: MessageEvent) => {
        const data = JSON.parse(msg.data);
        this.updateStatus(data);
        if (data.tag === tag) {
          clearTimeout(tid);
          resolve(data);
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
      const initPromise = this.listen("HeadIsInitializing");
      this.connection.send(JSON.stringify({ tag: "Init" }));
      await initPromise;
      return "Initial";
    }
    return status;
  }

  stop() {
    this.connection.close();
  }
}

export function lucidUtxoToHydraUtxo(utxo: Utxo): HydraUtxo {
  const value: Record<string, number | Record<string, number>> = {};
  for (const [unit, amount] of Object.entries(utxo.assets)) {
    if (unit === "lovelace") {
      value.lovelace = Number(amount);
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

export function hydraUtxoToLucidUtxo(hash: string, idx: number, output: any): Utxo {
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
