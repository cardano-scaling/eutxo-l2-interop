import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mark WASM-related packages as external for server-side
  // Turbopack doesn't support WASM, so we'll use webpack instead
  serverExternalPackages: [
    '@anastasia-labs/cardano-multiplatform-lib-nodejs',
    '@lucid-evolution/lucid',
  ],
  // Configure webpack to handle WASM files
  webpack: (config, { isServer }) => {
    if (isServer) {
      // For server-side, mark WASM packages as external
      config.externals = config.externals || [];
      config.externals.push({
        '@anastasia-labs/cardano-multiplatform-lib-nodejs': 'commonjs @anastasia-labs/cardano-multiplatform-lib-nodejs',
      });
    }
    return config;
  },
};

export default nextConfig;
