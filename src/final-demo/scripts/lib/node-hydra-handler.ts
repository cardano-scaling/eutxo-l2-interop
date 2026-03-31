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
  private lastError: unknown = null;
  private subscribers: Array<(data: any) => void> = [];

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
    // Prevent unhandled websocket errors (e.g. DNS ENOTFOUND when a service is stopped).
    this.connection.on("error", (error: unknown) => {
      this.lastError = error;
      this.isReady = false;
    });
    this.connection.on("message", (raw: unknown) => {
      const data = JSON.parse(String(raw));
      this.updateStatus(data);
      if (data.tag === "Greetings") {
        this.resolveGreetings(data as GreetingsMessage);
      }
      for (const sub of this.subscribers) {
        try {
          sub(data);
        } catch {
          // subscriber errors must not crash the handler
        }
      }
    });
  }

  private updateStatus(data: { tag?: string; headStatus?: HeadStatus }): void {
    switch (data.tag) {
      case "Greetings":
        // Hydra nodes sometimes report "Initializing" via Greetings (string), while other events use HeadIsInitializing.
        // Normalize to our internal "Initial" spelling to keep status-based logic consistent.
        this.headStatus = (data.headStatus === ("Initializing" as any) ? "Initial" : data.headStatus) ?? "Idle";
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
    if (this.lastError) {
      throw this.lastError instanceof Error ? this.lastError : new Error(String(this.lastError));
    }
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
        this.lastError = error;
        reject(error);
      });
    });
  }

  async getHeadStatus(): Promise<HeadStatus> {
    await this.ensureReady();
    // Greetings may never arrive when the node is down/unresolvable; bound it to avoid hanging.
    await Promise.race([
      this.greetingsPromise,
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error("Timeout waiting for Greetings")), 5_000)),
    ]);
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

  /**
   * Subscribe to all incoming websocket messages for this connection.
   * Returns an unsubscribe function.
   */
  subscribe(handler: (data: any) => void): () => void {
    this.subscribers.push(handler);
    return () => {
      const idx = this.subscribers.indexOf(handler);
      if (idx >= 0) this.subscribers.splice(idx, 1);
    };
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

