import type { NextConfig } from "next";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Match src/client WASM strategy for Lucid/CML on server routes.
  serverExternalPackages: [
    "@anastasia-labs/cardano-multiplatform-lib-nodejs",
    "@lucid-evolution/lucid",
    "@lucid-evolution/plutus",
    "@lucid-evolution/utils",
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        "@anastasia-labs/cardano-multiplatform-lib-nodejs":
          "commonjs @anastasia-labs/cardano-multiplatform-lib-nodejs",
      });

      config.resolve = {
        ...config.resolve,
        alias: {
          ...config.resolve?.alias,
          "@lucid-evolution/plutus": require.resolve("@lucid-evolution/plutus"),
        },
      };
    }
    return config;
  },
};

export default nextConfig;
