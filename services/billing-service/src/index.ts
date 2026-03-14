import crypto from "node:crypto";

import Fastify from "fastify";
import Stripe from "stripe";

import { createLogger } from "@jeanbot/logger";
import { createPersistenceBundle } from "@jeanbot/persistence";
import {
  JeanbotError,
  assertInternalRequest,
  assertWorkspaceAccess,
  authContextFromHeaders,
  loadPlatformConfig
} from "@jeanbot/platform";
import { captureException, initTelemetry, metrics, recordCounter, recordDuration } from "@jeanbot/telemetry";
import type {
  BillingPlanRecord,
  BillingQuotaResource,
  ServiceHealth,
  UsageEventRecord,
  WorkspaceBillingSnapshot,
  WorkspaceBillingSubscriptionRecord,
  WorkspaceQuotaOverrideRecord,
  WorkspaceQuotaStatus
} from "@jeanbot/types";

const billingPlans: BillingPlanRecord[] = [
  {
    id: "free",
    name: "Free",
    monthlyUsd: 0,
    missionRuns: 25,
    memoryRecords: 250,
    knowledgeDocuments: 50,
    activeAutomations: 2,
    browserLiveMinutes: 60,
    terminalExecutionSeconds: 600,
    features: ["Core orchestration", "Synthetic providers", "Single workspace"]
  },
  {
    id: "builder",
    name: "Builder",
    monthlyUsd: 29,
    missionRuns: 250,
    memoryRecords: 5_000,
    knowledgeDocuments: 1_000,
    activeAutomations: 25,
    browserLiveMinutes: 1_000,
    terminalExecutionSeconds: 25_000,
    features: ["Priority queueing", "Live communication adapters", "Expanded storage"]
  },
  {
    id: "team",
    name: "Team",
    monthlyUsd: 99,
    missionRuns: 2_500,
    memoryRecords: 50_000,
    knowledgeDocuments: 10_000,
    activeAutomations: 250,
    browserLiveMinutes: 10_000,
    terminalExecutionSeconds: 250_000,
    features: ["Shared tenants", "Advanced approvals", "Larger mission concurrency"]
  },
  {
    id: "enterprise",
    name: "Enterprise",
    monthlyUsd: 499,
    missionRuns: 50_000,
    memoryRecords: 1_000_000,
    knowledgeDocuments: 100_000,
    activeAutomations: 10_000,
    browserLiveMinutes: 250_000,
    terminalExecutionSeconds: 5_000_000,
    features: ["Custom limits", "Dedicated support", "Private runtime isolation"]
  }
];

const quotaResources: BillingQuotaResource[] = [
  "missions",
  "memories",
  "knowledgeDocuments",
  "automations",
  "browserMinutes",
  "terminalSeconds"
];

const defaultPortalUrl = (workspaceId: string, planId: string) =>
  `https://billing.jeanbot.local/workspaces/${workspaceId}?plan=${planId}`;

const stripeMetricName = (metric: BillingQuotaResource) => `jeanbot.${metric}`;

export class BillingService {
  private readonly logger = createLogger("billing-service");
  private readonly persistence = createPersistenceBundle();
  private readonly config = loadPlatformConfig();
  private readonly stripe = this.config.stripeSecretKey
    ? new Stripe(this.config.stripeSecretKey, {
        apiVersion: "2026-02-25.clover"
      })
    : undefined;

  listPlans() {
    return billingPlans;
  }

  private planFor(planId: string) {
    return billingPlans.find((plan) => plan.id === planId) ?? billingPlans[0];
  }

