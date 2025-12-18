import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mark WASM-related packages as external for server-side
  // Turbopack doesn't support WASM, so we'll use webpack instead
  serverExternalPackages: [
    '@anastasia-labs/cardano-multiplatform-lib-nodejs',
    '@lucid-evolution/lucid',
    '@lucid-evolution/plutus',
    '@lucid-evolution/utils',
  ],
  // Configure webpack to handle WASM files and ensure module instances are shared
  webpack: (config, { isServer }) => {
    if (isServer) {
      // For server-side, mark WASM packages as external
      config.externals = config.externals || [];
      config.externals.push({
        '@anastasia-labs/cardano-multiplatform-lib-nodejs': 'commonjs @anastasia-labs/cardano-multiplatform-lib-nodejs',
      });
      
      // Ensure @lucid-evolution/plutus module instances are shared
      // This prevents Next.js from creating separate module instances
      config.resolve = {
        ...config.resolve,
        alias: {
          ...config.resolve?.alias,
          '@lucid-evolution/plutus': require.resolve('@lucid-evolution/plutus'),
        },
      };
    }
    return config;
  },
};

export default nextConfig;
