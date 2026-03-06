"use client";

import { MOCK_WALLETS, type DemoActor } from "./mock-wallets";

type Cip30Extension = { cip: number };

type Cip30Api = {
  getNetworkId(): Promise<number>;
  getUsedAddresses(): Promise<string[]>;
  getChangeAddress(): Promise<string>;
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

type MockWalletConfig = {
  key: string;
  name: string;
  actor: DemoActor;
  networkId: number;
  usedAddresses: string[];
  changeAddress: string;
};

export type WalletOption = {
  key: string;
  name: string;
  actor: DemoActor;
};

export type WalletSession = {
  walletKey: string;
  walletName: string;
  actor: DemoActor;
  networkId: number;
  usedAddresses: string[];
  changeAddress: string;
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

function walletConfigByKey(key: string): MockWalletConfig | undefined {
  return MOCK_WALLETS.find((wallet) => wallet.key === key);
}

function makeWalletProvider(config: MockWalletConfig): Cip30Wallet {
  return {
    name: config.name,
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Crect width='64' height='64' rx='12' fill='%232563eb'/%3E%3Ctext x='32' y='40' font-size='24' text-anchor='middle' fill='white'%3Ew%3C/text%3E%3C/svg%3E",
    apiVersion: "1",
    supportedExtensions: [{ cip: 30 }],
    async isEnabled() {
      return getEnabledWalletKey() === config.key;
    },
    async enable() {
      setEnabledWalletKey(config.key);
      return {
        getNetworkId: async () => config.networkId,
        getUsedAddresses: async () => config.usedAddresses,
        getChangeAddress: async () => config.changeAddress,
        getExtensions: async () => [{ cip: 30 }],
      };
    },
  };
}

export function ensureMockCip30WalletsInjected() {
  if (typeof window === "undefined") return;
  window.cardano = window.cardano ?? {};
  for (const wallet of MOCK_WALLETS) {
    if (!window.cardano[wallet.key]) {
      window.cardano[wallet.key] = makeWalletProvider(wallet);
    }
  }
}

export function getWalletOptions(): WalletOption[] {
  return MOCK_WALLETS.map((wallet) => ({
    key: wallet.key,
    name: wallet.name,
    actor: wallet.actor,
  }));
}

export async function connectWallet(walletKey: string): Promise<WalletSession> {
  ensureMockCip30WalletsInjected();
  const wallet = window.cardano?.[walletKey];
  const config = walletConfigByKey(walletKey);
  if (!wallet || !config) {
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
    actor: config.actor,
    networkId,
    usedAddresses,
    changeAddress,
  };
}

export function disconnectWallet() {
  clearEnabledWalletKey();
}

export async function restoreWalletSession(): Promise<WalletSession | null> {
  ensureMockCip30WalletsInjected();
  const walletKey = getEnabledWalletKey();
  if (!walletKey) return null;
  const wallet = window.cardano?.[walletKey];
  const config = walletConfigByKey(walletKey);
  if (!wallet || !config) return null;
  const enabled = await wallet.isEnabled();
  if (!enabled) return null;
  const api = await wallet.enable();
  return {
    walletKey,
    walletName: wallet.name,
    actor: config.actor,
    networkId: await api.getNetworkId(),
    usedAddresses: await api.getUsedAddresses(),
    changeAddress: await api.getChangeAddress(),
  };
}
