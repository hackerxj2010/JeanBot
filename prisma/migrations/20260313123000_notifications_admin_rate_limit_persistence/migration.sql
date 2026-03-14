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
