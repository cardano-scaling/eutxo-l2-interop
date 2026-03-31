export type DemoActor = "ida" | "user" | "charlie";

export type MockWalletConfig = {
  key: string;
  name: string;
  actor: DemoActor;
  networkId: number;
  usedAddresses: string[];
  changeAddress: string;
};

// Keep these values in one shared module so client wallet mocks and server policy checks stay aligned.
export const MOCK_WALLETS: MockWalletConfig[] = [
  {
    key: "finalDemoUserWallet",
    name: "Final Demo User Wallet",
    actor: "user",
    networkId: 0,
    usedAddresses: ["61aa00112233445566778899aabbccddeeff00112233445566778899"],
    changeAddress: "61aa00112233445566778899aabbccddeeff00112233445566778899",
  },
  {
    key: "finalDemoIdaWallet",
    name: "Final Demo IDA Wallet",
    actor: "ida",
    networkId: 0,
    usedAddresses: ["61bb00112233445566778899aabbccddeeff00112233445566778899"],
    changeAddress: "61bb00112233445566778899aabbccddeeff00112233445566778899",
  },
  {
    key: "finalDemoCharlieWallet",
    name: "Final Demo Charlie Wallet",
    actor: "charlie",
    networkId: 0,
    usedAddresses: ["61cc00112233445566778899aabbccddeeff00112233445566778899"],
    changeAddress: "61cc00112233445566778899aabbccddeeff00112233445566778899",
  },
];
