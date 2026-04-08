import crypto from "node:crypto";
import path from "node:path";

import { cosineSimilarity } from "@jeanbot/ai";
import { PrismaClient } from "@prisma/client";
import { LocalJsonStore, ensureDirectory } from "@jeanbot/documents";
import { loadPlatformConfig } from "@jeanbot/platform";
import type {
  ApiKeyRecord,
  AuthSessionRecord,
  ApprovalRecord,
  AuditEvent,
  ConnectedIntegrationRecord,
  HeartbeatDefinition,
  HeartbeatExecutionRecord,
  KnowledgeDocumentRecord,
  MemoryRecord,
  MissionRecord,
  MissionStateTransition,
  NotificationRecord,
  RepositoryMode,
  RoleRecord,
  SemanticSearchResult,
  StripeSyncStatus,
  TenantRecord,
  UsageEventRecord,
  UserRecord,
  WorkspaceBillingSubscriptionRecord,
  WorkspaceQuotaOverrideRecord,
  WorkspaceMembership,
  WorkspaceRecord
} from "@jeanbot/types";
import { Pool } from "pg";

const toIsoString = (value: Date | string | null | undefined) =>
  value ? new Date(value).toISOString() : undefined;

const asStringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
};

export interface IdentityRepository {
  createTenant(input: Omit<TenantRecord, "id" | "createdAt">): Promise<TenantRecord>;
  listTenants(): Promise<TenantRecord[]>;
  createUser(input: Omit<UserRecord, "id" | "createdAt">): Promise<UserRecord>;
  getUserById(userId: string): Promise<UserRecord | undefined>;
  listUsersByTenant(tenantId: string): Promise<UserRecord[]>;
  createWorkspace(input: Omit<WorkspaceRecord, "id" | "createdAt">): Promise<WorkspaceRecord>;
  listWorkspacesByTenant(tenantId: string): Promise<WorkspaceRecord[]>;
  addMembership(
    input: Omit<WorkspaceMembership, "id" | "createdAt">
  ): Promise<WorkspaceMembership>;
  createApiKey(input: Omit<ApiKeyRecord, "id" | "createdAt">): Promise<ApiKeyRecord>;
  listApiKeys(tenantId: string): Promise<ApiKeyRecord[]>;
  findApiKeyByHash(hash: string): Promise<ApiKeyRecord | undefined>;
  getTenantBySlug(slug: string): Promise<TenantRecord | undefined>;
  getUserByEmail(tenantId: string, email: string): Promise<UserRecord | undefined>;
  getWorkspaceBySlug(tenantId: string, slug: string): Promise<WorkspaceRecord | undefined>;
  listWorkspacesForUser(tenantId: string, userId: string): Promise<WorkspaceRecord[]>;
  listMembershipsForWorkspace(workspaceId: string): Promise<WorkspaceMembership[]>;
  listMembershipsForUser(tenantId: string, userId: string): Promise<WorkspaceMembership[]>;
  updateMembershipRoles(
    membershipId: string,
    roleIds: string[]
  ): Promise<WorkspaceMembership | undefined>;
  createRole(input: Omit<RoleRecord, "id">): Promise<RoleRecord>;
  listRoles(tenantId: string): Promise<RoleRecord[]>;
  createSession(input: Omit<AuthSessionRecord, "id" | "createdAt">): Promise<AuthSessionRecord>;
  findSessionByAccessHash(hash: string): Promise<AuthSessionRecord | undefined>;
  findSessionByRefreshHash(hash: string): Promise<AuthSessionRecord | undefined>;
  touchSession(sessionId: string, timestamp: string): Promise<AuthSessionRecord | undefined>;
  revokeSession(sessionId: string, timestamp: string): Promise<AuthSessionRecord | undefined>;
}

export interface MissionRepository {
  save(record: MissionRecord): Promise<MissionRecord>;
  get(missionId: string): Promise<MissionRecord | undefined>;
  list(): Promise<MissionRecord[]>;
  saveApproval(approval: ApprovalRecord): Promise<ApprovalRecord>;
  approve(
    missionId: string,
    approvalId: string,
    approverId: string,
    status: ApprovalRecord["status"]
  ): Promise<ApprovalRecord | undefined>;
  appendTransition(transition: MissionStateTransition): Promise<void>;
}

export interface MemoryRepository {
  save(workspaceId: string, records: MemoryRecord[]): Promise<void>;
  list(workspaceId: string): Promise<MemoryRecord[]>;
  search(
    workspaceId: string,
    embedding: number[],
    limit?: number
  ): Promise<Array<{ record: MemoryRecord; similarity: number }>>;
}

export interface AuditRepository {
  save(event: AuditEvent): Promise<void>;
  list(entityId?: string): Promise<AuditEvent[]>;
}

export interface HeartbeatRepository {
  save(heartbeat: HeartbeatDefinition): Promise<HeartbeatDefinition>;
  get(heartbeatId: string): Promise<HeartbeatDefinition | undefined>;
  list(): Promise<HeartbeatDefinition[]>;
}

export interface HeartbeatExecutionRepository {
  save(execution: HeartbeatExecutionRecord): Promise<HeartbeatExecutionRecord>;
  get(executionId: string): Promise<HeartbeatExecutionRecord | undefined>;
  list(heartbeatId?: string): Promise<HeartbeatExecutionRecord[]>;
}

export interface KnowledgeRepository {
  save(document: KnowledgeDocumentRecord): Promise<KnowledgeDocumentRecord>;
  list(workspaceId: string): Promise<KnowledgeDocumentRecord[]>;
  search(
    workspaceId: string,
    embedding: number[],
    limit?: number
  ): Promise<Array<{ document: KnowledgeDocumentRecord; similarity: number }>>;
}

export interface BillingRepository {
  getSubscription(workspaceId: string): Promise<WorkspaceBillingSubscriptionRecord | undefined>;
  saveSubscription(
    subscription: WorkspaceBillingSubscriptionRecord
  ): Promise<WorkspaceBillingSubscriptionRecord>;
  listUsageEvents(
    workspaceId: string,
    metric?: UsageEventRecord["metric"]
  ): Promise<UsageEventRecord[]>;
  saveUsageEvent(event: UsageEventRecord): Promise<UsageEventRecord>;
  updateUsageEventStripeStatus(
    eventId: string,
    status: StripeSyncStatus,
    error?: string | undefined
  ): Promise<UsageEventRecord | undefined>;
  getQuotaOverride(workspaceId: string): Promise<WorkspaceQuotaOverrideRecord | undefined>;
  saveQuotaOverride(
    record: WorkspaceQuotaOverrideRecord
  ): Promise<WorkspaceQuotaOverrideRecord>;
}

export interface NotificationRepository {
  save(record: NotificationRecord): Promise<NotificationRecord>;
  list(workspaceId: string, userId?: string): Promise<NotificationRecord[]>;
}

export interface IntegrationRepository {
  save(record: ConnectedIntegrationRecord): Promise<ConnectedIntegrationRecord>;
  get(
    workspaceId: string,
    provider: ConnectedIntegrationRecord["provider"]
  ): Promise<ConnectedIntegrationRecord | undefined>;
  list(workspaceId: string): Promise<ConnectedIntegrationRecord[]>;
  delete(
    workspaceId: string,
    provider: ConnectedIntegrationRecord["provider"]
  ): Promise<boolean>;
}

type IdentityPayload = {
  tenants: TenantRecord[];
  users: UserRecord[];
  workspaces: WorkspaceRecord[];
  memberships: WorkspaceMembership[];
  apiKeys: ApiKeyRecord[];
  roles: RoleRecord[];
  sessions: AuthSessionRecord[];
};

const defaultIdentityPayload = (): IdentityPayload => ({
  tenants: [],
  users: [],
  workspaces: [],
  memberships: [],
  apiKeys: [],
  roles: [],
  sessions: []
});

class LocalIdentityRepository implements IdentityRepository {
  private readonly store: LocalJsonStore<IdentityPayload>;

  constructor(baseDirectory = path.resolve("tmp", "runtime", "identity")) {
    this.store = new LocalJsonStore<IdentityPayload>(ensureDirectory(baseDirectory));
    if (!this.store.read("identity")) {
      this.store.write("identity", defaultIdentityPayload());
    }
  }

  private read() {
    const payload = this.store.read("identity");
    return {
      ...defaultIdentityPayload(),
      ...(payload ?? {}),
      tenants: payload?.tenants ?? [],
      users: payload?.users ?? [],
      workspaces: payload?.workspaces ?? [],
      memberships: payload?.memberships ?? [],
      apiKeys: payload?.apiKeys ?? [],
      roles: payload?.roles ?? [],
      sessions: payload?.sessions ?? []
    };
  }

  private write(payload: IdentityPayload) {
    this.store.write("identity", payload);
  }

  async createTenant(input: Omit<TenantRecord, "id" | "createdAt">) {
    const payload = this.read();
    const tenant: TenantRecord = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    };

    payload.tenants.push(tenant);
    this.write(payload);
    return tenant;
  }

  async listTenants() {
    return this.read().tenants.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async createUser(input: Omit<UserRecord, "id" | "createdAt">) {
    const payload = this.read();
    const user: UserRecord = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    };

    payload.users.push(user);
    this.write(payload);
    return user;
  }

  async getUserById(userId: string) {
    return this.read().users.find((user) => user.id === userId);
  }

  async listUsersByTenant(tenantId: string) {
    return this.read().users.filter((user) => user.tenantId === tenantId);
  }

  async createWorkspace(input: Omit<WorkspaceRecord, "id" | "createdAt">) {
    const payload = this.read();
    const workspace: WorkspaceRecord = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    };

    payload.workspaces.push(workspace);
    this.write(payload);
    return workspace;
  }

  async listWorkspacesByTenant(tenantId: string) {
    return this.read().workspaces.filter((workspace) => workspace.tenantId === tenantId);
  }

  async addMembership(input: Omit<WorkspaceMembership, "id" | "createdAt">) {
    const payload = this.read();
    const membership: WorkspaceMembership = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    };

    payload.memberships.push(membership);
    this.write(payload);
    return membership;
  }

  async createApiKey(input: Omit<ApiKeyRecord, "id" | "createdAt">) {
    const payload = this.read();
    const apiKey: ApiKeyRecord = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    };

    payload.apiKeys.push(apiKey);
    this.write(payload);
    return apiKey;
  }

  async listApiKeys(tenantId: string) {
    return this.read().apiKeys.filter((apiKey) => apiKey.tenantId === tenantId);
  }

  async findApiKeyByHash(hash: string) {
    return this.read().apiKeys.find((apiKey) => apiKey.hashedKey === hash);
  }

  async getTenantBySlug(slug: string) {
    return this.read().tenants.find((tenant) => tenant.slug === slug);
  }

  async getUserByEmail(tenantId: string, email: string) {
    return this.read().users.find(
      (user) => user.tenantId === tenantId && user.email.toLowerCase() === email.toLowerCase()
    );
  }

  async getWorkspaceBySlug(tenantId: string, slug: string) {
    return this.read().workspaces.find(
      (workspace) => workspace.tenantId === tenantId && workspace.slug === slug
    );
  }

  async listWorkspacesForUser(tenantId: string, userId: string) {
    const payload = this.read();
    const memberships = payload.memberships.filter(
      (membership) => membership.tenantId === tenantId && membership.userId === userId
    );
    const workspaceIds = new Set(memberships.map((membership) => membership.workspaceId));
    return payload.workspaces.filter((workspace) => workspaceIds.has(workspace.id));
  }

  async listMembershipsForWorkspace(workspaceId: string) {
    return this.read().memberships.filter((membership) => membership.workspaceId === workspaceId);
  }

  async listMembershipsForUser(tenantId: string, userId: string) {
    return this.read().memberships.filter(
      (membership) => membership.tenantId === tenantId && membership.userId === userId
    );
  }

  async updateMembershipRoles(membershipId: string, roleIds: string[]) {
    const payload = this.read();
    const membership = payload.memberships.find((candidate) => candidate.id === membershipId);
    if (!membership) {
      return undefined;
    }

    membership.roleIds = [...new Set(roleIds)];
    this.write(payload);
    return membership;
  }

  async createRole(input: Omit<RoleRecord, "id">) {
    const payload = this.read();
    const role: RoleRecord = {
      ...input,
      id: crypto.randomUUID()
    };
    payload.roles.push(role);
    this.write(payload);
    return role;
  }

  async listRoles(tenantId: string) {
    return this.read().roles.filter((role) => role.tenantId === tenantId);
  }

  async createSession(input: Omit<AuthSessionRecord, "id" | "createdAt">) {
    const payload = this.read();
    const session: AuthSessionRecord = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    };
    payload.sessions.push(session);
    this.write(payload);
    return session;
  }

  async findSessionByAccessHash(hash: string) {
    return this.read().sessions.find((session) => session.accessTokenHash === hash);
  }

  async findSessionByRefreshHash(hash: string) {
    return this.read().sessions.find((session) => session.refreshTokenHash === hash);
  }

  async touchSession(sessionId: string, timestamp: string) {
    const payload = this.read();
    const session = payload.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) {
      return undefined;
    }

    session.lastUsedAt = timestamp;
    this.write(payload);
    return session;
  }

  async revokeSession(sessionId: string, timestamp: string) {
    const payload = this.read();
    const session = payload.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) {
      return undefined;
    }

    session.revokedAt = timestamp;
    this.write(payload);
    return session;
  }
}

