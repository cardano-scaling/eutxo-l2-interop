# eUTXO L2 Interop — On-chain Tests

End-to-end tests for the ad-hoc ledger validators running on Hydra heads and Cardano L1.

Two execution modes are available for every flow:

| Mode | What it does |
|---|---|
| **emulator** (default) | Uses in-memory `HydraEmulator` — no infra needed |
| **nodes** (`--mode=nodes`) | Runs against real Hydra heads on a private Cardano devnet |

## Infrastructure (nodes mode only)

```bash
cd src/onchain/tests/infra

# Start the private testnet + 4 Hydra nodes (2 heads × 2 participants)
docker compose up

# Tear down (wipes all state)
docker compose down -v
```

Services: `cardano-node`, `cardano-submit-api`, `hydra-scripts-publisher`,
`hydra-node-alice`, `hydra-node-ida-1`, `hydra-node-bob`, `hydra-node-ida-2`.

## Flows

All scripts are run from `src/onchain/tests/`.

### 1. Commit (nodes mode only) — Open both Hydra heads with funded UTXOs

```bash
deno run --allow-net --allow-read commit.ts
```

Connects to all 4 Hydra nodes, initializes two heads (A: Alice+Ida, B: Ida+Bob),
and performs non-empty commits from L1 UTXOs.

### 2. Wrap — Lock funds into the wrapped validator inside heads

```bash
# Emulator
deno run --allow-net --allow-read wrap.ts

# Real nodes (heads must be open)
deno run --allow-net --allow-read wrap.ts --mode=nodes
```

Alice locks 5 ADA in Head A, Ida locks 5 ADA in Head B.

### 3. Dispute — Wrap + dispute in a single run

```bash
deno run --allow-net --allow-read dispute.ts
deno run --allow-net --allow-read dispute.ts --mode=nodes
```

Runs wrap first, then each owner disputes their wrapped UTXO, setting
`disputed = true` in the datum.

### 4. Merge — Full flow: wrap → dispute → close heads → merge on L1

```bash
deno run --allow-net --allow-read merge.ts
deno run --allow-net --allow-read merge.ts --mode=nodes
```

Runs the entire flow end-to-end: wrap → dispute → close & fanout both heads →
wait for L1 settlement → merge both disputed UTXOs back to their owners on L1
using the `Merge` redeemer.

In **emulator** mode: combines both head ledgers and spends disputed UTXOs
via the `Merge` redeemer.

### Refresh L1 UTxOs

```bash
./infra/refresh-l1-utxos.sh
```

After a full commit → merge cycle the L1 UTXOs have changed (heads consumed
fuel, merge produced new outputs). Run this script to update
`infra/l1-utxos.json` so the next `commit.ts` run picks up the correct
inputs **without restarting the infrastructure**.

## Demo UI

Interactive web UI for reproducing the dispute mechanism step-by-step against
real Hydra nodes. It supports both the happy path (wrap → unwrap only) and the
dispute path (wrap → dispute → close heads → merge on L1).

### Architecture

| Component | Description |
|---|---|
| **Deno backend** (`demo/server.ts`) | HTTP + WebSocket server that holds in-memory state, talks to Hydra nodes and L1, and exposes a REST API for each action |
| **State singleton** (`demo/state.ts`) | Manages credentials, Hydra connections, phase tracking, and L1 queries. Survives page reloads (state lives server-side) |
| **Route handlers** (`demo/routes.ts`) | One handler per action (connect, commit, wrap, unwrap, dispute, close, merge). Guards against concurrent actions |
| **React frontend** (`demo/ui/`) | Vite + React + shadcn/ui. Live topology diagram, head/L1 panels, action buttons, and a real-time event log via WebSocket |

### Running the demo

```bash
# 1. Infrastructure must be running (see above)
cd src/onchain/tests/infra
docker compose up

# 2. Start the Deno backend
cd src/onchain/tests/demo
deno run --allow-net --allow-read --allow-write server.ts

# 3. Start the frontend dev server
cd src/onchain/tests/demo/ui
npm install   # first time only
npm run dev   # http://localhost:5173
```

### UI flow

1. **Connect** — loads credentials, connects to Hydra nodes
2. **Commit** — initializes both heads and commits L1 funds
3. **Wrap** — locks 5 ADA in each head via the ad-hoc ledger validator
4. **Unwrap** *(happy path)* — owner reclaims funds in-head
5. **Dispute** *(dispute path)* — marks wrapped UTXOs as disputed
6. **Close Heads** — closes & fanouts both heads to L1
7. **Merge on L1** — spends disputed script UTXOs back to their owners

Merge is also available any time there are script UTXOs on L1, regardless of
the current phase.

## File overview

| File | Purpose |
|---|---|
| `plutus.ts` | Generated Plutus type bindings (validators, datums, redeemers) |
| `hydra_emulator.ts` | In-memory Hydra emulator (Lucid `Provider`) |
| `hydra_handler.ts` | WebSocket client for real Hydra nodes |
| `hydra_node_provider.ts` | Lucid `Provider` backed by `HydraHandler` |
| `cardano_provider.ts` | Lucid `Provider` for Cardano L1 (via HTTP query API) |
| `commit.ts` | Opens and commits UTXOs to both Hydra heads |
| `wrap.ts` | Wraps funds into the ad-hoc ledger validator |
| `dispute.ts` | Wrap + dispute wrapped UTXOs |
| `merge.ts` | Full flow: wrap → dispute → close heads → merge on L1 |
| `verify.ts` | Verifies wrapped UTXOs |
| `unwrap.ts` | Unwraps UTXOs (single-head) |
| `infra/` | Docker Compose, credentials, and devnet configuration |
| `infra/refresh-l1-utxos.sh` | Refreshes `l1-utxos.json` from current L1 state |
