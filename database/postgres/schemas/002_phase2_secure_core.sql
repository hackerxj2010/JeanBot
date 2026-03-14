create extension if not exists vector;

create table if not exists tenants (
  id text primary key,
  name text not null,
  slug text not null unique,
  created_at timestamptz not null
);

create table if not exists users (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  email text not null,
  display_name text not null,
  created_at timestamptz not null
);

create index if not exists users_tenant_id_idx on users (tenant_id);

create table if not exists workspaces (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  name text not null,
  slug text not null,
  created_at timestamptz not null
);

create index if not exists workspaces_tenant_id_idx on workspaces (tenant_id);

create table if not exists workspace_memberships (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null
);

create index if not exists workspace_memberships_tenant_user_idx
  on workspace_memberships (tenant_id, user_id);

create table if not exists api_keys (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  workspace_ids jsonb not null default '[]'::jsonb,
  label text not null,
  hashed_key text not null unique,
  preview text not null,
  active boolean not null default true,
  created_at timestamptz not null,
  last_used_at timestamptz null
);

create index if not exists api_keys_tenant_id_idx on api_keys (tenant_id);

create table if not exists roles (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  name text not null,
  permissions jsonb not null default '[]'::jsonb,
  system boolean not null default false,
  created_at timestamptz not null
);

create index if not exists roles_tenant_id_idx on roles (tenant_id);

create table if not exists auth_sessions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  workspace_ids jsonb not null default '[]'::jsonb,
  role_ids jsonb not null default '[]'::jsonb,
  permissions jsonb not null default '[]'::jsonb,
  subject_type text not null,
  access_token_hash text not null unique,
  refresh_token_hash text not null unique,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  created_at timestamptz not null,
  last_used_at timestamptz null,
  revoked_at timestamptz null
);

create index if not exists auth_sessions_tenant_user_idx on auth_sessions (tenant_id, user_id);

create table if not exists missions (
  id text primary key,
  tenant_id text null references tenants(id) on delete set null,
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  title text not null,
  objective text not null,
  context text not null,
  desired_outcome text null,
  constraints jsonb not null default '[]'::jsonb,
  required_capabilities jsonb not null default '[]'::jsonb,
  risk text not null,
  status text not null,
  plan_version integer not null default 0,
  replan_count integer not null default 0,
  raw_record jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists missions_tenant_workspace_idx on missions (tenant_id, workspace_id);
create index if not exists missions_status_idx on missions (status);

create table if not exists approvals (
  id text primary key,
  mission_id text not null references missions(id) on delete cascade,
  tenant_id text null references tenants(id) on delete set null,
  workspace_id text not null references workspaces(id) on delete cascade,
  status text not null,
  reason text not null,
  required_actions jsonb not null default '[]'::jsonb,
  approved_by text null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists approvals_mission_status_idx on approvals (mission_id, status);

create table if not exists mission_transitions (
  id text primary key,
  mission_id text not null references missions(id) on delete cascade,
  from_status text not null,
  to_status text not null,
  reason text not null,
  actor text not null,
  created_at timestamptz not null
);

create index if not exists mission_transitions_mission_created_idx
  on mission_transitions (mission_id, created_at);

create table if not exists audit_events (
  id text primary key,
  kind text not null,
  entity_id text not null,
  actor text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create index if not exists audit_events_entity_created_idx
  on audit_events (entity_id, created_at);

create table if not exists heartbeats (
  id text primary key,
  tenant_id text null references tenants(id) on delete set null,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  schedule text not null,
  objective text not null,
  active boolean not null default true,
  last_run_at timestamptz null,
  next_run_at timestamptz null,
  last_scheduled_at timestamptz null,
  scheduler_status text null,
  last_scheduler_error text null
);

create index if not exists heartbeats_workspace_active_idx on heartbeats (workspace_id, active);

create table if not exists heartbeat_executions (
  id text primary key,
  heartbeat_id text not null references heartbeats(id) on delete cascade,
  tenant_id text null references tenants(id) on delete set null,
  workspace_id text not null references workspaces(id) on delete cascade,
  status text not null,
  trigger_kind text not null,
  requested_by text null,
  summary text not null,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  started_at timestamptz null,
  finished_at timestamptz null,
  error text null
);

create index if not exists heartbeat_executions_heartbeat_created_idx
  on heartbeat_executions (heartbeat_id, created_at);

create index if not exists heartbeat_executions_workspace_created_idx
  on heartbeat_executions (workspace_id, created_at);

create table if not exists memory_records (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  scope text not null,
  text text not null,
  tags jsonb not null default '[]'::jsonb,
  importance double precision null,
  content_hash text not null,
  created_at timestamptz not null,
  embedding vector(1536) null,
  embedding_model text null,
  embedding_updated_at timestamptz null
);

create index if not exists memory_records_workspace_created_idx
  on memory_records (workspace_id, created_at);

create table if not exists knowledge_documents (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  title text not null,
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  content_hash text not null,
  excerpt text not null,
  created_at timestamptz not null,
  embedding vector(1536) null,
  embedding_model text null,
  embedding_updated_at timestamptz null
);

create index if not exists knowledge_documents_workspace_created_idx
  on knowledge_documents (workspace_id, created_at);

create table if not exists workspace_billing_subscriptions (
  workspace_id text primary key references workspaces(id) on delete cascade,
  tenant_id text null references tenants(id) on delete set null,
  plan_id text not null,
  stripe_customer_id text null,
  stripe_subscription_id text null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists workspace_billing_subscriptions_tenant_idx
  on workspace_billing_subscriptions (tenant_id);

create table if not exists workspace_quota_overrides (
  workspace_id text primary key references workspaces(id) on delete cascade,
  tenant_id text null references tenants(id) on delete set null,
  limits jsonb not null default '{}'::jsonb,
  reason text null,
  updated_by text null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists workspace_quota_overrides_tenant_idx
  on workspace_quota_overrides (tenant_id);

create table if not exists billing_usage_events (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  tenant_id text null references tenants(id) on delete set null,
  metric text not null,
  quantity double precision not null,
  source_service text not null,
  source_entity_id text not null,
  timestamp timestamptz not null,
  stripe_sync_status text not null,
  stripe_error text null,
  billable boolean not null default true,
  metered_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists billing_usage_events_workspace_timestamp_idx
  on billing_usage_events (workspace_id, timestamp);

create table if not exists connected_integrations (
  id text primary key,
  tenant_id text null references tenants(id) on delete set null,
  workspace_id text not null references workspaces(id) on delete cascade,
  provider text not null,
  status text not null,
  scopes jsonb not null default '[]'::jsonb,
  provider_account_id text null,
  encrypted_access_token text null,
  encrypted_refresh_token text null,
  access_token_expires_at timestamptz null,
  last_error text null,
  metadata jsonb not null default '{}'::jsonb,
  connected_at timestamptz not null,
  updated_at timestamptz not null,
  unique (workspace_id, provider)
);

create index if not exists connected_integrations_tenant_workspace_idx
  on connected_integrations (tenant_id, workspace_id);

create table if not exists notifications (
  id text primary key,
  tenant_id text null references tenants(id) on delete set null,
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  channel text not null,
  event_type text not null,
  target text not null,
  subject text not null,
  body text not null,
  status text not null,
  mode text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  sent_at timestamptz null,
  error text null
);

create index if not exists notifications_workspace_created_idx
  on notifications (workspace_id, created_at);

create index if not exists notifications_user_created_idx
  on notifications (user_id, created_at);