class LocalMissionRepository implements MissionRepository {
  private readonly missionStore: LocalJsonStore<MissionRecord>;
  private readonly transitionStore: LocalJsonStore<MissionStateTransition[]>;

  constructor(baseDirectory = path.resolve("tmp", "runtime", "missions")) {
    this.missionStore = new LocalJsonStore<MissionRecord>(ensureDirectory(baseDirectory));
    this.transitionStore = new LocalJsonStore<MissionStateTransition[]>(
      ensureDirectory(path.resolve(baseDirectory, "..", "mission-transitions"))
    );
  }

  async save(record: MissionRecord) {
    this.missionStore.write(record.objective.id, record);
    return record;
  }

  async get(missionId: string) {
    return this.missionStore.read(missionId);
  }

  async list() {
    return this.missionStore.list();
  }

  async saveApproval(approval: ApprovalRecord) {
    const record = await this.get(approval.missionId);
    if (!record) {
      throw new Error(`Mission "${approval.missionId}" not found.`);
    }

    record.approvals = [...(record.approvals ?? []), approval];
    await this.save(record);
    return approval;
  }

  async approve(missionId: string, approvalId: string, approverId: string, status: ApprovalRecord["status"]) {
    const record = await this.get(missionId);
    if (!record?.approvals) {
      return undefined;
    }

    const approval = record.approvals.find((candidate) => candidate.id === approvalId);
    if (!approval) {
      return undefined;
    }

    approval.status = status;
    approval.approvedBy = approverId;
    approval.updatedAt = new Date().toISOString();
    await this.save(record);
    return approval;
  }

  async appendTransition(transition: MissionStateTransition) {
    const existing = this.transitionStore.read(transition.missionId) ?? [];
    existing.push(transition);
    this.transitionStore.write(transition.missionId, existing);
  }
}

class LocalMemoryRepository implements MemoryRepository {
  private readonly store: LocalJsonStore<MemoryRecord[]>;

  constructor(baseDirectory = path.resolve("tmp", "runtime", "memory")) {
    this.store = new LocalJsonStore<MemoryRecord[]>(ensureDirectory(baseDirectory));
  }

  async save(workspaceId: string, records: MemoryRecord[]) {
    this.store.write(workspaceId, records);
  }

  async list(workspaceId: string) {
    return this.store.read(workspaceId) ?? [];
  }

  async search(workspaceId: string, embedding: number[], limit = 8) {
    const records = await this.list(workspaceId);
    return records
      .filter((record) => Array.isArray(record.embedding) && record.embedding.length === embedding.length)
      .map((record) => ({
        record,
        similarity: cosineSimilarity(record.embedding, embedding)
      }))
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, limit);
  }
}

class LocalAuditRepository implements AuditRepository {
  private readonly store: LocalJsonStore<AuditEvent>;

  constructor(baseDirectory = path.resolve("tmp", "runtime", "audit")) {
    this.store = new LocalJsonStore<AuditEvent>(ensureDirectory(baseDirectory));
  }

  async save(event: AuditEvent) {
    this.store.write(event.id, event);
  }

  async list(entityId?: string) {
    const events = this.store.list();
    return entityId ? events.filter((event) => event.entityId === entityId) : events;
  }
}

class LocalHeartbeatRepository implements HeartbeatRepository {
  private readonly store: LocalJsonStore<HeartbeatDefinition>;

  constructor(baseDirectory = path.resolve("tmp", "runtime", "heartbeats")) {
    this.store = new LocalJsonStore<HeartbeatDefinition>(ensureDirectory(baseDirectory));
  }

  async save(heartbeat: HeartbeatDefinition) {
    this.store.write(heartbeat.id, heartbeat);
    return heartbeat;
  }

  async get(heartbeatId: string) {
    return this.store.read(heartbeatId);
  }

  async list() {
    return this.store.list();
  }
}

class LocalHeartbeatExecutionRepository implements HeartbeatExecutionRepository {
  private readonly store: LocalJsonStore<HeartbeatExecutionRecord>;

  constructor(baseDirectory = path.resolve("tmp", "runtime", "heartbeat-executions")) {
    this.store = new LocalJsonStore<HeartbeatExecutionRecord>(ensureDirectory(baseDirectory));
  }

  async save(execution: HeartbeatExecutionRecord) {
    this.store.write(execution.id, execution);
    return execution;
  }

  async get(executionId: string) {
    return this.store.read(executionId);
  }

  async list(heartbeatId?: string) {
    const executions = this.store
      .list()
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      );
    return heartbeatId
      ? executions.filter((execution) => execution.heartbeatId === heartbeatId)
      : executions;
  }
}

class LocalKnowledgeRepository implements KnowledgeRepository {
  private readonly store: LocalJsonStore<KnowledgeDocumentRecord[]>;

  constructor(baseDirectory = path.resolve("tmp", "runtime", "knowledge")) {
    this.store = new LocalJsonStore<KnowledgeDocumentRecord[]>(ensureDirectory(baseDirectory));
  }

  async save(document: KnowledgeDocumentRecord) {
    const existing = this.store.read(document.workspaceId) ?? [];
    const next = existing.filter((candidate) => candidate.id !== document.id);
    next.push(document);
    this.store.write(document.workspaceId, next);
    return document;
  }

  async list(workspaceId: string) {
    return this.store.read(workspaceId) ?? [];
  }

  async search(workspaceId: string, embedding: number[], limit = 8) {
    const documents = await this.list(workspaceId);
    return documents
      .filter((document) => Array.isArray(document.embedding) && document.embedding.length === embedding.length)
      .map((document) => ({
        document,
        similarity: cosineSimilarity(document.embedding, embedding)
      }))
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, limit);
  }
}

class LocalBillingRepository implements BillingRepository {
  private readonly subscriptionStore: LocalJsonStore<WorkspaceBillingSubscriptionRecord>;
  private readonly usageStore: LocalJsonStore<UsageEventRecord>;
  private readonly quotaOverrideStore: LocalJsonStore<WorkspaceQuotaOverrideRecord>;

  constructor(baseDirectory = path.resolve("tmp", "runtime", "billing")) {
    this.subscriptionStore = new LocalJsonStore<WorkspaceBillingSubscriptionRecord>(
      ensureDirectory(path.join(baseDirectory, "subscriptions"))
    );
    this.usageStore = new LocalJsonStore<UsageEventRecord>(
      ensureDirectory(path.join(baseDirectory, "usage-events"))
    );
    this.quotaOverrideStore = new LocalJsonStore<WorkspaceQuotaOverrideRecord>(
      ensureDirectory(path.join(baseDirectory, "quota-overrides"))
    );
  }

  async getSubscription(workspaceId: string) {
    return this.subscriptionStore.read(workspaceId);
  }

  async saveSubscription(subscription: WorkspaceBillingSubscriptionRecord) {
    this.subscriptionStore.write(subscription.workspaceId, subscription);
    return subscription;
  }

  async listUsageEvents(workspaceId: string, metric?: UsageEventRecord["metric"]) {
    const events = this.usageStore
      .list()
      .filter((event) => event.workspaceId === workspaceId)
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
    return metric ? events.filter((event) => event.metric === metric) : events;
  }

  async saveUsageEvent(event: UsageEventRecord) {
    this.usageStore.write(event.id, event);
    return event;
  }

  async updateUsageEventStripeStatus(
    eventId: string,
    status: StripeSyncStatus,
    error?: string | undefined
  ) {
    const event = this.usageStore.read(eventId);
    if (!event) {
      return undefined;
    }

    event.stripeSyncStatus = status;
    event.stripeError = error;
    this.usageStore.write(eventId, event);
    return event;
  }

  async getQuotaOverride(workspaceId: string) {
    return this.quotaOverrideStore.read(workspaceId);
  }

  async saveQuotaOverride(record: WorkspaceQuotaOverrideRecord) {
    this.quotaOverrideStore.write(record.workspaceId, record);
    return record;
  }
}

class LocalIntegrationRepository implements IntegrationRepository {
  private readonly store: LocalJsonStore<ConnectedIntegrationRecord>;

  constructor(baseDirectory = path.resolve("tmp", "runtime", "integrations")) {
    this.store = new LocalJsonStore<ConnectedIntegrationRecord>(ensureDirectory(baseDirectory));
  }

  async save(record: ConnectedIntegrationRecord) {
    this.store.write(`${record.workspaceId}:${record.provider}`, record);
    return record;
  }

  async get(workspaceId: string, provider: ConnectedIntegrationRecord["provider"]) {
    return this.store.read(`${workspaceId}:${provider}`);
  }

  async list(workspaceId: string) {
    return this.store
      .list()
      .filter((record) => record.workspaceId === workspaceId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async delete(workspaceId: string, provider: ConnectedIntegrationRecord["provider"]) {
    const key = `${workspaceId}:${provider}`;
    if (!this.store.read(key)) {
      return false;
    }

    this.store.delete(key);
    return true;
  }
}

class LocalNotificationRepository implements NotificationRepository {
  private readonly store: LocalJsonStore<NotificationRecord>;

  constructor(baseDirectory = path.resolve("tmp", "runtime", "notifications")) {
    this.store = new LocalJsonStore<NotificationRecord>(ensureDirectory(baseDirectory));
  }

  async save(record: NotificationRecord) {
    this.store.write(record.id, record);
    return record;
  }

  async list(workspaceId: string, userId?: string) {
    return this.store
      .list()
      .filter((record) => record.workspaceId === workspaceId)
      .filter((record) => (userId ? record.userId === userId : true))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
}

const serializeVector = (embedding: number[] | undefined) => {
  if (!embedding || embedding.length === 0) {
    return null;
  }

  return `[${embedding.join(",")}]`;
};

const parseVector = (raw: string | null) => {
  if (!raw) {
    return undefined;
  }

  const normalized = raw.trim();
  const body =
    normalized.startsWith("[") && normalized.endsWith("]")
      ? normalized.slice(1, -1)
      : normalized;
  if (!body) {
    return undefined;
  }

  return body.split(",").map((value) => Number(value));
};

class PostgresRuntime {
  readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString
    });
  }
}

interface MembershipRow {
  id: string;
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  role_ids: string[] | null;
  created_at: Date;
}

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  created_at: Date;
}

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  display_name: string;
  created_at: Date;
}

interface WorkspaceRow {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  created_at: Date;
}

interface ApiKeyRow {
  id: string;
  tenant_id: string;
  user_id: string;
  workspace_ids: string[] | null;
  label: string;
  hashed_key: string;
  preview: string;
  active: boolean;
  created_at: Date;
  last_used_at: Date | null;
}

interface RawMissionRow {
  raw_record: MissionRecord;
}

interface ApprovalRow {
  id: string;
  mission_id: string;
  tenant_id: string | null;
  workspace_id: string;
  status: ApprovalRecord["status"];
  reason: string;
  required_actions: string[] | null;
  approved_by: string | null;
  created_at: Date;
  updated_at: Date;
}

interface MemoryRow {
  id: string;
  workspace_id: string;
  scope: MemoryRecord["scope"];
  text: string;
  tags: string[] | null;
  importance: number | null;
  content_hash: string;
  embedding: string | null;
  embedding_model: string | null;
  embedding_updated_at: Date | null;
  created_at: Date;
}

interface AuditRow {
  id: string;
  kind: string;
  entity_id: string;
  actor: string;
  details: Record<string, unknown> | null;
  created_at: Date;
}

interface HeartbeatRow {
  id: string;
  tenant_id: string | null;
  workspace_id: string;
  name: string;
  schedule: string;
  objective: string;
  active: boolean;
  last_run_at: Date | null;
  next_run_at: Date | null;
  last_scheduled_at: Date | null;
  scheduler_status: "idle" | "scheduled" | "paused" | "error" | null;
  last_scheduler_error: string | null;
}

interface HeartbeatExecutionRow {
  id: string;
  heartbeat_id: string;
  tenant_id: string | null;
  workspace_id: string;
  status: HeartbeatExecutionRecord["status"];
  trigger_kind: HeartbeatExecutionRecord["triggerKind"];
  requested_by: string | null;
  summary: string;
  result: Record<string, unknown> | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  error: string | null;
}

interface KnowledgeRow {
  id: string;
  workspace_id: string;
  title: string;
  body: string;
  metadata: Record<string, unknown> | null;
  content_hash: string;
  excerpt: string;
  embedding: string | null;
  embedding_model: string | null;
  embedding_updated_at: Date | null;
  created_at: Date;
}

interface BillingSubscriptionRow {
  workspace_id: string;
  tenant_id: string | null;
  plan_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface QuotaOverrideRow {
  workspace_id: string;
  tenant_id: string | null;
  limits: Partial<Record<UsageEventRecord["metric"], number>> | null;
  reason: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
}

interface UsageEventRow {
  id: string;
  workspace_id: string;
  tenant_id: string | null;
  metric: UsageEventRecord["metric"];
  quantity: number;
  source_service: string;
  source_entity_id: string;
  timestamp: Date;
  stripe_sync_status: StripeSyncStatus;
  stripe_error: string | null;
  billable: boolean;
  metered_at: Date;
  metadata: Record<string, unknown> | null;
}

interface IntegrationRow {
  id: string;
  tenant_id: string | null;
  workspace_id: string;
  provider: ConnectedIntegrationRecord["provider"];
  status: ConnectedIntegrationRecord["status"];
  scopes: string[] | null;
  provider_account_id: string | null;
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  access_token_expires_at: Date | null;
  last_error: string | null;
  metadata: Record<string, unknown> | null;
  connected_at: Date;
  updated_at: Date;
}

interface NotificationRow {
  id: string;
  tenant_id: string | null;
  workspace_id: string;
  user_id: string;
  channel: NotificationRecord["channel"];
  event_type: NotificationRecord["eventType"];
  target: string;
  subject: string;
  body: string;
  status: NotificationRecord["status"];
  mode: NotificationRecord["mode"];
  metadata: Record<string, unknown> | null;
  created_at: Date;
  sent_at: Date | null;
  error: string | null;
}

interface RoleRow {
  id: string;
  tenant_id: string;
  name: string;
  permissions: string[] | null;
  system: boolean;
  created_at: Date;
}

interface SessionRow {
  id: string;
  tenant_id: string;
  user_id: string;
  workspace_ids: string[] | null;
  role_ids: string[] | null;
  permissions: string[] | null;
  subject_type: "user" | "service";
  access_token_hash: string;
  refresh_token_hash: string;
  access_expires_at: Date;
  refresh_expires_at: Date;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

class PostgresIdentityRepository implements IdentityRepository {
  constructor(private readonly runtime: PostgresRuntime) {}