  private async ensureSubscription(workspaceId: string, tenantId?: string) {
    const existing = await this.persistence.billing.getSubscription(workspaceId);
    if (existing) {
      return existing;
    }

    const created: WorkspaceBillingSubscriptionRecord = {
      workspaceId,
      tenantId,
      planId: "free",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return this.persistence.billing.saveSubscription(created);
  }

  private providerMode(subscription: WorkspaceBillingSubscriptionRecord) {
    return this.stripe && subscription.stripeCustomerId ? "live" : "synthetic";
  }

  private async computedUsage(workspaceId: string) {
    const [missions, memories, knowledgeDocuments, heartbeats, usageEvents] = await Promise.all([
      this.persistence.missions.list(),
      this.persistence.memory.list(workspaceId),
      this.persistence.knowledge.list(workspaceId),
      this.persistence.heartbeats.list(),
      this.persistence.billing.listUsageEvents(workspaceId)
    ]);

    return {
      missions: missions.filter((mission) => mission.objective.workspaceId === workspaceId).length,
      memories: memories.filter((memory) => memory.scope === "long-term" || memory.scope === "structured").length,
      knowledgeDocuments: knowledgeDocuments.length,
      automations: heartbeats.filter(
        (heartbeat) => heartbeat.workspaceId === workspaceId && heartbeat.active
      ).length,
      browserMinutes: usageEvents
        .filter((event) => event.metric === "browserMinutes")
        .reduce((sum, event) => sum + event.quantity, 0),
      terminalSeconds: usageEvents
        .filter((event) => event.metric === "terminalSeconds")
        .reduce((sum, event) => sum + event.quantity, 0)
    };
  }

  private buildQuotaStatus(snapshot: WorkspaceBillingSnapshot): WorkspaceQuotaStatus {
    const remaining = {
      missions: Math.max(0, snapshot.limits.missions - snapshot.usage.missions),
      memories: Math.max(0, snapshot.limits.memories - snapshot.usage.memories),
      knowledgeDocuments: Math.max(
        0,
        snapshot.limits.knowledgeDocuments - snapshot.usage.knowledgeDocuments
      ),
      automations: Math.max(0, snapshot.limits.automations - snapshot.usage.automations),
      browserMinutes: Math.max(0, snapshot.limits.browserMinutes - snapshot.usage.browserMinutes),
      terminalSeconds: Math.max(0, snapshot.limits.terminalSeconds - snapshot.usage.terminalSeconds)
    };
    const exceeded = quotaResources.filter(
      (resource) => snapshot.usage[resource] > snapshot.limits[resource]
    );
    const nearLimit = quotaResources.filter((resource) => {
      const limit = snapshot.limits[resource];
      return limit > 0 && snapshot.usage[resource] / limit >= 0.8;
    });

    return {
      workspaceId: snapshot.workspaceId,
      tenantId: snapshot.tenantId,
      planId: snapshot.planId,
      usage: snapshot.usage,
      limits: snapshot.limits,
      remaining,
      exceeded,
      nearLimit,
      overrideApplied: Boolean(snapshot.quotaOverride),
      updatedAt: snapshot.updatedAt
    };
  }

  private baseLimitsFor(plan: BillingPlanRecord) {
    return {
      missions: plan.missionRuns,
      memories: plan.memoryRecords,
      knowledgeDocuments: plan.knowledgeDocuments,
      automations: plan.activeAutomations,
      browserMinutes: plan.browserLiveMinutes,
      terminalSeconds: plan.terminalExecutionSeconds
    };
  }

  private applyQuotaOverride(
    limits: WorkspaceBillingSnapshot["limits"],
    override?: WorkspaceQuotaOverrideRecord | undefined
  ) {
    if (!override) {
      return limits;
    }

    return {
      ...limits,
      ...Object.fromEntries(
        Object.entries(override.limits).filter((entry): entry is [BillingQuotaResource, number] =>
          typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] >= 0
        )
      )
    };
  }

  async recordUsage(input: Omit<UsageEventRecord, "id" | "stripeSyncStatus" | "meteredAt">) {
    const subscription = await this.ensureSubscription(input.workspaceId, input.tenantId);
    const event = await this.persistence.billing.saveUsageEvent({
      ...input,
      id: crypto.randomUUID(),
      stripeSyncStatus: "pending",
      meteredAt: new Date().toISOString()
    });

    if (!this.stripe || !subscription.stripeCustomerId || !input.billable) {
      return this.persistence.billing.updateUsageEventStripeStatus(event.id, "skipped");
    }

    try {
      const billingClient = this.stripe as unknown as {
        billing?: {
          meterEvents?: {
            create(payload: Record<string, unknown>): Promise<unknown>;
          };
        };
      };

      await billingClient.billing?.meterEvents?.create?.({
        event_name: stripeMetricName(input.metric),
        timestamp: Math.floor(new Date(input.timestamp).getTime() / 1000),
        payload: {
          stripe_customer_id: subscription.stripeCustomerId,
          value: String(input.quantity),
          workspace_id: input.workspaceId
        }
      });

      return this.persistence.billing.updateUsageEventStripeStatus(event.id, "synced");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn("Stripe usage sync failed", {
        workspaceId: input.workspaceId,
        metric: input.metric,
        error: message
      });
      return this.persistence.billing.updateUsageEventStripeStatus(event.id, "failed", message);
    }
  }

  async listUsageEvents(workspaceId: string, metric?: BillingQuotaResource, limit = 50) {
    const events = await this.persistence.billing.listUsageEvents(workspaceId, metric);
    return events.slice(0, limit);
  }

