# JeanBot - Project Context

## Project Overview

JeanBot is a **backend-first autonomous agent platform** designed for secure, long-running missions with tool use, workspace memory, and full auditability. The project intentionally keeps UI folders blank while focusing on hardening the core backend infrastructure.

### Core Capabilities

- **Mission Orchestration**: Planning, approval gates, execution, recovery, transitions, and artifact management
- **Service Architecture**: 20+ microservices including API gateway, auth, user management, agent orchestrator, runtime, memory, tools, policy, audit, automation, browser, terminal, communication, knowledge, and billing
- **Provider Support**: Anthropic, OpenAI, GitHub, Playwright, and Ollama with live-or-synthetic fallback behavior
- **Infrastructure**: PostgreSQL (+pgvector) + Redis with local JSON fallback for offline development
- **Queue System**: Redis/BullMQ-backed workers for asynchronous planning and execution
- **Python Execution Surface**: Mission executor package with local adapters, execution service, and CLI

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Runtime** | Node.js 22+, Python 3.12+ |
| **Package Manager** | pnpm 10.29.3 (monorepo) |
| **Build System** | Turbo Repo |
| **Language** | TypeScript 5.6+, Python |
| **Web Framework** | Fastify (REST), tRPC |
| **Database** | PostgreSQL 17 (pgvector), Prisma ORM |
| **Cache/Queue** | Redis 7, BullMQ, ioredis |
| **AI Providers** | Anthropic, OpenAI, Ollama |
| **Browser Automation** | Playwright |
| **Testing** | Vitest, pytest |
| **Linting/Formatting** | Biome |
| **Containerization** | Docker Compose |

## Monorepo Structure

```
JeanBot/
├── apps/              # Frontend applications (blank by design)
├── services/          # Backend microservices (20 services)
│   ├── api-gateway/   # Main entry point (REST + tRPC)
│   ├── auth-service/
│   ├── user-service/
│   ├── agent-orchestrator/
│   ├── agent-runtime/
│   ├── browser-service/
│   ├── terminal-service/
│   └── ...
├── packages/          # Shared libraries (17 packages)
│   ├── ai/            # AI provider abstractions
│   ├── db/            # Database utilities
│   ├── logger/        # Structured logging
│   ├── queue/         # Queue abstractions
│   ├── schemas/       # Zod schemas
│   └── ...
├── workers/           # Queue workers (queue-worker, heartbeat-worker)
├── src/cognitive/     # Python mission execution package
├── prisma/            # Prisma schema (canonical data model)
├── database/          # Local Postgres bootstrap scripts
├── scripts/           # Development and smoke test scripts
├── tests/             # Test suites
├── workspace/         # Runtime workspace storage
└── configs/           # Shared configuration
```

## Building and Running

### Local Development

```bash
# Install dependencies
pnpm install

# Generate Prisma client
pnpm db:generate

# Type check
pnpm typecheck

# Run tests
pnpm test

# Run smoke tests
pnpm smoke

# Start single-process backend (dev mode)
pnpm dev

# Full multi-service stack via Docker
docker compose up --build
```

### Key Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start API gateway in development mode |
| `pnpm build` | Build all packages (Turbo) |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm lint` | Biome linting + typecheck |
| `pnpm format` | Biome formatting |
| `pnpm test` | Run Vitest tests |
| `pnpm db:generate` | Generate Prisma client |
| `pnpm db:migrate` | Push Prisma schema to database |
| `pnpm db:seed` | Seed database |
| `pnpm smoke` | Run smoke tests |
| `pnpm live:ollama` | Bootstrap and probe Ollama live |

### Python Mission Runner

```bash
# Write a sample mission template
python -m src.cognitive.cli write-template --output tmp/python-mission-template.json

# Execute the mission
python -m src.cognitive.cli execute --mission-file tmp/python-mission-template.json --workspace-root tmp/python-workspace

# Finalize a distributed payload
python -m src.cognitive.cli finalize-distributed --mission-file tmp/python-mission-template.json --workspace-root tmp/python-workspace
```

### Testing with Live Providers

```bash
# Set API key
export ANTHROPIC_API_KEY=your_key_here
# or
export OPENAI_API_KEY=your_key_here
# or for Ollama
export JEANBOT_MODEL_PROVIDER=ollama
export OLLAMA_BASE_URL=http://localhost:11434
export OLLAMA_MODEL=glm-5:cloud

# Start JeanBot
pnpm dev

# Bootstrap a tenant/workspace/API key
curl -X POST http://localhost:3000/api/bootstrap \
  -H "content-type: application/json" \
  -d '{"tenantName":"Test Tenant","tenantSlug":"test-tenant","email":"test@example.com","displayName":"Test User","workspaceName":"Test Workspace","workspaceSlug":"test-workspace","apiKeyLabel":"local-test"}'

# Run a runtime execution
curl -X POST http://localhost:3000/api/runtime/execute \
  -H "content-type: application/json" \
  -H "x-api-key: jean_xxx" \
  -d '{"workspaceId":"workspace_id_here","title":"Live probe","objective":"Inspect workspace","capability":"filesystem","provider":"anthropic","mode":"live"}'