  async createTenant(input: Omit<TenantRecord, "id" | "createdAt">) {
    const tenant: TenantRecord = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    };

    await this.runtime.pool.query(
      "insert into tenants (id, name, slug, created_at) values ($1, $2, $3, $4)",
      [tenant.id, tenant.name, tenant.slug, tenant.createdAt]
    );
    return tenant;
  }

  async listTenants() {
    const result = await this.runtime.pool.query<TenantRow>(
      "select * from tenants order by created_at asc"
    );
    return result.rows.map(mapTenantRow);
  }

  async createUser(input: Omit<UserRecord, "id" | "createdAt">) {
    const user: UserRecord = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    };

    await this.runtime.pool.query(
      "insert into users (id, tenant_id, email, display_name, created_at) values ($1, $2, $3, $4, $5)",
      [user.id, user.tenantId, user.email, user.displayName, user.createdAt]
    );
    return user;
  }

  async getUserById(userId: string) {
    const result = await this.runtime.pool.query<UserRow>(
      "select * from users where id = $1 limit 1",
      [userId]
    );
    return result.rows[0] ? mapUserRow(result.rows[0]) : undefined;
  }

  async listUsersByTenant(tenantId: string) {
    const result = await this.runtime.pool.query<UserRow>(
      "select * from users where tenant_id = $1 order by created_at asc",
      [tenantId]
    );
    return result.rows.map(mapUserRow);
  }

  async createWorkspace(input: Omit<WorkspaceRecord, "id" | "createdAt">) {
    const workspace: WorkspaceRecord = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    };