  async getWorkspaceSummary(workspaceId: string, tenantId?: string) {
    const subscription = await this.ensureSubscription(workspaceId, tenantId);
    const plan = this.planFor(subscription.planId);
    const usage = await this.computedUsage(workspaceId);
    const recentUsageEvents = await this.listUsageEvents(workspaceId, undefined, 25);
    const quotaOverride = await this.persistence.billing.getQuotaOverride(workspaceId);

    const snapshot: WorkspaceBillingSnapshot = {
      workspaceId,
      tenantId: subscription.tenantId,
      planId: plan.id,
      mode: this.providerMode(subscription),
      customerId: subscription.stripeCustomerId,
      subscriptionId: subscription.stripeSubscriptionId,
      portalUrl: defaultPortalUrl(workspaceId, plan.id),
      usage,
      limits: this.applyQuotaOverride(this.baseLimitsFor(plan), quotaOverride),
      recentUsageEvents,
      quotaOverride,
      stripeSync: {
        pending: recentUsageEvents.filter((event) => event.stripeSyncStatus === "pending").length,
        synced: recentUsageEvents.filter((event) => event.stripeSyncStatus === "synced").length,
        failed: recentUsageEvents.filter((event) => event.stripeSyncStatus === "failed").length,
        skipped: recentUsageEvents.filter((event) => event.stripeSyncStatus === "skipped").length
      },
      updatedAt: new Date().toISOString()
    };

    return {
      snapshot,
      plan
    };
  }

  async getWorkspaceQuotaStatus(workspaceId: string, tenantId?: string) {
    const summary = await this.getWorkspaceSummary(workspaceId, tenantId);
    return this.buildQuotaStatus(summary.snapshot);
  }

  async assertWithinQuota(
    workspaceId: string,
    resource: BillingQuotaResource,
    tenantId?: string,
    increment = 1
  ) {
    const { snapshot, plan } = await this.getWorkspaceSummary(workspaceId, tenantId);
    const projectedUsage = snapshot.usage[resource] + increment;
    const limit = snapshot.limits[resource];
    if (projectedUsage <= limit) {
      return this.buildQuotaStatus(snapshot);
    }

    throw new JeanbotError({
      message: `Workspace "${workspaceId}" exceeded the ${resource} quota for plan "${plan.name}".`,
      statusCode: 409,
      code: "quota_exceeded",
      details: {
        workspaceId,
        resource,
        planId: plan.id,
        current: snapshot.usage[resource],
        requested: increment,
        limit
      }
    });
  }

  async updateWorkspacePlan(input: {
    workspaceId: string;
    tenantId?: string | undefined;
    planId: string;
    stripeCustomerId?: string | undefined;
    stripeSubscriptionId?: string | undefined;
  }) {
    const existing = await this.ensureSubscription(input.workspaceId, input.tenantId);
    const plan = this.planFor(input.planId);
    await this.persistence.billing.saveSubscription({
      workspaceId: input.workspaceId,
      tenantId: input.tenantId ?? existing.tenantId,
      planId: plan.id,
      stripeCustomerId: input.stripeCustomerId ?? existing.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId ?? existing.stripeSubscriptionId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString()
    });
    return this.getWorkspaceSummary(input.workspaceId, input.tenantId);
  }

  async getQuotaOverride(workspaceId: string) {
    return this.persistence.billing.getQuotaOverride(workspaceId);
  }

