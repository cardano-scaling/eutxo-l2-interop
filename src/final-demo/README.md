# Final Demo (`src/final-demo`)

Hydra 3-head demo app scaffold with a single Next.js fullstack app:
- `app/`: UI and API route handlers
- `lib/`: workflow/head/prisma domain logic
- `worker.ts`: background processor
- `prisma/`: Postgres schema
- `docker-compose.yml`: minimal local runtime

## Run local stack

1. Copy env file:

```bash
cd src/final-demo
cp .env.example .env
```

2. Start **full profile** (DB + init + worker + Next.js in Docker):

```bash
cd src/final-demo
docker compose --profile full up
```

3. Start **dev profile** (DB + init + worker, no Next.js container):

```bash
cd src/final-demo
docker compose --profile dev up
```

Startup order in Compose:
- `init` runs once to bootstrap Prisma (`npm install`, `prisma db push`, `prisma generate`).
- `worker` starts after `init` in `dev`.
- In `full`, Next.js cache (`.next`) is stored in a Docker volume, not on the host workspace.

4. Run Next.js app locally (recommended with `dev` profile):

```bash
cd src/final-demo
npm install
cp .env.example .env
npm run prisma:push
npm run prisma:generate
npm run dev
```

App runs on `http://localhost:3000` (UI + API).

## Current endpoints

- `GET /api/health`
- `GET /api/ready`
- `GET /api/state/heads`
- `POST /api/state/heads/mock-connect`
- `POST /api/workflows/request-funds`
- `POST /api/workflows/buy-ticket`
- `POST /api/workflows/charlie-interact`
- `GET /api/workflows/:id`
- `POST /api/admin/workflows/:id/retry`
- `POST /api/admin/reconcile`

## Notes

- Ticket buy is mocked for now (placeholder destination supported).
- Workflow state is persisted in Postgres.
- Worker processes queued workflows with retry metadata.