    await this.runtime.pool.query(
      "insert into workspaces (id, tenant_id, name, slug, created_at) values ($1, $2, $3, $4, $5)",
      [workspace.id, workspace.tenantId, workspace.name, workspace.slug, workspace.createdAt]
    );
    return workspace;
  }

  async listWorkspacesByTenant(tenantId: string) {
    const result = await this.runtime.pool.query<WorkspaceRow>(
      "select * from workspaces where tenant_id = $1 order by created_at asc",
      [tenantId]
    );
    return result.rows.map(mapWorkspaceRow);
  }

  async addMembership(input: Omit<WorkspaceMembership, "id" | "createdAt">) {
    const membership: WorkspaceMembership = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    };

    await this.runtime.pool.query(
      "insert into workspace_memberships (id, tenant_id, workspace_id, user_id, role_ids, created_at) values ($1, $2, $3, $4, $5::jsonb, $6)",
      [membership.id, membership.tenantId, membership.workspaceId, membership.userId, JSON.stringify(membership.roleIds), membership.createdAt]
    );
    return membership;
  }

  async createApiKey(input: Omit<ApiKeyRecord, "id" | "createdAt">) {
    const apiKey: ApiKeyRecord = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    };

    await this.runtime.pool.query(
      "insert into api_keys (id, tenant_id, user_id, workspace_ids, label, hashed_key, preview, active, created_at, last_used_at) values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10)",
      [apiKey.id, apiKey.tenantId, apiKey.userId, JSON.stringify(apiKey.workspaceIds), apiKey.label, apiKey.hashedKey, apiKey.preview, apiKey.active, apiKey.createdAt, apiKey.lastUsedAt ?? null]
    );
    return apiKey;
  }

  async listApiKeys(tenantId: string) {
    const result = await this.runtime.pool.query<ApiKeyRow>(
      "select * from api_keys where tenant_id = $1 order by created_at asc",
      [tenantId]
    );
    return result.rows.map(mapApiKeyRow);
  }

  async findApiKeyByHash(hash: string) {
    const result = await this.runtime.pool.query<ApiKeyRow>(
      "select * from api_keys where hashed_key = $1 limit 1",
      [hash]
    );
    return result.rows[0] ? mapApiKeyRow(result.rows[0]) : undefined;
  }

  async getTenantBySlug(slug: string) {
    const result = await this.runtime.pool.query<TenantRow>(
      "select * from tenants where slug = $1 limit 1",
      [slug]
    );
    return result.rows[0] ? mapTenantRow(result.rows[0]) : undefined;
  }

  async getUserByEmail(tenantId: string, email: string) {
    const result = await this.runtime.pool.query<UserRow>(
      "select * from users where tenant_id = $1 and lower(email) = lower($2) limit 1",
      [tenantId, email]
    );
    return result.rows[0] ? mapUserRow(result.rows[0]) : undefined;
  }

  async getWorkspaceBySlug(tenantId: string, slug: string) {
    const result = await this.runtime.pool.query<WorkspaceRow>(
      "select * from workspaces where tenant_id = $1 and slug = $2 limit 1",
      [tenantId, slug]
    );
    return result.rows[0] ? mapWorkspaceRow(result.rows[0]) : undefined;
  }

  async listWorkspacesForUser(tenantId: string, userId: string) {
    const result = await this.runtime.pool.query<WorkspaceRow>(
      `select w.*
       from workspaces w
       inner join workspace_memberships m on m.workspace_id = w.id
       where m.tenant_id = $1 and m.user_id = $2
       order by w.created_at asc`,
      [tenantId, userId]
    );
    return result.rows.map(mapWorkspaceRow);
  }

  async listMembershipsForWorkspace(workspaceId: string) {
    const result = await this.runtime.pool.query<MembershipRow>(
      "select * from workspace_memberships where workspace_id = $1 order by created_at asc",
      [workspaceId]
    );
    return result.rows.map(mapMembershipRow);
  }

  async listMembershipsForUser(tenantId: string, userId: string) {
    const result = await this.runtime.pool.query<MembershipRow>(
      "select * from workspace_memberships where tenant_id = $1 and user_id = $2",
      [tenantId, userId]
    );

    return result.rows.map(mapMembershipRow);
  }

  async updateMembershipRoles(membershipId: string, roleIds: string[]) {
    const result = await this.runtime.pool.query<MembershipRow>(
      "update workspace_memberships set role_ids = $1::jsonb where id = $2 returning *",
      [JSON.stringify([...new Set(roleIds)]), membershipId]
    );
    return result.rows[0] ? mapMembershipRow(result.rows[0]) : undefined;
  }

  async createRole(input: Omit<RoleRecord, "id">) {
    const role: RoleRecord = {
      ...input,
      id: crypto.randomUUID()
    };
    await this.runtime.pool.query(
      "insert into roles (id, tenant_id, name, permissions, system, created_at) values ($1, $2, $3, $4::jsonb, $5, $6)",
      [
        role.id,
        role.tenantId,
        role.name,
        JSON.stringify(role.permissions),
        role.system ?? false,
        role.createdAt ?? new Date().toISOString()
      ]
    );
    return role;
  }

  async listRoles(tenantId: string) {
    const result = await this.runtime.pool.query<RoleRow>(
      "select * from roles where tenant_id = $1 order by system desc, name asc",
      [tenantId]
    );
    return result.rows.map(mapRoleRow);
  }

  async createSession(input: Omit<AuthSessionRecord, "id" | "createdAt">) {
    const session: AuthSessionRecord = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    };
    await this.runtime.pool.query(
      `insert into auth_sessions
       (id, tenant_id, user_id, workspace_ids, role_ids, permissions, subject_type, access_token_hash, refresh_token_hash, access_expires_at, refresh_expires_at, created_at, last_used_at, revoked_at)
       values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        session.id,
        session.tenantId,
        session.userId,
        JSON.stringify(session.workspaceIds),
        JSON.stringify(session.roleIds),
        JSON.stringify(session.permissions),
        session.subjectType,
        session.accessTokenHash,
        session.refreshTokenHash,
        session.accessExpiresAt,
        session.refreshExpiresAt,
        session.createdAt,
        session.lastUsedAt ?? null,
        session.revokedAt ?? null
      ]
    );
    return session;
  }

  async findSessionByAccessHash(hash: string) {
    const result = await this.runtime.pool.query<SessionRow>(
      "select * from auth_sessions where access_token_hash = $1 limit 1",
      [hash]
    );
    return result.rows[0] ? mapSessionRow(result.rows[0]) : undefined;
  }

  async findSessionByRefreshHash(hash: string) {
    const result = await this.runtime.pool.query<SessionRow>(
      "select * from auth_sessions where refresh_token_hash = $1 limit 1",
      [hash]
    );
    return result.rows[0] ? mapSessionRow(result.rows[0]) : undefined;
  }

  async touchSession(sessionId: string, timestamp: string) {
    const result = await this.runtime.pool.query<SessionRow>(
      "update auth_sessions set last_used_at = $1 where id = $2 returning *",
      [timestamp, sessionId]
    );
    return result.rows[0] ? mapSessionRow(result.rows[0]) : undefined;
  }

  async revokeSession(sessionId: string, timestamp: string) {
    const result = await this.runtime.pool.query<SessionRow>(
      "update auth_sessions set revoked_at = $1 where id = $2 returning *",
      [timestamp, sessionId]
    );
    return result.rows[0] ? mapSessionRow(result.rows[0]) : undefined;
  }
}

const mapTenantRow = (row: TenantRow): TenantRecord => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  createdAt: row.created_at.toISOString()
});

const mapUserRow = (row: UserRow): UserRecord => ({
  id: row.id,
  tenantId: row.tenant_id,
  email: row.email,
  displayName: row.display_name,
  createdAt: row.created_at.toISOString()
});

const mapWorkspaceRow = (row: WorkspaceRow): WorkspaceRecord => ({
  id: row.id,
  tenantId: row.tenant_id,
  name: row.name,
  slug: row.slug,
  createdAt: row.created_at.toISOString()
});

const mapMembershipRow = (row: MembershipRow): WorkspaceMembership => ({
  id: row.id,
  tenantId: row.tenant_id,
  workspaceId: row.workspace_id,
  userId: row.user_id,
  roleIds: row.role_ids ?? [],
  createdAt: row.created_at.toISOString()
});

const mapApiKeyRow = (row: ApiKeyRow): ApiKeyRecord => ({
  id: row.id,
  tenantId: row.tenant_id,
  userId: row.user_id,
  workspaceIds: row.workspace_ids ?? [],
  label: row.label,
  hashedKey: row.hashed_key,
  preview: row.preview,
  active: row.active,
  createdAt: row.created_at.toISOString(),
  lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : undefined
});

const mapRoleRow = (row: RoleRow): RoleRecord => ({
  id: row.id,
  tenantId: row.tenant_id,
  name: row.name,
  permissions: row.permissions ?? [],
  system: row.system,
  createdAt: row.created_at.toISOString()
});

const mapSessionRow = (row: SessionRow): AuthSessionRecord => ({
  id: row.id,
  tenantId: row.tenant_id,
  userId: row.user_id,
  workspaceIds: row.workspace_ids ?? [],
  roleIds: row.role_ids ?? [],
  permissions: row.permissions ?? [],
  subjectType: row.subject_type,
  accessTokenHash: row.access_token_hash,
  refreshTokenHash: row.refresh_token_hash,
  accessExpiresAt: row.access_expires_at.toISOString(),
  refreshExpiresAt: row.refresh_expires_at.toISOString(),
  createdAt: row.created_at.toISOString(),
  lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : undefined,
  revokedAt: row.revoked_at ? row.revoked_at.toISOString() : undefined
});

const mapMemoryRow = (row: MemoryRow): MemoryRecord => ({
  id: row.id,
  workspaceId: row.workspace_id,
  scope: row.scope,
  text: row.text,
  tags: row.tags ?? [],
  importance: row.importance ?? undefined,
  contentHash: row.content_hash,
  embedding: parseVector(row.embedding),
  embeddingModel: row.embedding_model ?? undefined,
  embeddingUpdatedAt: row.embedding_updated_at?.toISOString(),
  createdAt: row.created_at.toISOString()
});

const mapKnowledgeRow = (row: KnowledgeRow): KnowledgeDocumentRecord => ({
  id: row.id,
  workspaceId: row.workspace_id,
  title: row.title,
  body: row.body,
  metadata: row.metadata ?? {},
  contentHash: row.content_hash,
  excerpt: row.excerpt,
  embedding: parseVector(row.embedding),
  embeddingModel: row.embedding_model ?? undefined,
  embeddingUpdatedAt: row.embedding_updated_at?.toISOString(),
  createdAt: row.created_at.toISOString()
});

const mapBillingSubscriptionRow = (
  row: BillingSubscriptionRow
): WorkspaceBillingSubscriptionRecord => ({
  workspaceId: row.workspace_id,
  tenantId: row.tenant_id ?? undefined,
  planId: row.plan_id,
  stripeCustomerId: row.stripe_customer_id ?? undefined,
  stripeSubscriptionId: row.stripe_subscription_id ?? undefined,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString()
});

const mapUsageEventRow = (row: UsageEventRow): UsageEventRecord => ({
  id: row.id,
  workspaceId: row.workspace_id,
  tenantId: row.tenant_id ?? undefined,
  metric: row.metric,
  quantity: row.quantity,
  sourceService: row.source_service,
  sourceEntityId: row.source_entity_id,
  timestamp: row.timestamp.toISOString(),
  stripeSyncStatus: row.stripe_sync_status,
  stripeError: row.stripe_error ?? undefined,
  billable: row.billable,
  meteredAt: row.metered_at.toISOString(),
  metadata: row.metadata ?? {}
});

const mapQuotaOverrideRow = (row: QuotaOverrideRow): WorkspaceQuotaOverrideRecord => ({
  workspaceId: row.workspace_id,
  tenantId: row.tenant_id ?? undefined,
  limits: row.limits ?? {},
  reason: row.reason ?? undefined,
  updatedBy: row.updated_by ?? undefined,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString()
});

const mapIntegrationRow = (row: IntegrationRow): ConnectedIntegrationRecord => ({
  id: row.id,
  tenantId: row.tenant_id ?? undefined,
  workspaceId: row.workspace_id,
  provider: row.provider,
  status: row.status,
  scopes: row.scopes ?? [],
  providerAccountId: row.provider_account_id ?? undefined,
  encryptedAccessToken: row.encrypted_access_token ?? undefined,
  encryptedRefreshToken: row.encrypted_refresh_token ?? undefined,
  accessTokenExpiresAt: row.access_token_expires_at?.toISOString(),
  lastError: row.last_error ?? undefined,
  metadata: row.metadata ?? {},
  connectedAt: row.connected_at.toISOString(),
  updatedAt: row.updated_at.toISOString()
});

const mapNotificationRow = (row: NotificationRow): NotificationRecord => ({
  id: row.id,
  tenantId: row.tenant_id ?? undefined,
  workspaceId: row.workspace_id,
  userId: row.user_id,
  channel: row.channel,
  eventType: row.event_type,
  target: row.target,
  subject: row.subject,
  body: row.body,
  status: row.status,
  mode: row.mode,
  metadata: row.metadata ?? {},
  createdAt: row.created_at.toISOString(),
  sentAt: row.sent_at?.toISOString(),
  error: row.error ?? undefined
});

class PrismaRuntime {
  readonly client: any;

  constructor(client?: PrismaClient) {
    this.client = client ?? new PrismaClient();
  }
}

const mapPrismaTenant = (row: {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
}): TenantRecord => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  createdAt: row.createdAt.toISOString()
});

const mapPrismaUser = (row: {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  createdAt: Date;
}): UserRecord => ({
  id: row.id,
  tenantId: row.tenantId,
  email: row.email,
  displayName: row.displayName,
  createdAt: row.createdAt.toISOString()
});

const mapPrismaWorkspace = (row: {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  createdAt: Date;
}): WorkspaceRecord => ({
  id: row.id,
  tenantId: row.tenantId,
  name: row.name,
  slug: row.slug,
  createdAt: row.createdAt.toISOString()
});

const mapPrismaMembership = (row: {
  id: string;
  tenantId: string;
  workspaceId: string;
  userId: string;
  roleIds: unknown;
  createdAt: Date;
}): WorkspaceMembership => ({
  id: row.id,
  tenantId: row.tenantId,
  workspaceId: row.workspaceId,
  userId: row.userId,
  roleIds: asStringArray(row.roleIds),
  createdAt: row.createdAt.toISOString()
});

const mapPrismaApiKey = (row: {
  id: string;
  tenantId: string;
  userId: string;
  workspaceIds: unknown;
  label: string;
  hashedKey: string;
  preview: string;
  active: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
}): ApiKeyRecord => ({
  id: row.id,
  tenantId: row.tenantId,
  userId: row.userId,
  workspaceIds: asStringArray(row.workspaceIds),
  label: row.label,
  hashedKey: row.hashedKey,
  preview: row.preview,
  active: row.active,
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: toIsoString(row.lastUsedAt)
});

const mapPrismaRole = (row: {
  id: string;
  tenantId: string;
  name: string;
  permissions: unknown;
  system: boolean;
  createdAt: Date;
}): RoleRecord => ({
  id: row.id,
  tenantId: row.tenantId,
  name: row.name,
  permissions: asStringArray(row.permissions),
  system: row.system,
  createdAt: row.createdAt.toISOString()
});

const mapPrismaSession = (row: {
  id: string;
  tenantId: string;
  userId: string;
  workspaceIds: unknown;
  roleIds: unknown;
  permissions: unknown;
  subjectType: string;
  accessTokenHash: string;
  refreshTokenHash: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}): AuthSessionRecord => ({
  id: row.id,
  tenantId: row.tenantId,
  userId: row.userId,
  workspaceIds: asStringArray(row.workspaceIds),
  roleIds: asStringArray(row.roleIds),
  permissions: asStringArray(row.permissions),
  subjectType: row.subjectType as AuthSessionRecord["subjectType"],
  accessTokenHash: row.accessTokenHash,
  refreshTokenHash: row.refreshTokenHash,
  accessExpiresAt: row.accessExpiresAt.toISOString(),
  refreshExpiresAt: row.refreshExpiresAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: toIsoString(row.lastUsedAt),
  revokedAt: toIsoString(row.revokedAt)
});

const mapPrismaBillingSubscription = (row: {
  workspaceId: string;
  tenantId: string | null;
  planId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): WorkspaceBillingSubscriptionRecord => ({
  workspaceId: row.workspaceId,
  tenantId: row.tenantId ?? undefined,
  planId: row.planId,
  stripeCustomerId: row.stripeCustomerId ?? undefined,
  stripeSubscriptionId: row.stripeSubscriptionId ?? undefined,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString()
});

const mapPrismaUsageEvent = (row: {
  id: string;
  workspaceId: string;
  tenantId: string | null;
  metric: string;
  quantity: number;
  sourceService: string;
  sourceEntityId: string;
  timestamp: Date;
  stripeSyncStatus: string;
  stripeError: string | null;
  billable: boolean;
  meteredAt: Date;
  metadata: unknown;
}): UsageEventRecord => ({
  id: row.id,
  workspaceId: row.workspaceId,
  tenantId: row.tenantId ?? undefined,
  metric: row.metric as UsageEventRecord["metric"],
  quantity: row.quantity,
  sourceService: row.sourceService,
  sourceEntityId: row.sourceEntityId,
  timestamp: row.timestamp.toISOString(),
  stripeSyncStatus: row.stripeSyncStatus as StripeSyncStatus,
  stripeError: row.stripeError ?? undefined,
  billable: row.billable,
  meteredAt: row.meteredAt.toISOString(),
  metadata: asRecord(row.metadata)
});

const mapPrismaQuotaOverride = (row: {
  workspaceId: string;
  tenantId: string | null;
  limits: unknown;
  reason: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}): WorkspaceQuotaOverrideRecord => ({
  workspaceId: row.workspaceId,
  tenantId: row.tenantId ?? undefined,
  limits: asRecord(row.limits) as WorkspaceQuotaOverrideRecord["limits"],
  reason: row.reason ?? undefined,
  updatedBy: row.updatedBy ?? undefined,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString()
});

const mapPrismaIntegration = (row: {
  id: string;
  tenantId: string | null;
  workspaceId: string;
  provider: string;
  status: string;
  scopes: unknown;
  providerAccountId: string | null;
  encryptedAccessToken: string | null;
  encryptedRefreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  lastError: string | null;
  metadata: unknown;
  connectedAt: Date;
  updatedAt: Date;
}): ConnectedIntegrationRecord => ({
  id: row.id,
  tenantId: row.tenantId ?? undefined,
  workspaceId: row.workspaceId,
  provider: row.provider as ConnectedIntegrationRecord["provider"],
  status: row.status as ConnectedIntegrationRecord["status"],
  scopes: asStringArray(row.scopes),
  providerAccountId: row.providerAccountId ?? undefined,
  encryptedAccessToken: row.encryptedAccessToken ?? undefined,
  encryptedRefreshToken: row.encryptedRefreshToken ?? undefined,
  accessTokenExpiresAt: toIsoString(row.accessTokenExpiresAt),
  lastError: row.lastError ?? undefined,
  metadata: asRecord(row.metadata),
  connectedAt: row.connectedAt.toISOString(),
  updatedAt: row.updatedAt.toISOString()
});

const mapPrismaNotification = (row: {
  id: string;
  tenantId: string | null;
  workspaceId: string;
  userId: string;
  channel: string;
  eventType: string;
  target: string;
  subject: string;
  body: string;
  status: string;
  mode: string;
  metadata: unknown;
  createdAt: Date;
  sentAt: Date | null;
  error: string | null;
}): NotificationRecord => ({
  id: row.id,
  tenantId: row.tenantId ?? undefined,
  workspaceId: row.workspaceId,
  userId: row.userId,
  channel: row.channel as NotificationRecord["channel"],
  eventType: row.eventType as NotificationRecord["eventType"],
  target: row.target,
  subject: row.subject,
  body: row.body,
  status: row.status as NotificationRecord["status"],
  mode: row.mode as NotificationRecord["mode"],
  metadata: asRecord(row.metadata),
  createdAt: row.createdAt.toISOString(),
  sentAt: toIsoString(row.sentAt),
  error: row.error ?? undefined
});

const mapPrismaApproval = (row: {
  id: string;
  missionId: string;
  tenantId: string | null;
  workspaceId: string;
  status: string;
  reason: string;
  requiredActions: unknown;
  approvedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ApprovalRecord => ({
  id: row.id,
  missionId: row.missionId,
  tenantId: row.tenantId ?? undefined,
  workspaceId: row.workspaceId,
  status: row.status as ApprovalRecord["status"],
  reason: row.reason,
  requiredActions: asStringArray(row.requiredActions),
  approvedBy: row.approvedBy ?? undefined,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString()
});

const mapPrismaMissionTransition = (row: {
  id: string;
  missionId: string;
  from: string;
  to: string;
  reason: string;
  actor: string;
  createdAt: Date;
}): MissionStateTransition => ({
  id: row.id,
  missionId: row.missionId,
  from: row.from as MissionStateTransition["from"],
  to: row.to as MissionStateTransition["to"],
  reason: row.reason,
  actor: row.actor,
  createdAt: row.createdAt.toISOString()
});

const mapPrismaAuditEvent = (row: {
  id: string;
  kind: string;
  entityId: string;
  actor: string;
  details: unknown;
  createdAt: Date;
}): AuditEvent => ({
  id: row.id,
  kind: row.kind,
  entityId: row.entityId,
  actor: row.actor,
  details: asRecord(row.details),
  createdAt: row.createdAt.toISOString()
});

const mapPrismaHeartbeat = (row: {
  id: string;
  tenantId: string | null;
  workspaceId: string;
  name: string;
  schedule: string;
  objective: string;
  active: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  lastScheduledAt: Date | null;
  schedulerStatus: string | null;
  lastSchedulerError: string | null;
}): HeartbeatDefinition => ({
  id: row.id,
  tenantId: row.tenantId ?? undefined,
  workspaceId: row.workspaceId,
  name: row.name,
  schedule: row.schedule,
  objective: row.objective,
  active: row.active,
  lastRunAt: toIsoString(row.lastRunAt),
  nextRunAt: toIsoString(row.nextRunAt),
  lastScheduledAt: toIsoString(row.lastScheduledAt),
  schedulerStatus: row.schedulerStatus as HeartbeatDefinition["schedulerStatus"],
  lastSchedulerError: row.lastSchedulerError ?? undefined
});

const mapPrismaHeartbeatExecution = (row: {
  id: string;
  heartbeatId: string;
  tenantId: string | null;
  workspaceId: string;
  status: string;
  triggerKind: string;
  requestedBy: string | null;
  summary: string;
  result: unknown;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
}): HeartbeatExecutionRecord => ({
  id: row.id,
  heartbeatId: row.heartbeatId,
  tenantId: row.tenantId ?? undefined,
  workspaceId: row.workspaceId,
  status: row.status as HeartbeatExecutionRecord["status"],
  triggerKind: row.triggerKind as HeartbeatExecutionRecord["triggerKind"],
  requestedBy: row.requestedBy ?? undefined,
  summary: row.summary,
  result: asRecord(row.result),
  createdAt: row.createdAt.toISOString(),
  startedAt: toIsoString(row.startedAt),
  finishedAt: toIsoString(row.finishedAt),
  error: row.error ?? undefined
});

const hydrateMissionRecord = (
  rawRecord: unknown,
  approvals: ApprovalRecord[],
  transitions: MissionStateTransition[]
): MissionRecord | undefined => {
  if (!rawRecord || typeof rawRecord !== "object" || Array.isArray(rawRecord)) {
    return undefined;
  }

  const record = rawRecord as MissionRecord;
  return {
    ...record,
    approvals,
    transitions
  };
};

export class PrismaIdentityRepository implements IdentityRepository {
  constructor(private readonly runtime: PrismaRuntime) {}

  async createTenant(input: Omit<TenantRecord, "id" | "createdAt">) {
    return mapPrismaTenant(
      await this.runtime.client.tenant.create({
        data: {
          id: crypto.randomUUID(),
          name: input.name,
          slug: input.slug,
          createdAt: new Date()
        }
      })
    );
  }

  async listTenants() {
    return (await this.runtime.client.tenant.findMany({ orderBy: { createdAt: "asc" } })).map(
      mapPrismaTenant
    );
  }

  async createUser(input: Omit<UserRecord, "id" | "createdAt">) {
    return mapPrismaUser(
      await this.runtime.client.user.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: input.tenantId,
          email: input.email,
          displayName: input.displayName,
          createdAt: new Date()
        }
      })
    );
  }

  async getUserById(userId: string) {
    const row = await this.runtime.client.user.findUnique({ where: { id: userId } });
    return row ? mapPrismaUser(row) : undefined;
  }

  async listUsersByTenant(tenantId: string) {
    return (
      await this.runtime.client.user.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } })
    ).map(mapPrismaUser);
  }

  async createWorkspace(input: Omit<WorkspaceRecord, "id" | "createdAt">) {
    return mapPrismaWorkspace(
      await this.runtime.client.workspace.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: input.tenantId,
          name: input.name,
          slug: input.slug,
          createdAt: new Date()
        }
      })
    );
  }

  async listWorkspacesByTenant(tenantId: string) {
    return (
      await this.runtime.client.workspace.findMany({
        where: { tenantId },
        orderBy: { createdAt: "asc" }
      })
    ).map(mapPrismaWorkspace);
  }

  async addMembership(input: Omit<WorkspaceMembership, "id" | "createdAt">) {
    return mapPrismaMembership(
      await this.runtime.client.workspaceMembership.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          userId: input.userId,
          roleIds: input.roleIds,
          createdAt: new Date()
        }
      })
    );
  }

  async createApiKey(input: Omit<ApiKeyRecord, "id" | "createdAt">) {
    return mapPrismaApiKey(
      await this.runtime.client.apiKey.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: input.tenantId,
          userId: input.userId,
          workspaceIds: input.workspaceIds,
          label: input.label,
          hashedKey: input.hashedKey,
          preview: input.preview,
          active: input.active,
          createdAt: new Date(),
          lastUsedAt: input.lastUsedAt ? new Date(input.lastUsedAt) : null
        }
      })
    );
  }

  async listApiKeys(tenantId: string) {
    return (
      await this.runtime.client.apiKey.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } })
    ).map(mapPrismaApiKey);
  }

  async findApiKeyByHash(hash: string) {
    const row = await this.runtime.client.apiKey.findUnique({ where: { hashedKey: hash } });
    return row ? mapPrismaApiKey(row) : undefined;
  }

  async getTenantBySlug(slug: string) {
    const row = await this.runtime.client.tenant.findUnique({ where: { slug } });
    return row ? mapPrismaTenant(row) : undefined;
  }

  async getUserByEmail(tenantId: string, email: string) {
    const users = await this.runtime.client.user.findMany({ where: { tenantId } });
    const row = users.find(
      (candidate: { email: string }) => candidate.email.toLowerCase() === email.toLowerCase()
    );
    return row ? mapPrismaUser(row) : undefined;
  }

  async getWorkspaceBySlug(tenantId: string, slug: string) {
    const row = await this.runtime.client.workspace.findFirst({
      where: { tenantId, slug }
    });
    return row ? mapPrismaWorkspace(row) : undefined;
  }

  async listWorkspacesForUser(tenantId: string, userId: string) {
    const memberships = await this.runtime.client.workspaceMembership.findMany({
      where: { tenantId, userId }
    });
    const workspaceIds = memberships.map((membership: { workspaceId: string }) => membership.workspaceId);
    if (workspaceIds.length === 0) {
      return [];
    }

    return (
      await this.runtime.client.workspace.findMany({
        where: {
          tenantId,
          id: { in: workspaceIds }
        },
        orderBy: { createdAt: "asc" }
      })
    ).map(mapPrismaWorkspace);
  }

  async listMembershipsForWorkspace(workspaceId: string) {
    return (
      await this.runtime.client.workspaceMembership.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "asc" }
      })
    ).map(mapPrismaMembership);
  }

  async listMembershipsForUser(tenantId: string, userId: string) {
    return (
      await this.runtime.client.workspaceMembership.findMany({
        where: { tenantId, userId },
        orderBy: { createdAt: "asc" }
      })
    ).map(mapPrismaMembership);
  }

  async updateMembershipRoles(membershipId: string, roleIds: string[]) {
    const row = await this.runtime.client.workspaceMembership.update({
      where: { id: membershipId },
      data: { roleIds: [...new Set(roleIds)] }
    }).catch(() => undefined);
    return row ? mapPrismaMembership(row) : undefined;
  }

  async createRole(input: Omit<RoleRecord, "id">) {
    return mapPrismaRole(
      await this.runtime.client.role.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: input.tenantId,
          name: input.name,
          permissions: input.permissions,
          system: input.system ?? false,
          createdAt: new Date(input.createdAt ?? new Date().toISOString())
        }
      })
    );
  }

  async listRoles(tenantId: string) {
    return (
      await this.runtime.client.role.findMany({
        where: { tenantId },
        orderBy: [{ system: "desc" }, { name: "asc" }]
      })
    ).map(mapPrismaRole);
  }

  async createSession(input: Omit<AuthSessionRecord, "id" | "createdAt">) {
    return mapPrismaSession(
      await this.runtime.client.authSession.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: input.tenantId,
          userId: input.userId,
          workspaceIds: input.workspaceIds,
          roleIds: input.roleIds,
          permissions: input.permissions,
          subjectType: input.subjectType,
          accessTokenHash: input.accessTokenHash,
          refreshTokenHash: input.refreshTokenHash,
          accessExpiresAt: new Date(input.accessExpiresAt),
          refreshExpiresAt: new Date(input.refreshExpiresAt),
          createdAt: new Date(),
          lastUsedAt: input.lastUsedAt ? new Date(input.lastUsedAt) : null,
          revokedAt: input.revokedAt ? new Date(input.revokedAt) : null
        }
      })
    );
  }

  async findSessionByAccessHash(hash: string) {
    const row = await this.runtime.client.authSession.findUnique({
      where: { accessTokenHash: hash }
    });
    return row ? mapPrismaSession(row) : undefined;
  }

  async findSessionByRefreshHash(hash: string) {
    const row = await this.runtime.client.authSession.findUnique({
      where: { refreshTokenHash: hash }
    });
    return row ? mapPrismaSession(row) : undefined;
  }

  async touchSession(sessionId: string, timestamp: string) {
    const row = await this.runtime.client.authSession.update({
      where: { id: sessionId },
      data: { lastUsedAt: new Date(timestamp) }
    }).catch(() => undefined);
    return row ? mapPrismaSession(row) : undefined;
  }

  async revokeSession(sessionId: string, timestamp: string) {
    const row = await this.runtime.client.authSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date(timestamp) }
    }).catch(() => undefined);
    return row ? mapPrismaSession(row) : undefined;
  }
}

export class PrismaBillingRepository implements BillingRepository {
  constructor(private readonly runtime: PrismaRuntime) {}

  async getSubscription(workspaceId: string) {
    const row = await this.runtime.client.workspaceBillingSubscription.findUnique({
      where: { workspaceId }
    });
    return row ? mapPrismaBillingSubscription(row) : undefined;
  }

  async saveSubscription(subscription: WorkspaceBillingSubscriptionRecord) {
    return mapPrismaBillingSubscription(
      await this.runtime.client.workspaceBillingSubscription.upsert({
        where: { workspaceId: subscription.workspaceId },
        create: {
          workspaceId: subscription.workspaceId,
          tenantId: subscription.tenantId ?? null,
          planId: subscription.planId,
          stripeCustomerId: subscription.stripeCustomerId ?? null,
          stripeSubscriptionId: subscription.stripeSubscriptionId ?? null,
          createdAt: new Date(subscription.createdAt),
          updatedAt: new Date(subscription.updatedAt)
        },
        update: {
          tenantId: subscription.tenantId ?? null,
          planId: subscription.planId,
          stripeCustomerId: subscription.stripeCustomerId ?? null,
          stripeSubscriptionId: subscription.stripeSubscriptionId ?? null,
          createdAt: new Date(subscription.createdAt),
          updatedAt: new Date(subscription.updatedAt)
        }
      })
    );
  }

  async listUsageEvents(workspaceId: string, metric?: UsageEventRecord["metric"]) {
    return (
      await this.runtime.client.billingUsageEvent.findMany({
        where: {
          workspaceId,
          ...(metric ? { metric } : {})
        },
        orderBy: { timestamp: "desc" }
      })
    ).map(mapPrismaUsageEvent);
  }

  async saveUsageEvent(event: UsageEventRecord) {
    return mapPrismaUsageEvent(
      await this.runtime.client.billingUsageEvent.upsert({
        where: { id: event.id },
        create: {
          id: event.id,
          workspaceId: event.workspaceId,
          tenantId: event.tenantId ?? null,
          metric: event.metric,
          quantity: event.quantity,
          sourceService: event.sourceService,
          sourceEntityId: event.sourceEntityId,
          timestamp: new Date(event.timestamp),
          stripeSyncStatus: event.stripeSyncStatus,
          stripeError: event.stripeError ?? null,
          billable: event.billable,
          meteredAt: new Date(event.meteredAt),
          metadata: event.metadata
        },
        update: {
          workspaceId: event.workspaceId,
          tenantId: event.tenantId ?? null,
          metric: event.metric,
          quantity: event.quantity,
          sourceService: event.sourceService,
          sourceEntityId: event.sourceEntityId,
          timestamp: new Date(event.timestamp),
          stripeSyncStatus: event.stripeSyncStatus,
          stripeError: event.stripeError ?? null,
          billable: event.billable,
          meteredAt: new Date(event.meteredAt),
          metadata: event.metadata
        }
      })
    );
  }

  async updateUsageEventStripeStatus(eventId: string, status: StripeSyncStatus, error?: string) {
    const row = await this.runtime.client.billingUsageEvent.update({
      where: { id: eventId },
      data: {
        stripeSyncStatus: status,
        stripeError: error ?? null
      }
    }).catch(() => undefined);
    return row ? mapPrismaUsageEvent(row) : undefined;
  }

  async getQuotaOverride(workspaceId: string) {
    const row = await this.runtime.client.workspaceQuotaOverride.findUnique({
      where: { workspaceId }
    });
    return row ? mapPrismaQuotaOverride(row) : undefined;
  }

  async saveQuotaOverride(record: WorkspaceQuotaOverrideRecord) {
    return mapPrismaQuotaOverride(
      await this.runtime.client.workspaceQuotaOverride.upsert({
        where: { workspaceId: record.workspaceId },
        create: {
          workspaceId: record.workspaceId,
          tenantId: record.tenantId ?? null,
          limits: record.limits,
          reason: record.reason ?? null,
          updatedBy: record.updatedBy ?? null,
          createdAt: new Date(record.createdAt),
          updatedAt: new Date(record.updatedAt)
        },
        update: {
          tenantId: record.tenantId ?? null,
          limits: record.limits,
          reason: record.reason ?? null,
          updatedBy: record.updatedBy ?? null,
          createdAt: new Date(record.createdAt),
          updatedAt: new Date(record.updatedAt)
        }
      })
    );
  }
}

export class PrismaIntegrationRepository implements IntegrationRepository {
  constructor(private readonly runtime: PrismaRuntime) {}

  async save(record: ConnectedIntegrationRecord) {
    return mapPrismaIntegration(
      await this.runtime.client.connectedIntegration.upsert({
        where: {
          workspaceId_provider: {
            workspaceId: record.workspaceId,
            provider: record.provider
          }
        },
        create: {
          id: record.id,
          tenantId: record.tenantId ?? null,
          workspaceId: record.workspaceId,
          provider: record.provider,
          status: record.status,
          scopes: record.scopes,
          providerAccountId: record.providerAccountId ?? null,
          encryptedAccessToken: record.encryptedAccessToken ?? null,
          encryptedRefreshToken: record.encryptedRefreshToken ?? null,
          accessTokenExpiresAt: record.accessTokenExpiresAt
            ? new Date(record.accessTokenExpiresAt)
            : null,
          lastError: record.lastError ?? null,
          metadata: record.metadata,
          connectedAt: new Date(record.connectedAt),
          updatedAt: new Date(record.updatedAt)
        },
        update: {
          id: record.id,
          tenantId: record.tenantId ?? null,
          status: record.status,
          scopes: record.scopes,
          providerAccountId: record.providerAccountId ?? null,
          encryptedAccessToken: record.encryptedAccessToken ?? null,
          encryptedRefreshToken: record.encryptedRefreshToken ?? null,
          accessTokenExpiresAt: record.accessTokenExpiresAt
            ? new Date(record.accessTokenExpiresAt)
            : null,
          lastError: record.lastError ?? null,
          metadata: record.metadata,
          connectedAt: new Date(record.connectedAt),
          updatedAt: new Date(record.updatedAt)
        }
      })
    );
  }

  async get(workspaceId: string, provider: ConnectedIntegrationRecord["provider"]) {
    const row = await this.runtime.client.connectedIntegration.findUnique({
      where: {
        workspaceId_provider: {
          workspaceId,
          provider
        }
      }
    });
    return row ? mapPrismaIntegration(row) : undefined;
  }

  async list(workspaceId: string) {
    return (
      await this.runtime.client.connectedIntegration.findMany({
        where: { workspaceId },
        orderBy: { updatedAt: "desc" }
      })
    ).map(mapPrismaIntegration);
  }

  async delete(workspaceId: string, provider: ConnectedIntegrationRecord["provider"]) {
    const result = await this.runtime.client.connectedIntegration.deleteMany({
      where: { workspaceId, provider }
    });
    return result.count > 0;
  }
}

export class PrismaNotificationRepository implements NotificationRepository {
  constructor(private readonly runtime: PrismaRuntime) {}

  async save(record: NotificationRecord) {
    return mapPrismaNotification(
      await this.runtime.client.notification.upsert({
        where: { id: record.id },
        create: {
          id: record.id,
          tenantId: record.tenantId ?? null,
          workspaceId: record.workspaceId,
          userId: record.userId,
          channel: record.channel,
          eventType: record.eventType,
          target: record.target,
          subject: record.subject,
          body: record.body,
          status: record.status,
          mode: record.mode,
          metadata: record.metadata,
          createdAt: new Date(record.createdAt),
          sentAt: record.sentAt ? new Date(record.sentAt) : null,
          error: record.error ?? null
        },
        update: {
          tenantId: record.tenantId ?? null,
          workspaceId: record.workspaceId,
          userId: record.userId,
          channel: record.channel,
          eventType: record.eventType,
          target: record.target,
          subject: record.subject,
          body: record.body,
          status: record.status,
          mode: record.mode,
          metadata: record.metadata,
          createdAt: new Date(record.createdAt),
          sentAt: record.sentAt ? new Date(record.sentAt) : null,
          error: record.error ?? null
        }
      })
    );
  }

  async list(workspaceId: string, userId?: string) {
    return (
      await this.runtime.client.notification.findMany({
        where: {
          workspaceId,
          ...(userId ? { userId } : {})
        },
        orderBy: { createdAt: "desc" }
      })
    ).map(mapPrismaNotification);
  }
}

export class PrismaMissionRepository implements MissionRepository {
  constructor(private readonly runtime: PrismaRuntime) {}

  async save(record: MissionRecord) {
    await this.runtime.client.mission.upsert({
      where: { id: record.objective.id },
      create: {
        id: record.objective.id,
        tenantId: record.objective.tenantId ?? null,
        workspaceId: record.objective.workspaceId,
        userId: record.objective.userId,
        title: record.objective.title,
        objective: record.objective.objective,
        context: record.objective.context,
        desiredOutcome: record.objective.desiredOutcome ?? null,
        constraints: record.objective.constraints,
        requiredCapabilities: record.objective.requiredCapabilities,
        risk: record.objective.risk,
        status: record.status,
        planVersion: record.planVersion ?? 0,
        replanCount: record.replanCount ?? 0,
        rawRecord: record,
        createdAt: new Date(record.objective.createdAt),
        updatedAt: new Date(record.lastUpdatedAt)
      },
      update: {
        tenantId: record.objective.tenantId ?? null,
        workspaceId: record.objective.workspaceId,
        userId: record.objective.userId,
        title: record.objective.title,
        objective: record.objective.objective,
        context: record.objective.context,
        desiredOutcome: record.objective.desiredOutcome ?? null,
        constraints: record.objective.constraints,
        requiredCapabilities: record.objective.requiredCapabilities,
        risk: record.objective.risk,
        status: record.status,
        planVersion: record.planVersion ?? 0,
        replanCount: record.replanCount ?? 0,
        rawRecord: record,
        createdAt: new Date(record.objective.createdAt),
        updatedAt: new Date(record.lastUpdatedAt)
      }
    });

    return record;
  }

  async get(missionId: string) {
    const row = await this.runtime.client.mission.findUnique({
      where: { id: missionId },
      include: {
        approvals: { orderBy: { createdAt: "asc" } },
        transitions: { orderBy: { createdAt: "asc" } }
      }
    });
    if (!row) {
      return undefined;
    }

    return hydrateMissionRecord(
      row.rawRecord,
      row.approvals.map(mapPrismaApproval),
      row.transitions.map(mapPrismaMissionTransition)
    );
  }

  async list() {
    const rows = await this.runtime.client.mission.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        approvals: { orderBy: { createdAt: "asc" } },
        transitions: { orderBy: { createdAt: "asc" } }
      }
    });
    return rows
      .map((row: any) =>
        hydrateMissionRecord(
          row.rawRecord,
          row.approvals.map(mapPrismaApproval),
          row.transitions.map(mapPrismaMissionTransition)
        )
      )
      .filter((record: MissionRecord | undefined): record is MissionRecord => Boolean(record));
  }

  async saveApproval(approval: ApprovalRecord) {
    return mapPrismaApproval(
      await this.runtime.client.approval.upsert({
        where: { id: approval.id },
        create: {
          id: approval.id,
          missionId: approval.missionId,
          tenantId: approval.tenantId ?? null,
          workspaceId: approval.workspaceId,
          status: approval.status,
          reason: approval.reason,
          requiredActions: approval.requiredActions,
          approvedBy: approval.approvedBy ?? null,
          createdAt: new Date(approval.createdAt),
          updatedAt: new Date(approval.updatedAt)
        },
        update: {
          missionId: approval.missionId,
          tenantId: approval.tenantId ?? null,
          workspaceId: approval.workspaceId,
          status: approval.status,
          reason: approval.reason,
          requiredActions: approval.requiredActions,
          approvedBy: approval.approvedBy ?? null,
          createdAt: new Date(approval.createdAt),
          updatedAt: new Date(approval.updatedAt)
        }
      })
    );
  }

  async approve(
    missionId: string,
    approvalId: string,
    approverId: string,
    status: ApprovalRecord["status"]
  ) {
    const existing = await this.runtime.client.approval.findUnique({
      where: { id: approvalId }
    });
    if (!existing || existing.missionId !== missionId) {
      return undefined;
    }

    return mapPrismaApproval(
      await this.runtime.client.approval.update({
        where: { id: approvalId },
        data: {
          status,
          approvedBy: approverId,
          updatedAt: new Date()
        }
      })
    );
  }

  async appendTransition(transition: MissionStateTransition) {
    await this.runtime.client.missionTransition.upsert({
      where: { id: transition.id },
      create: {
        id: transition.id,
        missionId: transition.missionId,
        from: transition.from,
        to: transition.to,
        reason: transition.reason,
        actor: transition.actor,
        createdAt: new Date(transition.createdAt)
      },
      update: {
        missionId: transition.missionId,
        from: transition.from,
        to: transition.to,
        reason: transition.reason,
        actor: transition.actor,
        createdAt: new Date(transition.createdAt)
      }
    });
  }
}

export class PrismaAuditRepository implements AuditRepository {
  constructor(private readonly runtime: PrismaRuntime) {}

  async save(event: AuditEvent) {
    await this.runtime.client.auditEvent.upsert({
      where: { id: event.id },
      create: {
        id: event.id,
        kind: event.kind,
        entityId: event.entityId,
        actor: event.actor,
        details: event.details,
        createdAt: new Date(event.createdAt)
      },
      update: {
        kind: event.kind,
        entityId: event.entityId,
        actor: event.actor,
        details: event.details,
        createdAt: new Date(event.createdAt)
      }
    });
  }

  async list(entityId?: string) {
    return (
      await this.runtime.client.auditEvent.findMany({
        where: entityId ? { entityId } : {},
        orderBy: { createdAt: "asc" }
      })
    ).map(mapPrismaAuditEvent);
  }
}

export class PrismaHeartbeatRepository implements HeartbeatRepository {
  constructor(private readonly runtime: PrismaRuntime) {}

  async save(heartbeat: HeartbeatDefinition) {
    return mapPrismaHeartbeat(
      await this.runtime.client.heartbeat.upsert({
        where: { id: heartbeat.id },
        create: {
          id: heartbeat.id,
          tenantId: heartbeat.tenantId ?? null,
          workspaceId: heartbeat.workspaceId,
          name: heartbeat.name,
          schedule: heartbeat.schedule,
          objective: heartbeat.objective,
          active: heartbeat.active,
          lastRunAt: heartbeat.lastRunAt ? new Date(heartbeat.lastRunAt) : null,
          nextRunAt: heartbeat.nextRunAt ? new Date(heartbeat.nextRunAt) : null,
          lastScheduledAt: heartbeat.lastScheduledAt ? new Date(heartbeat.lastScheduledAt) : null,
          schedulerStatus: heartbeat.schedulerStatus ?? null,
          lastSchedulerError: heartbeat.lastSchedulerError ?? null
        },
        update: {
          tenantId: heartbeat.tenantId ?? null,
          workspaceId: heartbeat.workspaceId,
          name: heartbeat.name,
          schedule: heartbeat.schedule,
          objective: heartbeat.objective,
          active: heartbeat.active,
          lastRunAt: heartbeat.lastRunAt ? new Date(heartbeat.lastRunAt) : null,
          nextRunAt: heartbeat.nextRunAt ? new Date(heartbeat.nextRunAt) : null,
          lastScheduledAt: heartbeat.lastScheduledAt ? new Date(heartbeat.lastScheduledAt) : null,
          schedulerStatus: heartbeat.schedulerStatus ?? null,
          lastSchedulerError: heartbeat.lastSchedulerError ?? null
        }
      })
    );
  }

  async get(heartbeatId: string) {
    const row = await this.runtime.client.heartbeat.findUnique({
      where: { id: heartbeatId }
    });
    return row ? mapPrismaHeartbeat(row) : undefined;
  }

  async list() {
    return (
      await this.runtime.client.heartbeat.findMany({
        orderBy: { name: "asc" }
      })
    ).map(mapPrismaHeartbeat);
  }
}

export class PrismaHeartbeatExecutionRepository implements HeartbeatExecutionRepository {
  constructor(private readonly runtime: PrismaRuntime) {}

  async save(execution: HeartbeatExecutionRecord) {
    return mapPrismaHeartbeatExecution(
      await this.runtime.client.heartbeatExecution.upsert({
        where: { id: execution.id },
        create: {
          id: execution.id,
          heartbeatId: execution.heartbeatId,
          tenantId: execution.tenantId ?? null,
          workspaceId: execution.workspaceId,
          status: execution.status,
          triggerKind: execution.triggerKind,
          requestedBy: execution.requestedBy ?? null,
          summary: execution.summary,
          result: execution.result,
          createdAt: new Date(execution.createdAt),
          startedAt: execution.startedAt ? new Date(execution.startedAt) : null,
          finishedAt: execution.finishedAt ? new Date(execution.finishedAt) : null,
          error: execution.error ?? null
        },
        update: {
          heartbeatId: execution.heartbeatId,
          tenantId: execution.tenantId ?? null,
          workspaceId: execution.workspaceId,
          status: execution.status,
          triggerKind: execution.triggerKind,
          requestedBy: execution.requestedBy ?? null,
          summary: execution.summary,
          result: execution.result,
          createdAt: new Date(execution.createdAt),
          startedAt: execution.startedAt ? new Date(execution.startedAt) : null,
          finishedAt: execution.finishedAt ? new Date(execution.finishedAt) : null,
          error: execution.error ?? null
        }
      })
    );
  }

  async get(executionId: string) {
    const row = await this.runtime.client.heartbeatExecution.findUnique({
      where: { id: executionId }
    });
    return row ? mapPrismaHeartbeatExecution(row) : undefined;
  }

  async list(heartbeatId?: string) {
    return (
      await this.runtime.client.heartbeatExecution.findMany({
        where: heartbeatId ? { heartbeatId } : {},
        orderBy: { createdAt: "desc" }
      })
    ).map(mapPrismaHeartbeatExecution);
  }
}

class PostgresMissionRepository implements MissionRepository {
  constructor(private readonly runtime: PostgresRuntime) {}

  async save(record: MissionRecord) {
    await this.runtime.pool.query(
      `insert into missions
       (id, tenant_id, workspace_id, user_id, title, objective, context, desired_outcome, constraints, required_capabilities, risk, status, plan_version, replan_count, raw_record, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15::jsonb, $16, $17)
       on conflict (id) do update set
         tenant_id = excluded.tenant_id,
         workspace_id = excluded.workspace_id,
         user_id = excluded.user_id,
         title = excluded.title,
         objective = excluded.objective,
         context = excluded.context,
         desired_outcome = excluded.desired_outcome,
         constraints = excluded.constraints,
         required_capabilities = excluded.required_capabilities,
         risk = excluded.risk,
         status = excluded.status,
         plan_version = excluded.plan_version,
         replan_count = excluded.replan_count,
         raw_record = excluded.raw_record,
         updated_at = excluded.updated_at`,
      [
        record.objective.id,
        record.objective.tenantId ?? null,
        record.objective.workspaceId,
        record.objective.userId,
        record.objective.title,
        record.objective.objective,
        record.objective.context,
        record.objective.desiredOutcome ?? null,
        JSON.stringify(record.objective.constraints),
        JSON.stringify(record.objective.requiredCapabilities),
        record.objective.risk,
        record.status,
        record.planVersion ?? 0,
        record.replanCount ?? 0,
        JSON.stringify(record),
        record.objective.createdAt,
        record.lastUpdatedAt
      ]
    );

    return record;
  }

  async get(missionId: string) {
    const result = await this.runtime.pool.query<RawMissionRow>(
      "select raw_record from missions where id = $1 limit 1",
      [missionId]
    );
    return result.rows[0]?.raw_record as MissionRecord | undefined;
  }

  async list() {
    const result = await this.runtime.pool.query<RawMissionRow>(
      "select raw_record from missions order by updated_at desc"
    );
    return result.rows.map((row) => row.raw_record);
  }

  async saveApproval(approval: ApprovalRecord) {
    await this.runtime.pool.query(
      "insert into approvals (id, mission_id, tenant_id, workspace_id, status, reason, required_actions, approved_by, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)",
      [approval.id, approval.missionId, approval.tenantId ?? null, approval.workspaceId, approval.status, approval.reason, JSON.stringify(approval.requiredActions), approval.approvedBy ?? null, approval.createdAt, approval.updatedAt]
    );
    return approval;
  }

  async approve(missionId: string, approvalId: string, approverId: string, status: ApprovalRecord["status"]) {
    const updatedAt = new Date().toISOString();
    const result = await this.runtime.pool.query<ApprovalRow>(
      "update approvals set status = $1, approved_by = $2, updated_at = $3 where mission_id = $4 and id = $5 returning *",
      [status, approverId, updatedAt, missionId, approvalId]
    );
    if (!result.rows[0]) {
      return undefined;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      missionId: row.mission_id,
      tenantId: row.tenant_id ?? undefined,
      workspaceId: row.workspace_id,
      status: row.status,
      reason: row.reason,
      requiredActions: row.required_actions ?? [],
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      approvedBy: row.approved_by ?? undefined
    };
  }

  async appendTransition(transition: MissionStateTransition) {
    await this.runtime.pool.query(
      "insert into mission_transitions (id, mission_id, from_status, to_status, reason, actor, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
      [transition.id, transition.missionId, transition.from, transition.to, transition.reason, transition.actor, transition.createdAt]
    );
  }
}

class PostgresMemoryRepository implements MemoryRepository {
  constructor(private readonly runtime: PostgresRuntime) {}

  async save(workspaceId: string, records: MemoryRecord[]) {
    await this.runtime.pool.query("delete from memory_records where workspace_id = $1", [workspaceId]);
    for (const record of records) {
      await this.runtime.pool.query(
        `insert into memory_records
         (id, workspace_id, scope, text, tags, importance, content_hash, embedding, embedding_model, embedding_updated_at, created_at)
         values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::vector, $9, $10, $11)`,
        [
          record.id,
          record.workspaceId,
          record.scope,
          record.text,
          JSON.stringify(record.tags),
          record.importance ?? null,
          record.contentHash,
          serializeVector(record.embedding),
          record.embeddingModel ?? null,
          record.embeddingUpdatedAt ?? null,
          record.createdAt
        ]
      );
    }
  }

  async list(workspaceId: string) {
    const result = await this.runtime.pool.query<MemoryRow>(
      "select * from memory_records where workspace_id = $1 order by created_at asc",
      [workspaceId]
    );

    return result.rows.map(mapMemoryRow);
  }

  async search(workspaceId: string, embedding: number[], limit = 8) {
    const result = await this.runtime.pool.query<
      MemoryRow & {
        similarity: number;
      }
    >(
      `select *,
              1 - (embedding <=> $2::vector) as similarity
         from memory_records
        where workspace_id = $1
          and embedding is not null
        order by embedding <=> $2::vector asc
        limit $3`,
      [workspaceId, serializeVector(embedding), limit]
    );

    return result.rows.map((row) => ({
      record: mapMemoryRow(row),
      similarity: row.similarity
    }));
  }
}

class PostgresAuditRepository implements AuditRepository {
  constructor(private readonly runtime: PostgresRuntime) {}

  async save(event: AuditEvent) {
    await this.runtime.pool.query(
      "insert into audit_events (id, kind, entity_id, actor, details, created_at) values ($1, $2, $3, $4, $5::jsonb, $6)",
      [event.id, event.kind, event.entityId, event.actor, JSON.stringify(event.details), event.createdAt]
    );
  }

  async list(entityId?: string) {
    const result = entityId
      ? await this.runtime.pool.query<AuditRow>(
          "select * from audit_events where entity_id = $1 order by created_at asc",
          [entityId]
        )
      : await this.runtime.pool.query<AuditRow>(
          "select * from audit_events order by created_at asc"
        );

    return result.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      entityId: row.entity_id,
      actor: row.actor,
      details: row.details ?? {},
      createdAt: row.created_at.toISOString()
    }));
  }
}

class PostgresHeartbeatRepository implements HeartbeatRepository {
  constructor(private readonly runtime: PostgresRuntime) {}

  async save(heartbeat: HeartbeatDefinition) {
    await this.runtime.pool.query(
      `insert into heartbeats
       (id, tenant_id, workspace_id, name, schedule, objective, active, last_run_at, next_run_at, last_scheduled_at, scheduler_status, last_scheduler_error)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       on conflict (id) do update set
         tenant_id = excluded.tenant_id,
         workspace_id = excluded.workspace_id,
         name = excluded.name,
         schedule = excluded.schedule,
         objective = excluded.objective,
         active = excluded.active,
         last_run_at = excluded.last_run_at,
         next_run_at = excluded.next_run_at,
         last_scheduled_at = excluded.last_scheduled_at,
         scheduler_status = excluded.scheduler_status,
         last_scheduler_error = excluded.last_scheduler_error`,
      [
        heartbeat.id,
        heartbeat.tenantId ?? null,
        heartbeat.workspaceId,
        heartbeat.name,
        heartbeat.schedule,
        heartbeat.objective,
        heartbeat.active,
        heartbeat.lastRunAt ?? null,
        heartbeat.nextRunAt ?? null,
        heartbeat.lastScheduledAt ?? null,
        heartbeat.schedulerStatus ?? null,
        heartbeat.lastSchedulerError ?? null
      ]
    );
    return heartbeat;
  }

  async get(heartbeatId: string) {
    const result = await this.runtime.pool.query<HeartbeatRow>(
      "select * from heartbeats where id = $1 limit 1",
      [heartbeatId]
    );
    const row = result.rows[0];
    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      tenantId: row.tenant_id ?? undefined,
      workspaceId: row.workspace_id,
      name: row.name,
      schedule: row.schedule,
      objective: row.objective,
      active: row.active,
      lastRunAt: row.last_run_at ? row.last_run_at.toISOString() : undefined,
      nextRunAt: row.next_run_at ? row.next_run_at.toISOString() : undefined,
      lastScheduledAt: row.last_scheduled_at ? row.last_scheduled_at.toISOString() : undefined,
      schedulerStatus: row.scheduler_status ?? undefined,
      lastSchedulerError: row.last_scheduler_error ?? undefined
    };
  }

  async list() {
    const result = await this.runtime.pool.query<HeartbeatRow>(
      "select * from heartbeats order by name asc"
    );
    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id ?? undefined,
      workspaceId: row.workspace_id,
      name: row.name,
      schedule: row.schedule,
      objective: row.objective,
      active: row.active,
      lastRunAt: row.last_run_at ? row.last_run_at.toISOString() : undefined,
      nextRunAt: row.next_run_at ? row.next_run_at.toISOString() : undefined,
      lastScheduledAt: row.last_scheduled_at ? row.last_scheduled_at.toISOString() : undefined,
      schedulerStatus: row.scheduler_status ?? undefined,
      lastSchedulerError: row.last_scheduler_error ?? undefined
    }));
  }
}

class PostgresHeartbeatExecutionRepository implements HeartbeatExecutionRepository {
  constructor(private readonly runtime: PostgresRuntime) {}

  async save(execution: HeartbeatExecutionRecord) {
    await this.runtime.pool.query(
      `insert into heartbeat_executions
       (id, heartbeat_id, tenant_id, workspace_id, status, trigger_kind, requested_by, summary, result, created_at, started_at, finished_at, error)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)
       on conflict (id) do update set
         heartbeat_id = excluded.heartbeat_id,
         tenant_id = excluded.tenant_id,
         workspace_id = excluded.workspace_id,
         status = excluded.status,
         trigger_kind = excluded.trigger_kind,
         requested_by = excluded.requested_by,
         summary = excluded.summary,
         result = excluded.result,
         created_at = excluded.created_at,
         started_at = excluded.started_at,
         finished_at = excluded.finished_at,
         error = excluded.error`,
      [
        execution.id,
        execution.heartbeatId,
        execution.tenantId ?? null,
        execution.workspaceId,
        execution.status,
        execution.triggerKind,
        execution.requestedBy ?? null,
        execution.summary,
        JSON.stringify(execution.result),
        execution.createdAt,
        execution.startedAt ?? null,
        execution.finishedAt ?? null,
        execution.error ?? null
      ]
    );

    return execution;
  }

  async get(executionId: string) {
    const result = await this.runtime.pool.query<HeartbeatExecutionRow>(
      "select * from heartbeat_executions where id = $1 limit 1",
      [executionId]
    );
    return result.rows[0] ? mapHeartbeatExecutionRow(result.rows[0]) : undefined;
  }

  async list(heartbeatId?: string) {
    const result = heartbeatId
      ? await this.runtime.pool.query<HeartbeatExecutionRow>(
          "select * from heartbeat_executions where heartbeat_id = $1 order by created_at desc",
          [heartbeatId]
        )
      : await this.runtime.pool.query<HeartbeatExecutionRow>(
          "select * from heartbeat_executions order by created_at desc"
        );

    return result.rows.map(mapHeartbeatExecutionRow);
  }
}

class PostgresKnowledgeRepository implements KnowledgeRepository {
  constructor(private readonly runtime: PostgresRuntime) {}

  async save(document: KnowledgeDocumentRecord) {
    await this.runtime.pool.query(
      `insert into knowledge_documents
       (id, workspace_id, title, body, metadata, content_hash, excerpt, embedding, embedding_model, embedding_updated_at, created_at)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::vector, $9, $10, $11)
       on conflict (id) do update set
         workspace_id = excluded.workspace_id,
         title = excluded.title,
         body = excluded.body,
         metadata = excluded.metadata,
         content_hash = excluded.content_hash,
         excerpt = excluded.excerpt,
         embedding = excluded.embedding,
         embedding_model = excluded.embedding_model,
         embedding_updated_at = excluded.embedding_updated_at`,
      [
        document.id,
        document.workspaceId,
        document.title,
        document.body,
        JSON.stringify(document.metadata),
        document.contentHash,
        document.excerpt,
        serializeVector(document.embedding),
        document.embeddingModel ?? null,
        document.embeddingUpdatedAt ?? null,
        document.createdAt
      ]
    );

    return document;
  }

  async list(workspaceId: string) {
    const result = await this.runtime.pool.query<KnowledgeRow>(
      "select * from knowledge_documents where workspace_id = $1 order by created_at desc",
      [workspaceId]
    );

    return result.rows.map(mapKnowledgeRow);
  }

  async search(workspaceId: string, embedding: number[], limit = 8) {
    const result = await this.runtime.pool.query<
      KnowledgeRow & {
        similarity: number;
      }
    >(
      `select *,
              1 - (embedding <=> $2::vector) as similarity
         from knowledge_documents
        where workspace_id = $1
          and embedding is not null
        order by embedding <=> $2::vector asc
        limit $3`,
      [workspaceId, serializeVector(embedding), limit]
    );

    return result.rows.map((row) => ({
      document: mapKnowledgeRow(row),
      similarity: row.similarity
    }));
  }
}

class PostgresBillingRepository implements BillingRepository {
  constructor(private readonly runtime: PostgresRuntime) {}

  async getSubscription(workspaceId: string) {
    const result = await this.runtime.pool.query<BillingSubscriptionRow>(
      "select * from workspace_billing_subscriptions where workspace_id = $1 limit 1",
      [workspaceId]
    );
    return result.rows[0] ? mapBillingSubscriptionRow(result.rows[0]) : undefined;
  }

  async saveSubscription(subscription: WorkspaceBillingSubscriptionRecord) {
    const result = await this.runtime.pool.query<BillingSubscriptionRow>(
      `insert into workspace_billing_subscriptions
       (workspace_id, tenant_id, plan_id, stripe_customer_id, stripe_subscription_id, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (workspace_id) do update set
         tenant_id = excluded.tenant_id,
         plan_id = excluded.plan_id,
         stripe_customer_id = excluded.stripe_customer_id,
         stripe_subscription_id = excluded.stripe_subscription_id,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at
       returning *`,
      [
        subscription.workspaceId,
        subscription.tenantId ?? null,
        subscription.planId,
        subscription.stripeCustomerId ?? null,
        subscription.stripeSubscriptionId ?? null,
        subscription.createdAt,
        subscription.updatedAt
      ]
    );
    return mapBillingSubscriptionRow(result.rows[0]);
  }

  async listUsageEvents(workspaceId: string, metric?: UsageEventRecord["metric"]) {
    const result = metric
      ? await this.runtime.pool.query<UsageEventRow>(
          "select * from billing_usage_events where workspace_id = $1 and metric = $2 order by timestamp desc",
          [workspaceId, metric]
        )
      : await this.runtime.pool.query<UsageEventRow>(
          "select * from billing_usage_events where workspace_id = $1 order by timestamp desc",
          [workspaceId]
        );

    return result.rows.map(mapUsageEventRow);
  }

  async saveUsageEvent(event: UsageEventRecord) {
    const result = await this.runtime.pool.query<UsageEventRow>(
      `insert into billing_usage_events
       (id, workspace_id, tenant_id, metric, quantity, source_service, source_entity_id, timestamp, stripe_sync_status, stripe_error, billable, metered_at, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
       on conflict (id) do update set
         workspace_id = excluded.workspace_id,
         tenant_id = excluded.tenant_id,
         metric = excluded.metric,
         quantity = excluded.quantity,
         source_service = excluded.source_service,
         source_entity_id = excluded.source_entity_id,
         timestamp = excluded.timestamp,
         stripe_sync_status = excluded.stripe_sync_status,
         stripe_error = excluded.stripe_error,
         billable = excluded.billable,
         metered_at = excluded.metered_at,
         metadata = excluded.metadata
       returning *`,
      [
        event.id,
        event.workspaceId,
        event.tenantId ?? null,
        event.metric,
        event.quantity,
        event.sourceService,
        event.sourceEntityId,
        event.timestamp,
        event.stripeSyncStatus,
        event.stripeError ?? null,
        event.billable,
        event.meteredAt,
        JSON.stringify(event.metadata)
      ]
    );
    return mapUsageEventRow(result.rows[0]);
  }

  async updateUsageEventStripeStatus(
    eventId: string,
    status: StripeSyncStatus,
    error?: string | undefined
  ) {
    const result = await this.runtime.pool.query<UsageEventRow>(
      "update billing_usage_events set stripe_sync_status = $1, stripe_error = $2 where id = $3 returning *",
      [status, error ?? null, eventId]
    );
    return result.rows[0] ? mapUsageEventRow(result.rows[0]) : undefined;
  }

  async getQuotaOverride(workspaceId: string) {
    const result = await this.runtime.pool.query<QuotaOverrideRow>(
      "select * from workspace_quota_overrides where workspace_id = $1 limit 1",
      [workspaceId]
    );
    return result.rows[0] ? mapQuotaOverrideRow(result.rows[0]) : undefined;
  }

  async saveQuotaOverride(record: WorkspaceQuotaOverrideRecord) {
    const result = await this.runtime.pool.query<QuotaOverrideRow>(
      `insert into workspace_quota_overrides
       (workspace_id, tenant_id, limits, reason, updated_by, created_at, updated_at)
       values ($1, $2, $3::jsonb, $4, $5, $6, $7)
       on conflict (workspace_id) do update set
         tenant_id = excluded.tenant_id,
         limits = excluded.limits,
         reason = excluded.reason,
         updated_by = excluded.updated_by,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at
       returning *`,
      [
        record.workspaceId,
        record.tenantId ?? null,
        JSON.stringify(record.limits),
        record.reason ?? null,
        record.updatedBy ?? null,
        record.createdAt,
        record.updatedAt
      ]
    );
    return mapQuotaOverrideRow(result.rows[0]);
  }
}

class PostgresIntegrationRepository implements IntegrationRepository {
  constructor(private readonly runtime: PostgresRuntime) {}

  async save(record: ConnectedIntegrationRecord) {
    const result = await this.runtime.pool.query<IntegrationRow>(
      `insert into connected_integrations
       (id, tenant_id, workspace_id, provider, status, scopes, provider_account_id, encrypted_access_token, encrypted_refresh_token, access_token_expires_at, last_error, metadata, connected_at, updated_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)
       on conflict (workspace_id, provider) do update set
         id = excluded.id,
         tenant_id = excluded.tenant_id,
         status = excluded.status,
         scopes = excluded.scopes,
         provider_account_id = excluded.provider_account_id,
         encrypted_access_token = excluded.encrypted_access_token,
         encrypted_refresh_token = excluded.encrypted_refresh_token,
         access_token_expires_at = excluded.access_token_expires_at,
         last_error = excluded.last_error,
         metadata = excluded.metadata,
         connected_at = excluded.connected_at,
         updated_at = excluded.updated_at
       returning *`,
      [
        record.id,
        record.tenantId ?? null,
        record.workspaceId,
        record.provider,
        record.status,
        JSON.stringify(record.scopes),
        record.providerAccountId ?? null,
        record.encryptedAccessToken ?? null,
        record.encryptedRefreshToken ?? null,
        record.accessTokenExpiresAt ?? null,
        record.lastError ?? null,
        JSON.stringify(record.metadata),
        record.connectedAt,
        record.updatedAt
      ]
    );
    return mapIntegrationRow(result.rows[0]);
  }

  async get(workspaceId: string, provider: ConnectedIntegrationRecord["provider"]) {
    const result = await this.runtime.pool.query<IntegrationRow>(
      "select * from connected_integrations where workspace_id = $1 and provider = $2 limit 1",
      [workspaceId, provider]
    );
    return result.rows[0] ? mapIntegrationRow(result.rows[0]) : undefined;
  }

  async list(workspaceId: string) {
    const result = await this.runtime.pool.query<IntegrationRow>(
      "select * from connected_integrations where workspace_id = $1 order by updated_at desc",
      [workspaceId]
    );
    return result.rows.map(mapIntegrationRow);
  }

  async delete(workspaceId: string, provider: ConnectedIntegrationRecord["provider"]) {
    const result = await this.runtime.pool.query(
      "delete from connected_integrations where workspace_id = $1 and provider = $2",
      [workspaceId, provider]
    );
    return (result.rowCount ?? 0) > 0;
  }
}

class PostgresNotificationRepository implements NotificationRepository {
  constructor(private readonly runtime: PostgresRuntime) {}

  async save(record: NotificationRecord) {
    const result = await this.runtime.pool.query<NotificationRow>(
      `insert into notifications
       (id, tenant_id, workspace_id, user_id, channel, event_type, target, subject, body, status, mode, metadata, created_at, sent_at, error)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15)
       on conflict (id) do update set
         tenant_id = excluded.tenant_id,
         workspace_id = excluded.workspace_id,
         user_id = excluded.user_id,
         channel = excluded.channel,
         event_type = excluded.event_type,
         target = excluded.target,
         subject = excluded.subject,
         body = excluded.body,
         status = excluded.status,
         mode = excluded.mode,
         metadata = excluded.metadata,
         created_at = excluded.created_at,
         sent_at = excluded.sent_at,
         error = excluded.error
       returning *`,
      [
        record.id,
        record.tenantId ?? null,
        record.workspaceId,
        record.userId,
        record.channel,
        record.eventType,
        record.target,
        record.subject,
        record.body,
        record.status,
        record.mode,
        JSON.stringify(record.metadata),
        record.createdAt,
        record.sentAt ?? null,
        record.error ?? null
      ]
    );
    return mapNotificationRow(result.rows[0]);
  }

  async list(workspaceId: string, userId?: string) {
    const result = userId
      ? await this.runtime.pool.query<NotificationRow>(
          "select * from notifications where workspace_id = $1 and user_id = $2 order by created_at desc",
          [workspaceId, userId]
        )
      : await this.runtime.pool.query<NotificationRow>(
          "select * from notifications where workspace_id = $1 order by created_at desc",
          [workspaceId]
        );
    return result.rows.map(mapNotificationRow);
  }
}

const mapHeartbeatExecutionRow = (
  row: HeartbeatExecutionRow
): HeartbeatExecutionRecord => ({
  id: row.id,
  heartbeatId: row.heartbeat_id,
  tenantId: row.tenant_id ?? undefined,
  workspaceId: row.workspace_id,
  status: row.status,
  triggerKind: row.trigger_kind,
  requestedBy: row.requested_by ?? undefined,
  summary: row.summary,
  result: row.result ?? {},
  createdAt: row.created_at.toISOString(),
  startedAt: row.started_at ? row.started_at.toISOString() : undefined,
  finishedAt: row.finished_at ? row.finished_at.toISOString() : undefined,
  error: row.error ?? undefined
});

export interface PersistenceBundle {
  mode: RepositoryMode;
  identity: IdentityRepository;
  missions: MissionRepository;
  memory: MemoryRepository;
  audit: AuditRepository;
  heartbeats: HeartbeatRepository;
  heartbeatExecutions: HeartbeatExecutionRepository;
  knowledge: KnowledgeRepository;
  billing: BillingRepository;
  integrations: IntegrationRepository;
  notifications: NotificationRepository;
}

export const createPersistenceBundle = (): PersistenceBundle => {
  const config = loadPlatformConfig();
  const usePostgres = config.persistenceMode === "postgres" && Boolean(config.postgresUrl);
  if (!usePostgres || !config.postgresUrl) {
    return {
      mode: "local",
      identity: new LocalIdentityRepository(),
      missions: new LocalMissionRepository(),
      memory: new LocalMemoryRepository(),
      audit: new LocalAuditRepository(),
      heartbeats: new LocalHeartbeatRepository(),
      heartbeatExecutions: new LocalHeartbeatExecutionRepository(),
        knowledge: new LocalKnowledgeRepository(),
        billing: new LocalBillingRepository(),
        integrations: new LocalIntegrationRepository(),
        notifications: new LocalNotificationRepository()
      };
  }

  const runtime = new PostgresRuntime(config.postgresUrl);
  const prismaRuntime = new PrismaRuntime();
  return {
    mode: "postgres",
    identity: new PrismaIdentityRepository(prismaRuntime),
    missions: new PrismaMissionRepository(prismaRuntime),
    memory: new PrismaMemoryRepository(prismaRuntime),
    audit: new PrismaAuditRepository(prismaRuntime),
    heartbeats: new PrismaHeartbeatRepository(prismaRuntime),
    heartbeatExecutions: new PrismaHeartbeatExecutionRepository(prismaRuntime),
    knowledge: new PrismaKnowledgeRepository(prismaRuntime),
    billing: new PrismaBillingRepository(prismaRuntime),
    integrations: new PrismaIntegrationRepository(prismaRuntime),
    notifications: new PrismaNotificationRepository(prismaRuntime)
  };
};

export class PrismaMemoryRepository implements MemoryRepository {
  constructor(private readonly runtime: PrismaRuntime) {}

  async save(workspaceId: string, records: MemoryRecord[]) {
    await this.runtime.client.$transaction(
      records.map((record) =>
        this.runtime.client.memoryRecord.upsert({
          where: { id: record.id },
          update: {
            text: record.text,
            tags: record.tags,
            importance: record.importance,
            contentHash: record.contentHash,
            createdAt: new Date(record.createdAt)
          },
          create: {
            id: record.id,
            workspaceId: record.workspaceId,
            scope: record.scope,
            text: record.text,
            tags: record.tags,
            importance: record.importance,
            contentHash: record.contentHash,
            createdAt: new Date(record.createdAt)
          }
        })
      )
    );
  }

  async list(workspaceId: string) {
    const rows = await this.runtime.client.memoryRecord.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" }
    });
    return rows.map((row: any) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      scope: row.scope,
      text: row.text,
      tags: row.tags as string[],
      importance: row.importance ?? undefined,
      contentHash: row.contentHash,
      createdAt: row.createdAt.toISOString()
    }));
  }

  async search(workspaceId: string, embedding: number[], limit = 10) {
    // Vector search still requires raw SQL for now due to Prisma limitations with pgvector
    const vectorStr = `[${embedding.join(",")}]`;
    const rows = await this.runtime.client.$queryRawUnsafe(
      `SELECT id, workspace_id as "workspaceId", scope, text, tags, importance, content_hash as "contentHash", created_at as "createdAt",
       (embedding <=> $1::vector) as similarity
       FROM memory_records
       WHERE workspace_id = $2
       ORDER BY similarity ASC
       LIMIT $3`,
      vectorStr,
      workspaceId,
      limit
    );

    return (rows as any[]).map((row) => ({
      record: {
        id: row.id,
        workspaceId: row.workspaceId,
        scope: row.scope,
        text: row.text,
        tags: row.tags,
        importance: row.importance ?? undefined,
        contentHash: row.contentHash,
        createdAt: row.createdAt.toISOString()
      },
      similarity: 1 - row.similarity
    }));
  }
}

export class PrismaKnowledgeRepository implements KnowledgeRepository {
  constructor(private readonly runtime: PrismaRuntime) {}

  async save(record: KnowledgeDocumentRecord) {
    const row = await this.runtime.client.knowledgeDocument.upsert({
      where: { id: record.id },
      update: {
        title: record.title,
        body: record.body,
        metadata: record.metadata,
        contentHash: record.contentHash,
        excerpt: record.excerpt,
        createdAt: new Date(record.createdAt)
      },
      create: {
        id: record.id,
        workspaceId: record.workspaceId,
        title: record.title,
        body: record.body,
        metadata: record.metadata,
        contentHash: record.contentHash,
        excerpt: record.excerpt,
        createdAt: new Date(record.createdAt)
      }
    });
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      title: row.title,
      body: row.body,
      metadata: row.metadata as Record<string, any>,
      contentHash: row.contentHash,
      excerpt: row.excerpt,
      createdAt: row.createdAt.toISOString()
    };
  }

  async list(workspaceId: string) {
    const rows = await this.runtime.client.knowledgeDocument.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" }
    });
    return rows.map((row: any) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      title: row.title,
      body: row.body,
      metadata: row.metadata as Record<string, any>,
      contentHash: row.contentHash,
      excerpt: row.excerpt,
      createdAt: row.createdAt.toISOString()
    }));
  }

  async search(workspaceId: string, embedding: number[], limit = 10) {
    const vectorStr = `[${embedding.join(",")}]`;
    const rows = await this.runtime.client.$queryRawUnsafe(
      `SELECT id, workspace_id as "workspaceId", title, body, metadata, content_hash as "contentHash", excerpt, created_at as "createdAt",
       (embedding <=> $1::vector) as similarity
       FROM knowledge_documents
       WHERE workspace_id = $2
       ORDER BY similarity ASC
       LIMIT $3`,
      vectorStr,
      workspaceId,
      limit
    );

    return (rows as any[]).map((row) => ({
      document: {
        id: row.id,
        workspaceId: row.workspaceId,
        title: row.title,
        body: row.body,
        metadata: row.metadata as Record<string, any>,
        contentHash: row.contentHash,
        excerpt: row.excerpt,
        createdAt: row.createdAt.toISOString()
      },
      similarity: 1 - row.similarity
    }));
  }
}
