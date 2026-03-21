type LucidNetwork = "Custom" | "Preprod" | "Preview" | "Mainnet";

function normalizeNetwork(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function lucidNetworkName(): LucidNetwork {
  const env = normalizeNetwork(process.env.CARDANO_NETWORK);
  if (env === "preprod") return "Preprod";
  if (env === "preview") return "Preview";
  if (env === "mainnet") return "Mainnet";
  return "Custom";
}

export function isCustomNetworkMode(): boolean {
  return lucidNetworkName() === "Custom";
}

export function cardanoNetworkMagic(): number {
  const configured = Number(process.env.CARDANO_NETWORK_MAGIC ?? "");
  if (Number.isFinite(configured) && configured >= 0) {
    return configured;
  }
  const network = lucidNetworkName();
  if (network === "Preprod") return 1;
  if (network === "Preview") return 2;
  return 42;
}

