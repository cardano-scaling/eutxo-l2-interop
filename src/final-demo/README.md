# Final Demo (`src/final-demo`)

Production-leaning demo app for Hydra-based flows:
- `request_funds` on Head A
- `buy_ticket` across source head -> Head B lottery path
- role-based UI views (`/user`, `/charlie`, `/admin`)

---

## 1) Run the system

### Prerequisites
- Docker + Docker Compose
- Node.js 20+ and npm (for local app mode)

### Option A: full stack in Docker (recommended first run)

From `src/final-demo`:

```bash
cp .env.example .env
docker compose --profile full up
```

This starts:
- Postgres
- Prisma init/bootstrap
- Next.js app
- Worker
- Cardano node in local testet + submit API + Hydra scripts publisher
- Hydra nodes for Heads A/B/C participants

App URL: `http://localhost:3000`

### Option B: infra+worker in Docker, app locally (faster UI iteration)

Terminal 1:

```bash
cd src/final-demo
cp .env.example .env
docker compose --profile dev up
```

Terminal 2:

```bash
cd src/final-demo
npm install
npm run prisma:push
npm run prisma:generate
npm run dev
```

### Operational scripts

From `src/final-demo`:

```bash
# Open/commit heads and refresh L1 artifacts
npm run hydra:open-heads

# Create lottery on Head B (Jon flow)
npm run hydra:create-lottery-head-b
```

These are admin operations also available via the UI in the Admin view.

### Useful URLs
- User view: `http://localhost:3000/user`
- Charlie view: `http://localhost:3000/charlie`
- Admin view: `http://localhost:3000/admin`

---

## 2) System components (high-level)

### Runtime services
- `postgres`: workflow/state persistence.
- `init`: one-shot Prisma bootstrap (`npm install`, `prisma db push`, `prisma generate`).
- `app`: Next.js fullstack server (UI + API routes).
- `worker`: async workflow executor/reconciler.
- Cardano/Hydra services in `full` profile: local L1 testnet + Hydra nodes (Heads A/B/C topology).

### Application modules
- `app/`: pages and API routes.
- `components/`: UI, including role-aware screens and monitoring cards.
- `lib/services/`: core domain logic (`request_funds`, `buy_ticket`).
- `lib/workflows.ts` + `worker.ts`: workflow state machine, retries, defer/backoff, reconciliation.
- `lib/hydra/*`: Hydra operation adapters/providers/types.
- `lib/wallet/cip30.ts`: wallet session/signing bridge for CIP-30 interactions.
- `prisma/`: schema and generated client usage.
- `scripts/`: operational scripts (head lifecycle, lottery creation, helpers).

---

## 3) API surface (current routes)

- Health/readiness:
  - `GET /api/health`
  - `GET /api/ready`
- State/snapshots:
  - `GET /api/state/heads`
  - `GET /api/state/snapshots`
  - `POST /api/state/heads/mock-connect` (local/dev helper)
- Wallet utility:
  - `POST /api/wallet/normalize-address`
- Hydra operation routes:
  - `POST /api/hydra-ops/request-funds/prepare`
  - `POST /api/hydra-ops/request-funds/submit`
  - `POST /api/hydra-ops/htlc/prepare`
  - `POST /api/hydra-ops/htlc/submit`
- Workflow routes:
  - `POST /api/workflows/request-funds`
  - `POST /api/workflows/buy-ticket`
  - `GET /api/workflows/:id`
- Charlie route:
  - `POST /api/charlie/associate`
- Admin routes:
  - `GET /api/admin/workflows`
  - `POST /api/admin/workflows/:id/retry`
  - `POST /api/admin/reconcile`
  - `POST /api/admin/heads/open`
  - `POST /api/admin/lottery/create`
  - `POST /api/admin/lottery/reconcile`
- Lottery routes:
  - `GET /api/lottery/active`
  - `POST /api/lottery/active` (admin-guarded)

