import Fastify from "fastify";

import { BillingService } from "@jeanbot/billing-service";
import { createLogger } from "@jeanbot/logger";
import { createPersistenceBundle } from "@jeanbot/persistence";
import {
  assertInternalRequest,
  loadPlatformConfig
} from "@jeanbot/platform";
import { captureException, initTelemetry, metrics, recordCounter, recordDuration } from "@jeanbot/telemetry";
import type { AdminTenantSummary, BillingQuotaResource, ServiceHealth } from "@jeanbot/types";

export class AdminService {
  private readonly logger = createLogger("admin-service");
  private readonly persistence = createPersistenceBundle();
  private readonly billing = new BillingService();

  async listTenants(): Promise<AdminTenantSummary[]> {
    const tenants = await this.persistence.identity.listTenants();
    const results = await Promise.all(
      tenants.map(async (tenant) => {
        const [users, workspaces, apiKeys] = await Promise.all([
          this.persistence.identity.listUsersByTenant(tenant.id),
          this.persistence.identity.listWorkspacesByTenant(tenant.id),
          this.persistence.identity.listApiKeys(tenant.id)
        ]);

        return {
          tenant,
          userCount: users.length,
          workspaceCount: workspaces.length,
          apiKeyCount: apiKeys.length,
          createdAt: tenant.createdAt
        } satisfies AdminTenantSummary;
      })
    );

    return results.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getWorkspaceQuotaOverride(workspaceId: string) {
    return this.billing.getQuotaOverride(workspaceId);
  }

  async updateWorkspaceQuotaOverride(input: {
    workspaceId: string;
    tenantId?: string | undefined;
    limits: Partial<Record<BillingQuotaResource, number>>;
    reason?: string | undefined;
    updatedBy?: string | undefined;
  }) {
    const normalized = Object.fromEntries(
      Object.entries(input.limits).filter((entry): entry is [BillingQuotaResource, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] >= 0
      )
    );

    const updated = await this.billing.updateQuotaOverride({
      ...input,
      limits: normalized
    });
    this.logger.info("Updated workspace quota override", {
      workspaceId: input.workspaceId,
      updatedBy: input.updatedBy,
      limits: normalized
    });
    return updated;
  }

  health(): ServiceHealth {
    return {
      name: "admin-service",
      ok: true,
      details: {
        persistenceMode: this.persistence.mode
      },
      readiness: {
        admin: {
          ok: true,
          status: "ready",
          message: "Admin queries and quota overrides are available."
        }
      },
      metricsPath: "/metrics"
    };
  }
}

export const buildAdminServiceApp = () => {
  const app = Fastify();
  const service = new AdminService();
  const config = loadPlatformConfig();
  const requestTimings = new WeakMap<object, number>();
  initTelemetry("admin-service");

  app.addHook("onRequest", async (request) => {
    requestTimings.set(request, Date.now());
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = requestTimings.get(request) ?? Date.now();
    const route = request.routeOptions.url ?? request.url.split("?")[0];
    const labels = {
      service: "admin-service",
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
      service: "admin-service",
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

  app.get("/internal/admin/tenants", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    return service.listTenants();
  });

  app.get("/internal/admin/workspaces/:workspaceId/quota-override", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string };
    return service.getWorkspaceQuotaOverride(params.workspaceId);
  });

  app.put("/internal/admin/workspaces/:workspaceId/quota-override", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string };
    const body = request.body as {
      tenantId?: string;
      limits: Partial<Record<BillingQuotaResource, number>>;
      reason?: string;
      updatedBy?: string;
    };
    return service.updateWorkspaceQuotaOverride({
      workspaceId: params.workspaceId,
      tenantId: body.tenantId,
      limits: body.limits,
      reason: body.reason,
      updatedBy: body.updatedBy
    });
  });

  return {
    app,
    service
  };
};