```

## Environment Variables

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Environment name | `development` |
| `PORT` | HTTP port | `8080` |
| `JEANBOT_DEFAULT_WORKSPACE` | User workspace path | `./workspace/users/{userId}` |
| `JEANBOT_DEFAULT_TENANT` | Tenant workspace path | `./workspace/tenants/{workspaceId}` |
| `JEANBOT_AUTH_REQUIRED` | Require authentication | `true`/`false` |
| `JEANBOT_SERVICE_MODE` | Service communication mode | `local`/`http` |
| `JEANBOT_PERSISTENCE_MODE` | Storage backend | `local`/`postgres` |
| `JEANBOT_QUEUE_MODE` | Queue backend | `local`/`redis` |
| `INTERNAL_SERVICE_TOKEN` | Internal service secret | Generated token |
| `LOG_LEVEL` | Log verbosity | `info` |

### Optional (Providers)

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `GITHUB_TOKEN` | GitHub personal access token |
| `PLAYWRIGHT_LIVE` | Enable Playwright live mode |
| `OLLAMA_BASE_URL` | Ollama API base URL |
| `OLLAMA_MODEL` | Default Ollama model |
| `OLLAMA_API_KEY` | Ollama cloud API key |

### Optional (Infrastructure)

| Variable | Description |
|----------|-------------|
| `POSTGRES_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `SENTRY_DSN` | Sentry DSN for error tracking |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry endpoint |

### Optional (Integrations)

| Variable | Description |
|----------|-------------|
| `RESEND_API_KEY` | Resend email API key |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth |
| `JEANBOT_INTEGRATION_ENCRYPTION_KEY` | Encryption key for OAuth tokens |

## Architecture

### Service Roles

- **api-gateway**: Public REST + tRPC entrypoint, auth, permissions, telemetry
- **auth-service**: Scoped API key creation/verification, RBAC
- **user-service**: Tenant, user, workspace, membership bootstrap
- **agent-orchestrator**: Mission state machine, planning, approvals, execution queueing
- **agent-runtime**: Runtime frame construction, prompt loading, provider execution
- **memory-service**: Session and long-term memory persistence
- **tool-service**: Normalized broker for filesystem, terminal, browser, search, etc.
- **policy-service**: Mission/tool risk analysis and approval requirements
- **audit-service**: Immutable operational event recording
- **automation-service**: Heartbeat persistence and triggering
- **browser-service**: Playwright-backed or synthetic browser sessions
- **terminal-service**: Guarded terminal execution
- **queue-worker**: Redis/BullMQ-backed processing for missions

### Request Flow

1. Workspace bootstrapped → receives scoped API key
2. API gateway validates key → derives workspace-aware auth context
3. Mission created and persisted
4. Orchestrator evaluates risk, plans mission, creates approvals
5. Work enqueued (local or Redis/BullMQ)
6. Worker executes mission
7. Runtime frames built from JEAN.md, workspace files, memory, tools, policy
8. Tools execute with workspace-scope checks
9. Audit events, artifacts, transitions, memory updates persisted

### Memory Model

- **Session memory**: Active run context
- **Short-term memory**: Recent summaries and transient facts
- **Long-term memory**: Durable mission outcomes and high-value facts
- **Schema**: `memory_records` and `knowledge_documents` ready for pgvector

### Tool Permission Levels

| Level | Description |
|-------|-------------|
| 0 | Safe reads and summaries |
| 1 | Local non-destructive actions |
| 2 | Approval-sensitive (terminal commands, checkpointed writes) |
| 3 | Future destructive or production-impacting actions |

## Development Conventions

### Code Style

- **Formatter**: Biome (2-space indent, 100 char line width, double quotes)
- **Linter**: Biome with recommended rules + `noUnusedVariables`
- **TypeScript**: Strict mode, ES modules

### Testing Practices

- **TypeScript**: Vitest framework (`vitest.config.ts`)
- **Python**: pytest (`tests/python/`)
- **Test files**: `*.test.ts` or `tests/**/*.ts`
- **Coverage**: Stored in `coverage/**`

### Git Conventions

- Standard Git flow
- `.gitignore` excludes: `node_modules`, `dist`, `tmp`, workspace runtime data

### Project Memory

- **JEAN.md**: Project memory (Built, In progress, Known issues, Next steps)
- **ARCHITECTURE.md**: Service roles, communication model, data flow
- **ROADMAP.md**: 12-phase development plan (current: Phase 2 in progress)

## Key Files

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | Canonical relational + vector data model |
| `docker-compose.yml` | Multi-service stack definition |
| `package.json` | Root package config and scripts |
| `pnpm-workspace.yaml` | Monorepo package discovery |
| `turbo.json` | Turbo Repo task configuration |
| `tsconfig.base.json` | Base TypeScript configuration |
| `biome.json` | Linting and formatting rules |
| `.env.example` | Environment variable reference |
| `pyproject.toml` | Python project configuration |

## Known Issues

- Prisma is present but not yet the primary repository implementation everywhere
- Docker Compose covers the secure core path, not every future service
- UI apps remain blank by explicit scope choice

## Current Development Phase

**Phase 2 — Secure microservice core** (in progress, target: March 20, 2026)

Next planned phases:
- Phase 3: Runtime and provider hardening
- Phase 4: Prisma-backed repositories
- Phase 5: Queue workers and automation execution