  async updateQuotaOverride(input: {
    workspaceId: string;
    tenantId?: string | undefined;
    limits: Partial<Record<BillingQuotaResource, number>>;
    reason?: string | undefined;
    updatedBy?: string | undefined;
  }) {
    const existing = await this.persistence.billing.getQuotaOverride(input.workspaceId);
    const saved = await this.persistence.billing.saveQuotaOverride({
      workspaceId: input.workspaceId,
      tenantId: input.tenantId ?? existing?.tenantId,
      limits: {
        ...(existing?.limits ?? {}),
        ...input.limits
      },
      reason: input.reason,
      updatedBy: input.updatedBy,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const summary = await this.getWorkspaceSummary(input.workspaceId, input.tenantId);
    return {
      override: saved,
      quota: this.buildQuotaStatus(summary.snapshot)
    };
  }

  async createBillingPortal(workspaceId: string, tenantId?: string) {
    const subscription = await this.ensureSubscription(workspaceId, tenantId);
    const mode = this.providerMode(subscription);
    if (mode === "live" && this.stripe && subscription.stripeCustomerId) {
      const session = await this.stripe.billingPortal.sessions.create({
        customer: subscription.stripeCustomerId,
        return_url: String(process.env.STRIPE_PORTAL_RETURN_URL ?? defaultPortalUrl(workspaceId, subscription.planId))
      });
      return {
        workspaceId,
        mode,
        portalUrl: session.url
      };
    }

    return {
      workspaceId,
      mode,
      portalUrl: defaultPortalUrl(workspaceId, subscription.planId)
    };
  }

  health(): ServiceHealth {
    return {
      name: "billing-service",
      ok: true,
      details: {
        persistenceMode: this.persistence.mode,
        stripeConfigured: Boolean(this.stripe)
      },
      readiness: {
        billing: {
          ok: true,
          status: this.stripe ? "ready" : "degraded",
          message: this.stripe
            ? "Stripe mirroring is configured."
            : "Local authoritative billing ledger is active without Stripe mirroring."
        }
      },
      metricsPath: "/metrics"
    };
  }
}

export const buildBillingServiceApp = () => {
  const app = Fastify();
  const service = new BillingService();
  const config = loadPlatformConfig();
  const requestTimings = new WeakMap<object, number>();
  initTelemetry("billing-service");

  app.addHook("onRequest", async (request) => {
    requestTimings.set(request, Date.now());
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = requestTimings.get(request) ?? Date.now();
    const route = request.routeOptions.url ?? request.url.split("?")[0];
    const labels = {
      service: "billing-service",
      method: request.method,
      route,
      status: String(reply.statusCode)
    };
    recordCounter("jeanbot_http_server_requests_total", "JeanBot HTTP server requests", labels);
    recordDuration(
      "jeanbot_http_server_request_duration_ms",
      "JeanBot HTTP server request duration",
      Date.now() - startedAt,
      labels
    );
  });

  app.addHook("onError", async (request, _reply, error) => {
    captureException(error, {
      service: "billing-service",
      route: request.routeOptions.url ?? request.url.split("?")[0]
    });
  });

  app.get("/health", async () => ({
    ok: true,
    service: service.health()
  }));

  app.get("/metrics", async (_request, reply) => {
    reply.type("text/plain; version=0.0.4");
    return metrics();
  });

  app.get("/internal/billing/plans", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    return service.listPlans();
  });

  app.get("/internal/billing/workspaces/:workspaceId/summary", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string };
    const authContext = authContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    assertWorkspaceAccess(authContext, params.workspaceId);
    return service.getWorkspaceSummary(params.workspaceId, authContext?.tenantId);
  });

  app.get("/internal/billing/workspaces/:workspaceId/quota", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string };
    const authContext = authContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    assertWorkspaceAccess(authContext, params.workspaceId);
    return service.getWorkspaceQuotaStatus(params.workspaceId, authContext?.tenantId);
  });

  app.get("/internal/billing/workspaces/:workspaceId/usage", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string };
    const query = request.query as { metric?: BillingQuotaResource; limit?: string };
    const authContext = authContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    assertWorkspaceAccess(authContext, params.workspaceId);
    return service.listUsageEvents(
      params.workspaceId,
      query.metric,
      query.limit ? Number(query.limit) : 50
    );
  });

  app.post("/internal/billing/workspaces/:workspaceId/usage", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string };
    const body = request.body as Omit<UsageEventRecord, "id" | "workspaceId" | "stripeSyncStatus" | "meteredAt">;
    const authContext = authContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    assertWorkspaceAccess(authContext, params.workspaceId);
    return service.recordUsage({
      ...body,
      workspaceId: params.workspaceId
    });
  });

  app.post("/internal/billing/workspaces/:workspaceId/subscription", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string };
    const authContext = authContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    assertWorkspaceAccess(authContext, params.workspaceId);
    const body = request.body as {
      planId: string;
      stripeCustomerId?: string;
      stripeSubscriptionId?: string;
    };
    return service.updateWorkspacePlan({
      workspaceId: params.workspaceId,
      tenantId: authContext?.tenantId,
      planId: body.planId,
      stripeCustomerId: body.stripeCustomerId,
      stripeSubscriptionId: body.stripeSubscriptionId
    });
  });

  app.get("/internal/billing/workspaces/:workspaceId/quota-override", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string };
    return service.getQuotaOverride(params.workspaceId);
  });

  app.put("/internal/billing/workspaces/:workspaceId/quota-override", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string };
    const authContext = authContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    const body = request.body as {
      limits: Partial<Record<BillingQuotaResource, number>>;
      reason?: string;
      updatedBy?: string;
    };
    return service.updateQuotaOverride({
      workspaceId: params.workspaceId,
      tenantId: authContext?.tenantId,
      limits: body.limits,
      reason: body.reason,
      updatedBy: body.updatedBy ?? authContext?.userId
    });
  });

  app.post("/internal/billing/workspaces/:workspaceId/portal", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string };
    const authContext = authContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    assertWorkspaceAccess(authContext, params.workspaceId);
    return service.createBillingPortal(params.workspaceId, authContext?.tenantId);
  });

  return {
    app,
    service
  };
};
