import type { Utxo } from "../node-hydra-handler";

export type Participant = {
  name: "alice" | "bob" | "ida" | "jon" | "charlie";
  api: string;
  skPath: string;
};

export type { Utxo };

export type Operation =
  | "open_head_a"
  | "open_head_b"
  | "open_heads_ab"
  | "commit_head_c_charlie"
  | "commit_head_c_admin";

export type L1ChainUtxo = {
  address?: string;
  value?: Record<string, number>;
  inlineDatum?: unknown;
  referenceScript?: unknown;
};

export type L1AddressUtxoMap = Record<string, L1ChainUtxo>;

export type L1UtxoSnapshot = Record<string, L1AddressUtxoMap>;
