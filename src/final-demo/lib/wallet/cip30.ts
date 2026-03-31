"use client";

import type { DemoActor } from "./mock-wallets";
import type { EnabledWallet } from "@newm.io/cardano-dapp-wallet-connector";

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

function isLikelyTestnetAddress(address: string): boolean {
  return address.trim().startsWith("addr_test");
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

async function normalizeAddressForUi(address: string): Promise<string> {
  const trimmed = address.trim();
  if (trimmed.startsWith("addr")) return trimmed;
  if (!/^[0-9a-fA-F]+$/.test(trimmed)) return trimmed;
  try {
    const response = await fetch("/api/wallet/normalize-address", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: trimmed }),
    });
    if (!response.ok) return trimmed;
    const payload = await response.json() as { address?: string };
    return payload.address?.trim() || trimmed;
  } catch {
    return trimmed;
  }
  return trimmed;
}

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

function getCardanoProviders(): Record<string, Cip30Wallet> {
  if (typeof window === "undefined") return {};
  return ((window as unknown as { cardano?: Record<string, Cip30Wallet> }).cardano ?? {});
}

function getRealWalletOptions(): WalletOption[] {
  if (typeof window === "undefined") return [];
  const providers = getCardanoProviders();
  return Object.keys(providers)
    .filter((key) => key !== "cardano")
    .map((key) => ({
      key,
      name: providers[key]?.name || inferWalletName(key),
    }));
}

export function getWalletOptions(): WalletOption[] {
  return getRealWalletOptions();
}

export async function connectWallet(walletKey: string, actor: DemoActor): Promise<WalletSession> {
  const wallet = getCardanoProviders()[walletKey];
  if (!wallet) {
    throw new Error(`Wallet provider ${walletKey} not found`);
  }
  const api = await wallet.enable();
  const [networkId, usedAddressesRaw, changeAddressRaw] = await Promise.all([
    api.getNetworkId(),
    api.getUsedAddresses(),
    api.getChangeAddress(),
  ]);
  const usedAddresses = await Promise.all(usedAddressesRaw.map((a) => normalizeAddressForUi(a)));
  const changeAddress = await normalizeAddressForUi(changeAddressRaw);
  setEnabledWalletKey(walletKey);
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

export async function buildWalletSessionFromEnabledWallet(wallet: EnabledWallet, actor: DemoActor): Promise<WalletSession> {
  const [networkId, usedAddressesRaw, changeAddressRaw] = await Promise.all([
    wallet.getNetworkId(),
    wallet.getUsedAddresses(),
    wallet.getChangeAddress(),
  ]);
  const usedAddresses = await Promise.all(usedAddressesRaw.map((a) => normalizeAddressForUi(a)));
  const changeAddress = await normalizeAddressForUi(changeAddressRaw);
  setEnabledWalletKey(wallet.id);
  return {
    walletKey: wallet.id,
    walletName: wallet.name,
    actor,
    networkId,
    usedAddresses,
    changeAddress,
    supportsSignTx: typeof wallet.signTx === "function",
    supportsSubmitTx: typeof wallet.submitTx === "function",
  };
}

export function disconnectWallet() {
  clearEnabledWalletKey();
}

export async function restoreWalletSession(actor: DemoActor): Promise<WalletSession | null> {
  const walletKey = getEnabledWalletKey();
  if (!walletKey) return null;
  const wallet = getCardanoProviders()[walletKey];
  if (!wallet) return null;
  const enabled = await wallet.isEnabled();
  if (!enabled) return null;
  const api = await wallet.enable();
  const usedAddressesRaw = await api.getUsedAddresses();
  const changeAddressRaw = await api.getChangeAddress();
  const usedAddresses = await Promise.all(usedAddressesRaw.map((a) => normalizeAddressForUi(a)));
  const changeAddress = await normalizeAddressForUi(changeAddressRaw);
  return {
    walletKey,
    walletName: wallet.name,
    actor,
    networkId: await api.getNetworkId(),
    usedAddresses,
    changeAddress,
    supportsSignTx: typeof api.signTx === "function",
    supportsSubmitTx: typeof api.submitTx === "function",
  };
}

async function restoreAnyEnabledWalletSession(actor: DemoActor): Promise<WalletSession | null> {
  const providers = getCardanoProviders();
  for (const [walletKey, wallet] of Object.entries(providers)) {
    if (walletKey === "cardano" || !wallet) continue;
    try {
      const enabled = await wallet.isEnabled();
      if (!enabled) continue;
      const api = await wallet.enable();
      const usedAddressesRaw = await api.getUsedAddresses();
      const changeAddressRaw = await api.getChangeAddress();
      const usedAddresses = await Promise.all(usedAddressesRaw.map((a) => normalizeAddressForUi(a)));
      const changeAddress = await normalizeAddressForUi(changeAddressRaw);
      if (!isLikelyTestnetAddress(changeAddress)) {
        continue;
      }
      setEnabledWalletKey(walletKey);
      return {
        walletKey,
        walletName: wallet.name,
        actor,
        networkId: await api.getNetworkId(),
        usedAddresses,
        changeAddress,
        supportsSignTx: typeof api.signTx === "function",
        supportsSubmitTx: typeof api.submitTx === "function",
      };
    } catch {
      // Ignore providers that fail on probe and continue with the next one.
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function restoreWalletSessionWithFallback(
  actor: DemoActor,
  options?: { maxAttempts?: number; delayMs?: number },
): Promise<WalletSession | null> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 8);
  const delayMs = Math.max(100, options?.delayMs ?? 500);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const stored = await restoreWalletSession(actor);
    if (stored) return stored;
    const anyEnabled = await restoreAnyEnabledWalletSession(actor);
    if (anyEnabled) return anyEnabled;
    if (attempt < maxAttempts) {
      await sleep(delayMs);
    }
  }
  return null;
}

export async function signTxWithConnectedWallet(session: WalletSession, txCborHex: string, partialSign = true): Promise<string> {
  const wallet = getCardanoProviders()[session.walletKey];
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
  const wallet = getCardanoProviders()[session.walletKey];
  if (!wallet) {
    throw new Error(`Wallet provider ${session.walletKey} not found`);
  }
  const api = await wallet.enable();
  if (typeof api.submitTx !== "function") {
    throw new Error(`Wallet ${session.walletName} does not support submitTx`);
  }
  return api.submitTx(txCborHex);
}
