import { LucidEvolution, Network } from "@lucid-evolution/lucid";

function getNetworkFromLucid(lucid: LucidEvolution): Network {
    const network = lucid.config().network;
    if (!network) {
      throw new Error('Lucid network configuration is not set.');
    }
    return network;
  }

export { getNetworkFromLucid }