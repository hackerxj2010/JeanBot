import { describe, expect, it } from "vitest";

import {
  PrismaAuditRepository,
  PrismaBillingRepository,
  PrismaHeartbeatExecutionRepository,
  PrismaHeartbeatRepository,
  PrismaIdentityRepository,
  PrismaIntegrationRepository,
  PrismaMissionRepository,
  PrismaNotificationRepository
} from "../../packages/persistence/src/index.js";

const now = () => new Date("2026-03-13T12:00:00.000Z");

const createPrismaStub = () => {
  const state = {
    tenants: [] as any[],
    users: [] as any[],
    workspaces: [] as any[],
    memberships: [] as any[],
    apiKeys: [] as any[],
    roles: [] as any[],
    sessions: [] as any[],
    missions: [] as any[],
    approvals: [] as any[],
    transitions: [] as any[],
    auditEvents: [] as any[],
    heartbeats: [] as any[],
    heartbeatExecutions: [] as any[],
    subscriptions: [] as any[],
    usageEvents: [] as any[],
    quotaOverrides: [] as any[],
    integrations: [] as any[],
    notifications: [] as any[]
  };

  return {
    state,
    tenant: {
      create: async ({ data }: any) => {
        const row = { ...data, createdAt: data.createdAt ?? now() };
        state.tenants.push(row);
        return row;
      },
      findMany: async () => [...state.tenants].sort((a, b) => a.createdAt - b.createdAt),
      findUnique: async ({ where }: any) =>
        state.tenants.find((row) => row.id === where.id || row.slug === where.slug) ?? null
    },
    user: {
      create: async ({ data }: any) => {
        const row = { ...data, createdAt: data.createdAt ?? now() };
        state.users.push(row);
        return row;
      },
      findUnique: async ({ where }: any) =>
        state.users.find((row) => row.id === where.id) ?? null,
      findMany: async ({ where }: any = {}) =>
        state.users.filter((row) => (where?.tenantId ? row.tenantId === where.tenantId : true))
    },
    workspace: {
      create: async ({ data }: any) => {
        const row = { ...data, createdAt: data.createdAt ?? now() };
        state.workspaces.push(row);
        return row;
      },
      findMany: async ({ where }: any = {}) =>
        state.workspaces.filter((row) => {
          if (where?.tenantId && row.tenantId !== where.tenantId) {
            return false;
          }
          if (where?.id?.in && !where.id.in.includes(row.id)) {
            return false;
          }
          return true;
        }),
      findFirst: async ({ where }: any) =>
        state.workspaces.find(
          (row) => row.tenantId === where.tenantId && row.slug === where.slug
        ) ?? null
    },
    workspaceMembership: {
      create: async ({ data }: any) => {
        const row = { ...data, createdAt: data.createdAt ?? now() };
        state.memberships.push(row);
        return row;
      },
      findMany: async ({ where }: any = {}) =>
        state.memberships.filter((row) => {
          if (where?.tenantId && row.tenantId !== where.tenantId) {
            return false;
          }
          if (where?.workspaceId && row.workspaceId !== where.workspaceId) {
            return false;
          }
          if (where?.userId && row.userId !== where.userId) {
            return false;
          }
          return true;
        }),
      update: async ({ where, data }: any) => {
        const row = state.memberships.find((entry) => entry.id === where.id);
        if (!row) {
          throw new Error("missing membership");
        }
        Object.assign(row, data);
        return row;
      }
    },
    apiKey: {
      create: async ({ data }: any) => {
        const row = { ...data, createdAt: data.createdAt ?? now(), lastUsedAt: data.lastUsedAt ?? null };
        state.apiKeys.push(row);
        return row;
      },
      findMany: async ({ where }: any = {}) =>
        state.apiKeys.filter((row) => (where?.tenantId ? row.tenantId === where.tenantId : true)),
      findUnique: async ({ where }: any) =>
        state.apiKeys.find((row) => row.hashedKey === where.hashedKey) ?? null
    },
    role: {
      create: async ({ data }: any) => {
        const row = { ...data, createdAt: data.createdAt ?? now() };
        state.roles.push(row);
        return row;
      },
      findMany: async ({ where }: any = {}) =>
        state.roles.filter((row) => (where?.tenantId ? row.tenantId === where.tenantId : true))
    },
    authSession: {
      create: async ({ data }: any) => {
        const row = { ...data, createdAt: data.createdAt ?? now() };
        state.sessions.push(row);
        return row;
      },
      findUnique: async ({ where }: any) =>
        state.sessions.find(
          (row) =>
            row.id === where.id ||
            row.accessTokenHash === where.accessTokenHash ||
            row.refreshTokenHash === where.refreshTokenHash
        ) ?? null,
      update: async ({ where, data }: any) => {
        const row = state.sessions.find((entry) => entry.id === where.id);
        if (!row) {
          throw new Error("missing session");
        }
        Object.assign(row, data);
        return row;
      }
    },
    mission: {
      upsert: async ({ where, create, update }: any) => {
        const existing = state.missions.find((row) => row.id === where.id);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        state.missions.push(create);
        return create;
      },
      findUnique: async ({ where }: any) => {
        const mission = state.missions.find((row) => row.id === where.id);
        if (!mission) {
          return null;
        }
        return {
          ...mission,
          approvals: state.approvals.filter((row) => row.missionId === mission.id),
          transitions: state.transitions.filter((row) => row.missionId === mission.id)
        };
      },
      findMany: async () =>
        [...state.missions].map((mission) => ({
          ...mission,
          approvals: state.approvals.filter((row) => row.missionId === mission.id),
          transitions: state.transitions.filter((row) => row.missionId === mission.id)
        }))
    },
    approval: {
      upsert: async ({ where, create, update }: any) => {
        const existing = state.approvals.find((row) => row.id === where.id);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        state.approvals.push(create);
        return create;
      },
      findUnique: async ({ where }: any) =>
        state.approvals.find((row) => row.id === where.id) ?? null,
      update: async ({ where, data }: any) => {
        const existing = state.approvals.find((row) => row.id === where.id);
        if (!existing) {
          throw new Error("missing approval");
        }
        Object.assign(existing, data);
        return existing;
      }
    },
    missionTransition: {
      upsert: async ({ where, create, update }: any) => {
        const existing = state.transitions.find((row) => row.id === where.id);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        state.transitions.push(create);
        return create;
      }
    },
    auditEvent: {
      upsert: async ({ where, create, update }: any) => {
        const existing = state.auditEvents.find((row) => row.id === where.id);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        state.auditEvents.push(create);
        return create;
      },
      findMany: async ({ where }: any = {}) =>
        state.auditEvents.filter((row) => (where?.entityId ? row.entityId === where.entityId : true))
    },
    heartbeat: {
      upsert: async ({ where, create, update }: any) => {
        const existing = state.heartbeats.find((row) => row.id === where.id);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        state.heartbeats.push(create);
        return create;
      },
      findUnique: async ({ where }: any) =>
        state.heartbeats.find((row) => row.id === where.id) ?? null,
      findMany: async () => [...state.heartbeats]
    },
    heartbeatExecution: {
      upsert: async ({ where, create, update }: any) => {
        const existing = state.heartbeatExecutions.find((row) => row.id === where.id);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        state.heartbeatExecutions.push(create);
        return create;
      },
      findUnique: async ({ where }: any) =>
        state.heartbeatExecutions.find((row) => row.id === where.id) ?? null,
      findMany: async ({ where }: any = {}) =>
        state.heartbeatExecutions.filter((row) =>
          where?.heartbeatId ? row.heartbeatId === where.heartbeatId : true
        )
    },
    workspaceBillingSubscription: {
      findUnique: async ({ where }: any) =>
        state.subscriptions.find((row) => row.workspaceId === where.workspaceId) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const existing = state.subscriptions.find((row) => row.workspaceId === where.workspaceId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        state.subscriptions.push(create);
        return create;
      }
    },
    billingUsageEvent: {
      findMany: async ({ where }: any) =>
        state.usageEvents.filter((row) => {
          if (row.workspaceId !== where.workspaceId) {
            return false;
          }
          if (where.metric && row.metric !== where.metric) {
            return false;
          }
          return true;
        }),
      upsert: async ({ where, create, update }: any) => {
        const existing = state.usageEvents.find((row) => row.id === where.id);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        state.usageEvents.push(create);
        return create;
      },
      update: async ({ where, data }: any) => {
        const existing = state.usageEvents.find((row) => row.id === where.id);
        if (!existing) {
          throw new Error("missing usage event");
        }
        Object.assign(existing, data);
        return existing;
      }
    },
    workspaceQuotaOverride: {
      findUnique: async ({ where }: any) =>
        state.quotaOverrides.find((row) => row.workspaceId === where.workspaceId) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const existing = state.quotaOverrides.find((row) => row.workspaceId === where.workspaceId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        state.quotaOverrides.push(create);
        return create;
      }
    },
    connectedIntegration: {
      upsert: async ({ where, create, update }: any) => {
        const existing = state.integrations.find(
          (row) =>
            row.workspaceId === where.workspaceId_provider.workspaceId &&
            row.provider === where.workspaceId_provider.provider
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        state.integrations.push(create);
        return create;
      },
      findUnique: async ({ where }: any) =>
        state.integrations.find(
          (row) =>
            row.workspaceId === where.workspaceId_provider.workspaceId &&
            row.provider === where.workspaceId_provider.provider
        ) ?? null,
      findMany: async ({ where }: any) =>
        state.integrations.filter((row) => row.workspaceId === where.workspaceId),
      deleteMany: async ({ where }: any) => {
        const before = state.integrations.length;
        state.integrations = state.integrations.filter(
          (row) => !(row.workspaceId === where.workspaceId && row.provider === where.provider)
        );
        return { count: before - state.integrations.length };
      }
    },
    notification: {
      upsert: async ({ where, create, update }: any) => {
        const existing = state.notifications.find((row) => row.id === where.id);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        state.notifications.push(create);
        return create;
      },
      findMany: async ({ where }: any) =>
        state.notifications.filter((row) => {
          if (row.workspaceId !== where.workspaceId) {
            return false;
          }
          if (where.userId && row.userId !== where.userId) {
            return false;
          }
          return true;
        })
    }
  };
};

describe("Prisma persistence repositories", () => {
  it("persists identity records through the Prisma-backed repository", async () => {
    const prisma = createPrismaStub();
    const identity = new PrismaIdentityRepository({ client: prisma } as never);

    const tenant = await identity.createTenant({ name: "Tenant", slug: "tenant" });
    const user = await identity.createUser({
      tenantId: tenant.id,
      email: "user@example.com",
      displayName: "User"
    });
    const workspace = await identity.createWorkspace({
      tenantId: tenant.id,
      name: "Workspace",
      slug: "workspace"
    });
    const role = await identity.createRole({
      tenantId: tenant.id,
      name: "admin",
      permissions: ["admin:manage"],
      system: true,
      createdAt: now().toISOString()
    });
    const membership = await identity.addMembership({
      tenantId: tenant.id,
      workspaceId: workspace.id,
      userId: user.id,
      roleIds: [role.id]
    });
    const apiKey = await identity.createApiKey({
      tenantId: tenant.id,
      userId: user.id,
      workspaceIds: [workspace.id],
      label: "default",
      hashedKey: "hash-1",
      preview: "jean_xx",
      active: true
    });
    const session = await identity.createSession({
      tenantId: tenant.id,
      userId: user.id,
      workspaceIds: [workspace.id],
      roleIds: [role.id],
      permissions: ["missions:write"],
      subjectType: "user",
      accessTokenHash: "access-1",
      refreshTokenHash: "refresh-1",
      accessExpiresAt: now().toISOString(),
      refreshExpiresAt: now().toISOString()
    });

    expect((await identity.listTenants())[0]?.id).toBe(tenant.id);
    expect((await identity.getUserByEmail(tenant.id, "USER@example.com"))?.id).toBe(user.id);
    expect((await identity.getWorkspaceBySlug(tenant.id, "workspace"))?.id).toBe(workspace.id);
    expect((await identity.listWorkspacesForUser(tenant.id, user.id))[0]?.id).toBe(workspace.id);
    expect((await identity.findApiKeyByHash("hash-1"))?.id).toBe(apiKey.id);
    expect((await identity.findSessionByAccessHash("access-1"))?.id).toBe(session.id);

    const updatedMembership = await identity.updateMembershipRoles(membership.id, [role.id, "extra"]);
    const touchedSession = await identity.touchSession(session.id, now().toISOString());
    const revokedSession = await identity.revokeSession(session.id, now().toISOString());

    expect(updatedMembership?.roleIds).toEqual([role.id, "extra"]);
    expect(touchedSession?.lastUsedAt).toBeTruthy();
    expect(revokedSession?.revokedAt).toBeTruthy();
  });

  it("persists billing, integration, and notification records through Prisma-backed repositories", async () => {
    const prisma = createPrismaStub();
    const billing = new PrismaBillingRepository({ client: prisma } as never);
    const integrations = new PrismaIntegrationRepository({ client: prisma } as never);
    const notifications = new PrismaNotificationRepository({ client: prisma } as never);

    const subscription = await billing.saveSubscription({
      workspaceId: "workspace-1",
      tenantId: "tenant-1",
      planId: "pro",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      createdAt: now().toISOString(),
      updatedAt: now().toISOString()
    });
    const usage = await billing.saveUsageEvent({
      id: "usage-1",
      workspaceId: "workspace-1",
      tenantId: "tenant-1",
      metric: "missions",
      quantity: 2,
      sourceService: "billing-service",
      sourceEntityId: "mission-1",
      timestamp: now().toISOString(),
      stripeSyncStatus: "pending",
      billable: true,
      meteredAt: now().toISOString(),
      metadata: { mode: "test" }
    });
    const override = await billing.saveQuotaOverride({
      workspaceId: "workspace-1",
      tenantId: "tenant-1",
      limits: { missions: 50 },
      reason: "override",
      updatedBy: "admin",
      createdAt: now().toISOString(),
      updatedAt: now().toISOString()
    });
    const synced = await billing.updateUsageEventStripeStatus("usage-1", "synced");

    const integration = await integrations.save({
      id: "integration-1",
      workspaceId: "workspace-1",
      tenantId: "tenant-1",
      provider: "github",
      status: "connected",
      scopes: ["repo"],
      metadata: {},
      connectedAt: now().toISOString(),
      updatedAt: now().toISOString()
    });
    const notification = await notifications.save({
      id: "notification-1",
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
      userId: "user-1",
      channel: "email",
      eventType: "mission.completed",
      target: "user@example.com",
      subject: "Done",
      body: "Mission complete",
      status: "sent",
      mode: "synthetic",
      metadata: {},
      createdAt: now().toISOString(),
      sentAt: now().toISOString()
    });

    expect((await billing.getSubscription("workspace-1"))?.planId).toBe(subscription.planId);
    expect((await billing.listUsageEvents("workspace-1", "missions"))[0]?.id).toBe(usage.id);
    expect((await billing.getQuotaOverride("workspace-1"))?.reason).toBe(override.reason);
    expect(synced?.stripeSyncStatus).toBe("synced");
    expect((await integrations.get("workspace-1", "github"))?.id).toBe(integration.id);
    expect((await integrations.list("workspace-1")).length).toBe(1);
    expect(await integrations.delete("workspace-1", "github")).toBe(true);
    expect((await notifications.list("workspace-1", "user-1"))[0]?.id).toBe(notification.id);
  });

  it("hydrates mission approvals/transitions and persists audit + heartbeat records", async () => {
    const prisma = createPrismaStub();
    const missions = new PrismaMissionRepository({ client: prisma } as never);
    const audit = new PrismaAuditRepository({ client: prisma } as never);
    const heartbeats = new PrismaHeartbeatRepository({ client: prisma } as never);
    const heartbeatExecutions = new PrismaHeartbeatExecutionRepository({ client: prisma } as never);

    const missionRecord = {
      objective: {
        id: "mission-1",
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        userId: "user-1",
        title: "Mission",
        objective: "Do the thing",
        context: "context",
        constraints: [],
        requiredCapabilities: ["research"],
        risk: "low",
        createdAt: now().toISOString()
      },
      status: "planned",
      planVersion: 1,
      replanCount: 0,
      lastUpdatedAt: now().toISOString(),
      plan: undefined,
      result: undefined,
      activeExecution: undefined,
      artifacts: [],
      approvals: [],
      decisionLog: [],
      replanHistory: [],
      transitions: []
    } as any;

    await missions.save(missionRecord);
    await missions.saveApproval({
      id: "approval-1",
      missionId: "mission-1",
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
      status: "pending",
      reason: "Approve it",
      requiredActions: ["confirm"],
      createdAt: now().toISOString(),
      updatedAt: now().toISOString()
    });
    await missions.appendTransition({
      id: "transition-1",
      missionId: "mission-1",
      from: "draft",
      to: "planned",
      reason: "planned",
      actor: "agent-orchestrator",
      createdAt: now().toISOString()
    });
    const approved = await missions.approve("mission-1", "approval-1", "user-1", "approved");
    const hydrated = await missions.get("mission-1");

    await audit.save({
      id: "audit-1",
      kind: "mission.created",
      entityId: "mission-1",
      actor: "user-1",
      details: { ok: true },
      createdAt: now().toISOString()
    });

    await heartbeats.save({
      id: "heartbeat-1",
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
      name: "hb",
      schedule: "0 * * * *",
      objective: "check",
      active: true,
      schedulerStatus: "scheduled"
    });
    await heartbeatExecutions.save({
      id: "heartbeat-exec-1",
      heartbeatId: "heartbeat-1",
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
      status: "completed",
      triggerKind: "manual",
      summary: "done",
      result: { ok: true },
      createdAt: now().toISOString()
    });

    expect(approved?.status).toBe("approved");
    expect(hydrated?.approvals?.[0]?.approvedBy).toBe("user-1");
    expect(hydrated?.transitions?.[0]?.to).toBe("planned");
    expect((await audit.list("mission-1"))[0]?.kind).toBe("mission.created");
    expect((await heartbeats.get("heartbeat-1"))?.schedulerStatus).toBe("scheduled");
    expect((await heartbeatExecutions.list("heartbeat-1"))[0]?.status).toBe("completed");
  });
});
