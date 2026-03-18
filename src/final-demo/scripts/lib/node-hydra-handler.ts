import { WebSocket as NodeWebSocket } from "ws";

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

export type Utxo = {
  txHash: string;
  outputIndex: number;
  address: string;
  assets: { lovelace: bigint };
};

export type HydraUtxo = {
  address: string;
  datum: string | null;
  inlineDatum: unknown;
  inlineDatumhash: string | null;
  referenceScript: unknown | null;
  value: Record<string, number | Record<string, number>>;
};

export class HydraHandler {
  private connection: any;
  private isReady = false;
  private greetingsPromise: Promise<GreetingsMessage>;
  private resolveGreetings!: (msg: GreetingsMessage) => void;
  private headStatus: HeadStatus = "Idle";

  constructor(url: string) {
    const wsURL = new URL(url);
    wsURL.protocol = wsURL.protocol.replace("http", "ws");
    this.greetingsPromise = new Promise((resolve) => {
      this.resolveGreetings = resolve;
    });
    this.connection = new NodeWebSocket(`${wsURL.toString()}?history=no`);
    this.connection.on("open", () => {
      this.isReady = true;
    });
    this.connection.on("close", () => {
      this.isReady = false;
    });
    this.connection.on("message", (raw: unknown) => {
      const data = JSON.parse(String(raw));
      this.updateStatus(data);
      if (data.tag === "Greetings") {
        this.resolveGreetings(data as GreetingsMessage);
      }
    });
  }

  private updateStatus(data: { tag?: string; headStatus?: HeadStatus }): void {
    switch (data.tag) {
      case "Greetings":
        this.headStatus = data.headStatus ?? "Idle";
        break;
      case "HeadIsInitializing":
        this.headStatus = "Initial";
        break;
      case "HeadIsOpen":
        this.headStatus = "Open";
        break;
      case "HeadIsClosed":
        this.headStatus = "Closed";
        break;
      case "ReadyToFanout":
        this.headStatus = "FanoutPossible";
        break;
      case "HeadIsFinalized":
        this.headStatus = "Final";
        break;
    }
  }

  private async ensureReady(): Promise<void> {
    if (this.isReady) return;
    if (this.connection.readyState === NodeWebSocket.CLOSED || this.connection.readyState === NodeWebSocket.CLOSING) {
      throw new Error("WebSocket is not open");
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("WebSocket connect timeout")), 10_000);
      this.connection.once("open", () => {
        clearTimeout(timeout);
        this.isReady = true;
        resolve();
      });
      this.connection.once("error", (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  async getHeadStatus(): Promise<HeadStatus> {
    await this.ensureReady();
    await this.greetingsPromise;
    return this.headStatus;
  }

  async listen(tag: string, timeout = 60_000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const tid = setTimeout(() => reject(new Error(`Timeout waiting for ${tag}`)), timeout);
      const handler = (raw: unknown) => {
        const data = JSON.parse(String(raw)) as { tag?: string };
        this.updateStatus(data as { tag?: string; headStatus?: HeadStatus });
        if (data.tag === tag) {
          clearTimeout(tid);
          this.connection.off("message", handler);
          resolve(data);
        } else if (data.tag && ERROR_TAGS.includes(data.tag)) {
          clearTimeout(tid);
          this.connection.off("message", handler);
          reject(new Error(`Error: ${data.tag} - ${JSON.stringify(data)}`));
        }
      };
      this.connection.on("message", handler);
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

  stop(): void {
    this.connection.close();
  }
}

export function lucidUtxoToHydraUtxo(utxo: Utxo): HydraUtxo {
  return {
    address: utxo.address,
    value: { lovelace: Number(utxo.assets.lovelace) },
    datum: null,
    inlineDatum: null,
    inlineDatumhash: null,
    referenceScript: null,
  };
}

