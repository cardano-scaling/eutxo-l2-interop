# Demo UI

Interactive UI for the eUTXO L2 dispute mechanism demo.

## Quick start

```bash
# 1. Start the Deno backend (from tests/demo/)
cd src/onchain/tests/demo
deno run --allow-net --allow-read --allow-write server.ts

# 2. Start the frontend (from tests/demo/ui/)
cd ui
npm install   # first time only
npm run dev   # opens on http://localhost:5173
```

The Vite dev server proxies `/api` and `/ws` to the Deno backend on port 3000.
