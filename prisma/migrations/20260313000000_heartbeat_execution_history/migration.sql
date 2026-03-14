create table "heartbeat_executions" (
  "id" text not null,
  "heartbeat_id" text not null,
  "tenant_id" text null,
  "workspace_id" text not null,
  "status" text not null,
  "trigger_kind" text not null,
  "requested_by" text null,
  "summary" text not null,
  "result" jsonb not null default '{}'::jsonb,
  "created_at" timestamptz not null,
  "started_at" timestamptz null,
  "finished_at" timestamptz null,
  "error" text null,
  constraint "heartbeat_executions_pkey" primary key ("id"),
  constraint "heartbeat_executions_heartbeat_id_fkey"
    foreign key ("heartbeat_id") references "heartbeats" ("id") on delete cascade on update cascade
);

create index "heartbeat_executions_heartbeat_id_created_at_idx"
  on "heartbeat_executions" ("heartbeat_id", "created_at");

create index "heartbeat_executions_workspace_id_created_at_idx"
  on "heartbeat_executions" ("workspace_id", "created_at");
