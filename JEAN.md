# JeanBot Project Memory

## Built

- Secure API gateway with REST and tRPC
- Tenant/workspace bootstrap and scoped API key flow
- Mission orchestration with planning, approvals, execution, recovery, transitions, audits, and artifacts
- Python mission executor package with local and live HTTP adapters, execution service, interactive shell, and unit coverage
- Local JSON persistence plus Postgres repository adapters
- Redis/BullMQ queue support plus queue worker
- Anthropic/OpenAI/GitHub provider runtime with synthetic fallback
- Browser service and terminal service with live-or-fallback modes
- Prisma schema for the secure microservice core

## In progress

- Replacing raw `pg` adapters with Prisma-backed repositories
- Deepening automation scheduling and trigger behavior
- Expanding service apps beyond the current core path
- Hardening long-lived browser and terminal sessions

## Environment variables

- `POSTGRES_URL`
- `REDIS_URL`
- `INTERNAL_SERVICE_TOKEN`
- `JEANBOT_AUTH_REQUIRED`
- `JEANBOT_SERVICE_MODE`
- `JEANBOT_PERSISTENCE_MODE`
- `JEANBOT_QUEUE_MODE`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GITHUB_TOKEN`
- `PLAYWRIGHT_LIVE`

## Folder structure focus

- `services/*`: backend services and internal APIs
- `packages/*`: shared contracts, queue, db, logger, telemetry, and helpers
- `src/cognitive/*`: Python mission execution package, adapters, and CLI
- `workers/*`: distributed processing entrypoints
- `database/postgres/schemas`: local Postgres bootstrap
- `prisma/schema.prisma`: canonical relational model

## Known issues

- Prisma is present but not yet the primary repository implementation everywhere
- Compose covers the current secure core path, not every future service in the target tree
- UI apps remain blank by explicit scope choice

## Next step

Extend the Python mission runner to shared queue/state stores for distributed recovery parity, and deepen the interactive shell with multi-turn mission steering and artifact visualization.
