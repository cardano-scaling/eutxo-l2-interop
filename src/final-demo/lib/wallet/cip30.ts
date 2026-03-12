"use client";

import { Wallet } from "@cardano-foundation/cardano-connect-with-wallet-core";
import type { DemoActor } from "./mock-wallets";

type Cip30Extension = { cip: number };

type Cip30Api = {
  getNetworkId(): Promise<number>;
  getUsedAddresses(): Promise<string[]>;
  getChangeAddress(): Promise<string>;
  signTx?(txCborHex: string, partialSign?: boolean): Promise<string>;
  submitTx?(txCborHex: string): Promise<string>;
  getExtensions?(): Promise<Cip30Extension[]>;
};

type Cip30Wallet = {
  name: string;
  icon: string;
  apiVersion: string;
  supportedExtensions: Cip30Extension[];
  isEnabled(): Promise<boolean>;
  enable(): Promise<Cip30Api>;
};

declare global {
  interface Window {
    cardano?: Record<string, Cip30Wallet>;
  }
}

const ENABLED_WALLET_STORAGE_KEY = "final-demo.cip30.enabled-wallet.v1";
const DUMMY_SIGNER_PLACEHOLDER_PKH = "00000000000000000000000000000000000000000000000000000000";
const DUMMY_REQUIRED_SIGNER_PREFIX = "0ed9010281581c";
const DUMMY_REQUIRED_SIGNER_FRAGMENT = `${DUMMY_REQUIRED_SIGNER_PREFIX}${DUMMY_SIGNER_PLACEHOLDER_PKH}`;
const DUMMY_TX_REQUIRED_SIGNER_TEMPLATE_CBOR_HEX =
  "84a400d9010281825820000000000000000000000000000000000000000000000000000000000000000000018182581d6029390bd65da533dc5d03f5e1bf6fd8114c41d3cefdab7aae10e4d9ef1a000f424002000ed9010281581c00000000000000000000000000000000000000000000000000000000a0f5f6";

export type WalletOption = {
  key: string;
  name: string;
};

export type WalletSession = {
  walletKey: string;
  walletName: string;
  actor: DemoActor;
  networkId: number;
  usedAddresses: string[];
  changeAddress: string;
  supportsSignTx: boolean;
  supportsSubmitTx: boolean;
};

function setEnabledWalletKey(walletKey: string) {
  window.localStorage.setItem(ENABLED_WALLET_STORAGE_KEY, walletKey);
}

function clearEnabledWalletKey() {
  window.localStorage.removeItem(ENABLED_WALLET_STORAGE_KEY);
}

function getEnabledWalletKey(): string | null {
  return window.localStorage.getItem(ENABLED_WALLET_STORAGE_KEY);
}

function inferWalletName(walletKey: string): string {
  return walletKey.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getRealWalletOptions(): WalletOption[] {
  if (typeof window === "undefined") return [];
  const installed = new Set<string>();
  try {
    for (const name of Wallet.getInstalledWalletExtensions()) {
      installed.add(name);
    }
  } catch {
    // Fallback to direct window.cardano scan.
  }
  for (const key of Object.keys(window.cardano ?? {})) {
    installed.add(key);
  }
  return [...installed]
    .filter((key) => key !== "cardano")
    .map((key) => ({
      key,
      name: window.cardano?.[key]?.name || inferWalletName(key),
    }));
}

export function getWalletOptions(): WalletOption[] {
  return getRealWalletOptions();
}

export async function connectWallet(walletKey: string, actor: DemoActor): Promise<WalletSession> {
  const wallet = window.cardano?.[walletKey];
  if (!wallet) {
    throw new Error(`Wallet provider ${walletKey} not found`);
  }
  const api = await wallet.enable();
  const [networkId, usedAddresses, changeAddress] = await Promise.all([
    api.getNetworkId(),
    api.getUsedAddresses(),
    api.getChangeAddress(),
  ]);
  return {
    walletKey: walletKey,
    walletName: wallet.name,
    actor,
    networkId,
    usedAddresses,
    changeAddress,
    supportsSignTx: typeof api.signTx === "function",
    supportsSubmitTx: typeof api.submitTx === "function",
  };
}

export function disconnectWallet() {
  clearEnabledWalletKey();
}

export async function restoreWalletSession(actor: DemoActor): Promise<WalletSession | null> {
  const walletKey = getEnabledWalletKey();
  if (!walletKey) return null;
  const wallet = window.cardano?.[walletKey];
  if (!wallet) return null;
  const enabled = await wallet.isEnabled();
  if (!enabled) return null;
  const api = await wallet.enable();
  return {
    walletKey,
    walletName: wallet.name,
    actor,
    networkId: await api.getNetworkId(),
    usedAddresses: await api.getUsedAddresses(),
    changeAddress: await api.getChangeAddress(),
    supportsSignTx: typeof api.signTx === "function",
    supportsSubmitTx: typeof api.submitTx === "function",
  };
}

export async function signTxWithConnectedWallet(session: WalletSession, txCborHex: string, partialSign = true): Promise<string> {
  const wallet = window.cardano?.[session.walletKey];
  if (!wallet) {
    throw new Error(`Wallet provider ${session.walletKey} not found`);
  }
  const api = await wallet.enable();
  if (typeof api.signTx !== "function") {
    throw new Error(`Wallet ${session.walletName} does not support signTx`);
  }
  return api.signTx(txCborHex, partialSign);
}

function extractPaymentKeyHash(addressHex: string): string {
  const normalized = addressHex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(normalized)) {
    throw new Error("Wallet address is not valid hex");
  }
  // Shelley address bytes: first byte header, next 28 bytes payment credential hash.
  if (normalized.length < 58) {
    throw new Error("Wallet address is too short to extract payment key hash");
  }
  return normalized.slice(2, 58);
}

function buildRequiredSignerDummyTxCborHex(session: WalletSession): string {
  const addressHex = session.usedAddresses[0] ?? session.changeAddress;
  const paymentKeyHash = extractPaymentKeyHash(addressHex);
  const replaced = DUMMY_TX_REQUIRED_SIGNER_TEMPLATE_CBOR_HEX.replace(
    DUMMY_REQUIRED_SIGNER_FRAGMENT,
    `${DUMMY_REQUIRED_SIGNER_PREFIX}${paymentKeyHash}`,
  );
  if (replaced === DUMMY_TX_REQUIRED_SIGNER_TEMPLATE_CBOR_HEX) {
    throw new Error("Failed to inject required signer hash into dummy transaction");
  }
  return replaced;
}

export async function signDummyTxWithConnectedWallet(session: WalletSession): Promise<{ txCborHex: string; witnessHex: string }> {
  const txCborHex = buildRequiredSignerDummyTxCborHex(session);
  const witnessHex = await signTxWithConnectedWallet(session, txCborHex, true);
  return {
    txCborHex,
    witnessHex,
  };
}

export async function submitTxWithConnectedWallet(session: WalletSession, txCborHex: string): Promise<string> {
  const wallet = window.cardano?.[session.walletKey];
  if (!wallet) {
    throw new Error(`Wallet provider ${session.walletKey} not found`);
  }
  const api = await wallet.enable();
  if (typeof api.submitTx !== "function") {
    throw new Error(`Wallet ${session.walletName} does not support submitTx`);
  }
  return api.submitTx(txCborHex);
}
