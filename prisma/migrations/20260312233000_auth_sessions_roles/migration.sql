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
