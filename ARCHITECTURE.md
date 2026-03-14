# JeanBot Architecture

## Service roles

- `api-gateway`: public REST + tRPC entrypoint, auth, permissions, telemetry, and request correlation
- `auth-service`: scoped API key creation and verification plus RBAC projection
- `user-service`: tenant, user, workspace, and membership bootstrap
- `agent-orchestrator`: mission state machine, planning, approval gates, execution queueing, recovery, and artifacts
- `agent-runtime`: runtime frame construction, prompt loading, provider execution, and self-checking
- `memory-service`: session and long-term memory persistence and summarization
- `tool-service`: normalized broker for filesystem, terminal, browser, search, communication, memory, knowledge, audit, and policy tools
- `policy-service`: mission/tool risk analysis and approval requirements
- `audit-service`: immutable operational event recording
- `automation-service`: heartbeat persistence and triggering
- `browser-service`: Playwright-backed or synthetic browser sessions and captures
- `terminal-service`: guarded terminal execution and optional `node-pty` sessions
- `queue-worker`: Redis/BullMQ-backed processing for mission planning and execution

## Communication model

- Public clients call `api-gateway`
- Internal services talk over signed HTTP headers when `JEANBOT_SERVICE_MODE=http`
- Local mode bypasses network calls for smoke tests and fast development
- Redis/BullMQ is used for asynchronous planning and execution jobs

## Request data flow

1. A workspace is bootstrapped and receives a scoped API key.
2. The API gateway validates the key and derives workspace-aware auth context.
3. The mission is created and persisted.
4. The orchestrator evaluates risk, plans the mission, and creates approvals when needed.
5. The orchestrator enqueues work locally or in Redis/BullMQ.
6. The worker or local queue path executes the mission.
7. Runtime frames are built from `JEAN.md`, workspace files, memory summaries, tools, and policy posture.
8. Tools execute with workspace-scope checks.
9. Audit events, artifacts, transitions, and memory updates are persisted.

## Memory model

- Session memory: active run context
- Short-term memory: recent summaries and transient facts
- Long-term memory: durable mission outcomes and high-value facts
- Schema readiness:
  - `memory_records` and `knowledge_documents` are ready for `pgvector`
  - Prisma models the durable relational + vector future state

## Tool permission levels

- Level 0: safe reads and summaries
- Level 1: local non-destructive actions
- Level 2: approval-sensitive execution such as terminal commands or checkpointed writes
- Level 3: future destructive or production-impacting actions
