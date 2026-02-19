# Demo — eUTXO L2 Dispute Mechanism

Interactive demo for the ad-hoc ledger dispute resolution flow running on real
Hydra heads and a private Cardano devnet.

## Components

| Component | Path | Description |
|---|---|---|
| **Infrastructure** | `../infra/` | Docker Compose running a Cardano local testnet, Cardano submit API, Hydra scripts publisher, and 4 Hydra nodes (2 heads × 2 participants) |
| **Deno backend** | `server.ts` | HTTP + WebSocket server. Holds all state in-memory (credentials, Hydra connections, phase). Exposes REST endpoints for each action and pushes real-time events over WebSocket |
| **State singleton** | `state.ts` | Manages credentials, Hydra WS connections, Lucid instances, L1 queries, and phase tracking. Survives page reloads (state lives server-side) |
| **Route handlers** | `routes.ts` | One handler per action. Guards against concurrent actions with a busy lock (auto-expires after 60 s) |
| **React frontend** | `ui/` | Vite + React + shadcn/ui. Live topology diagram, head/L1 panels, action buttons, and a real-time event log |

## Prerequisites

- Docker & Docker Compose
- [Deno](https://deno.land/) ≥ 2.x
- Node.js ≥ 18 (for the Vite frontend)

## Running

### 1. Start the infrastructure

```bash
# starting from the src/onchain/tests/demo directory...
cd ../infra
docker compose up -d
```

This boots a private Cardano devnet with pre-funded wallets (Alice, Bob, Ida)
and 4 Hydra nodes arranged as two heads:

- **Head A**: Alice + Ida
- **Head B**: Bob + Ida

The Cardano node entrypoint writes `infra/l1-utxos.json` with the initial L1
UTxOs for each participant and then creates the sentinel file
`infra/l1-utxos.ready` after all the hydra-related setup is complete. The backend and CLI scripts will refuse to run until
this sentinel exists.

> **Tear down** (wipes all state):
> ```bash
> docker compose down -v && sudo rm -rf persistence
> ```
> The sentinel file is automatically removed on the next `docker compose up`.

### 2. Start the Deno backend

```bash
# starting from the src/onchain/tests/demo directory...
deno run --allow-net --allow-read --allow-write --watch server.ts
```

The `--watch` flag enables hot reload on file changes.
The server listens on **http://localhost:3001** and waits for the
`l1-utxos.ready` sentinel before allowing any action.

### 3. Start the frontend

```bash
cd src/onchain/tests/demo/ui
npm install   # first time only
npm run dev   # http://localhost:5173
```

The Vite dev server proxies `/api` and `/ws` to the Deno backend on port 3001.

## Flows

The UI supports two paths through the dispute mechanism:

### Happy path (no dispute)

```
Connect → Commit → Wrap → Unwrap → Close Heads
```

Funds are wrapped into the validator and then reclaimed by the owner in-head.
No L1 resolution needed.

### Dispute path (L1 resolution)

```
Connect → Commit → Wrap → Dispute → Close Heads → Merge on L1
```

After dispute, both heads are closed and fanned out. The disputed UTXOs land on
L1 as script outputs. **Merge on L1** spends them back to their rightful owners
using the `Merge` redeemer.

### Action details

| Step | What it does |
|---|---|
| **Connect** | Loads credentials from `infra/credentials/`, opens WebSocket connections to both Hydra nodes, and auto-detects the current phase by inspecting head status and L1 state |
| **Commit** | Initializes both heads (`Init`) and commits L1 funds from each participant. Each participant must have ≥ 2 UTXOs on L1 (one as Hydra fuel, one to commit) |
| **Wrap** | Alice locks 5 ADA in Head A, Ida locks 5 ADA in Head B, paying to the ad-hoc ledger wrapped script |
| **Unwrap** | Owner reclaims their wrapped UTXO in-head (happy path) |
| **Dispute** | Marks wrapped UTXOs as `disputed = true` in both heads |
| **Close Heads** | Sends `Close` → waits for `HeadIsClosed` → contestation → `Fanout` → `HeadIsFinalized` for both heads. Polls L1 until both disputed script UTXOs are settled |
| **Merge on L1** | Spends the two disputed script UTXOs on L1 back to Alice and Ida using the `Merge` redeemer. Available whenever script UTXOs exist on L1, regardless of phase |
| **Cancel** | Force-releases the busy lock if an action hangs. Disconnects from heads and resets to idle |

### Re-running the flow

After a successful **Merge on L1**, the backend automatically reconnects to the
heads and transitions to the **Commit** phase, so the flow can be re-run
without needing a fresh `docker compose up`.

## API reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/status` | Full state snapshot (heads, L1, participants, phase, busy) |
| `GET` | `/api/events` | Event history |
| `POST` | `/api/connect` | Load credentials + connect to heads |
| `POST` | `/api/commit` | Init + commit L1 funds |
| `POST` | `/api/wrap` | Wrap 5 ADA in both heads |
| `POST` | `/api/unwrap` | Unwrap (happy path) |
| `POST` | `/api/dispute` | Dispute in both heads |
| `POST` | `/api/close` | Close & fanout + wait for L1 settlement |
| `POST` | `/api/merge` | Merge disputed UTXOs on L1 |
| `POST` | `/api/cancel` | Force-release busy lock |
| `GET` | `/ws` | WebSocket — real-time events |
