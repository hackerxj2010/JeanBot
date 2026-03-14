import { afterAll, describe, expect, it } from "vitest";

process.env.JEANBOT_AUTH_REQUIRED = "true";
process.env.JEANBOT_MODEL_PROVIDER = "anthropic";

import { buildApp } from "../../services/api-gateway/src/app.js";

const { app } = buildApp();

afterAll(async () => {
  await app.close();
});

describe("API gateway", () => {
  it("bootstraps auth, creates and retrieves a mission", async () => {
    const suffix = Date.now().toString();
    const bootstrapResponse = await app.inject({
      method: "POST",
      url: "/api/bootstrap",
      payload: {
        tenantName: "Integration Tenant",
        tenantSlug: `integration-tenant-${suffix}`,
        email: `integration-${suffix}@example.com`,
        displayName: "Integration User",
        workspaceName: "Integration Workspace",
        workspaceSlug: `integration-workspace-${suffix}`,
        apiKeyLabel: "integration-key"
      }
    });

    expect(bootstrapResponse.statusCode).toBe(200);
    const bootstrap = bootstrapResponse.json();
    expect(bootstrap.rawApiKey).toContain("jean_");

    const headers = {
      "x-api-key": bootstrap.rawApiKey
    };

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/missions",
      headers,
      payload: {
        workspaceId: bootstrap.workspace.id,
        userId: bootstrap.user.id,
        title: "API mission",
        objective: "Create a mission through the secured API gateway.",
        context: "Integration test",
        constraints: [],
        requiredCapabilities: ["planning", "filesystem", "memory", "orchestration"],
        risk: "low"
      }
    });

    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json();

    const getResponse = await app.inject({
      method: "GET",
      url: `/api/missions/${created.objective.id}`,
      headers
    });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json().objective.title).toBe("API mission");

    const planResponse = await app.inject({
      method: "POST",
      url: `/api/missions/${created.objective.id}/plan`,
      headers
    });

    expect(planResponse.statusCode).toBe(200);

    const runResponse = await app.inject({
      method: "POST",
      url: `/api/missions/${created.objective.id}/run`,
      headers,
      payload: {
        workspaceRoot: "./workspace/users/{userId}"
      }
    });

    expect(runResponse.statusCode).toBe(200);
    expect(runResponse.json().status).toBe("completed");

    const executionTelemetryResponse = await app.inject({
      method: "GET",
      url: `/api/missions/${created.objective.id}/execution`,
      headers
    });

    expect(executionTelemetryResponse.statusCode).toBe(200);
    expect(executionTelemetryResponse.json().missionId).toBe(created.objective.id);
    expect(executionTelemetryResponse.json().summary.totalSteps).toBeGreaterThan(0);
    expect(Array.isArray(executionTelemetryResponse.json().steps)).toBe(true);

    const auditResponse = await app.inject({
      method: "GET",
      url: `/api/audit?entityId=${created.objective.id}`,
      headers
    });

    expect(auditResponse.statusCode).toBe(200);
    expect(Array.isArray(auditResponse.json())).toBe(true);

    const toolsResponse = await app.inject({
      method: "GET",
      url: "/api/tools",
      headers
    });

    expect(toolsResponse.statusCode).toBe(200);
    expect(toolsResponse.json().length).toBeGreaterThan(5);

    const directToolExecutionResponse = await app.inject({
      method: "POST",
      url: "/api/tools/execute",
      headers,
      payload: {
        toolId: "memory.remember",
        action: "remember",
        payload: {
          workspaceId: bootstrap.workspace.id,
          text: "Gateway tool execution stored this workspace note.",
          tags: ["gateway", "tool-execute"],
          scope: "short-term",
          importance: 0.7
        }
      }
    });

    expect(directToolExecutionResponse.statusCode).toBe(200);
    expect(directToolExecutionResponse.json().ok).toBe(true);
    expect(directToolExecutionResponse.json().descriptor.id).toBe("memory.remember");
    expect(directToolExecutionResponse.json().grantedPermissions).toContain("write");

    const batchToolExecutionResponse = await app.inject({
      method: "POST",
      url: "/api/tools/batch",
      headers,
      payload: {
        continueOnError: true,
        requests: [
          {
            toolId: "knowledge.document.ingest",
            action: "ingest",
            payload: {
              workspaceId: bootstrap.workspace.id,
              title: "Batch knowledge note",
              body: "The batch tool API can ingest knowledge and summarize memory.",
              metadata: {
                source: "integration-test"
              }
            }
          },
          {
            toolId: "memory.summary",
            action: "summary",
            payload: {
              workspaceId: bootstrap.workspace.id
            }
          }
        ]
      }
    });

    expect(batchToolExecutionResponse.statusCode).toBe(200);
    expect(batchToolExecutionResponse.json().ok).toBe(true);
    expect(batchToolExecutionResponse.json().succeededCount).toBe(2);
    expect(batchToolExecutionResponse.json().results[1].toolId).toBe("memory.summary");

    const runtimeProvidersResponse = await app.inject({
      method: "GET",
      url: "/api/runtime/providers",
      headers
    });

    expect(runtimeProvidersResponse.statusCode).toBe(200);
    expect(runtimeProvidersResponse.json().providers.length).toBeGreaterThanOrEqual(4);

    const runtimeExecuteResponse = await app.inject({
      method: "POST",
      url: "/api/runtime/execute",
      headers,
      payload: {
        workspaceId: bootstrap.workspace.id,
        title: "Runtime gateway probe",
        objective: "Inspect the workspace and return a concise operator update.",
        capability: "filesystem",
        mode: "synthetic"
      }
    });

    expect(runtimeExecuteResponse.statusCode).toBe(200);
    expect(runtimeExecuteResponse.json().finalText.length).toBeGreaterThan(0);
    expect(runtimeExecuteResponse.json().mode).toBe("synthetic");

    const runtimeSessionsResponse = await app.inject({
      method: "GET",
      url: `/api/runtime/sessions?workspaceId=${bootstrap.workspace.id}`,
      headers
    });

    expect(runtimeSessionsResponse.statusCode).toBe(200);
    expect(runtimeSessionsResponse.json().length).toBeGreaterThanOrEqual(1);

    const apiKeysResponse = await app.inject({
      method: "GET",
      url: "/api/api-keys",
      headers
    });

    expect(apiKeysResponse.statusCode).toBe(200);
    expect(apiKeysResponse.json().length).toBeGreaterThanOrEqual(1);

    const knowledgeCreateResponse = await app.inject({
      method: "POST",
      url: `/api/workspaces/${bootstrap.workspace.id}/knowledge`,
      headers,
      payload: {
        title: "JeanBot deployment note",
        body: "JeanBot can run in local JSON mode or Postgres mode.",
        metadata: {
          category: "ops"
        }
      }
    });

    expect(knowledgeCreateResponse.statusCode).toBe(200);

    const knowledgeQueryResponse = await app.inject({
      method: "POST",
      url: `/api/workspaces/${bootstrap.workspace.id}/knowledge/query`,
      headers,
      payload: {
        term: "Postgres"
      }
    });

    expect(knowledgeQueryResponse.statusCode).toBe(200);
    expect(knowledgeQueryResponse.json().length).toBeGreaterThanOrEqual(1);

    const draftMessageResponse = await app.inject({
      method: "POST",
      url: `/api/workspaces/${bootstrap.workspace.id}/communication/draft`,
      headers,
      payload: {
        channel: "email",
        target: "ops@example.com",
        subject: "JeanBot draft",
        body: "Draft status update",
        metadata: {
          source: "integration-test"
        }
      }
    });

    expect(draftMessageResponse.statusCode).toBe(200);
    expect(draftMessageResponse.json().status).toBe("draft");

    const notificationsResponse = await app.inject({
      method: "GET",
      url: `/api/workspaces/${bootstrap.workspace.id}/notifications`,
      headers
    });

    expect(notificationsResponse.statusCode).toBe(200);
    expect(
      notificationsResponse
        .json()
        .some((record: { eventType: string }) => record.eventType === "mission.completed")
    ).toBe(true);

    const browserNavigateResponse = await app.inject({
      method: "POST",
      url: "/api/browser/navigate",
      headers,
      payload: {
        workspaceId: bootstrap.workspace.id,
        url: "https://example.com"
      }
    });

    expect(browserNavigateResponse.statusCode).toBe(200);
    const browserSession = browserNavigateResponse.json();
    expect(browserSession.mode).toBe("synthetic");

    const browserExtractResponse = await app.inject({
      method: "POST",
      url: "/api/browser/extract",
      headers,
      payload: {
        sessionId: browserSession.id,
        workspaceId: bootstrap.workspace.id,
        kind: "text"
      }
    });

    expect(browserExtractResponse.statusCode).toBe(200);

    const browserCaptureResponse = await app.inject({
      method: "POST",
      url: "/api/browser/capture",
      headers,
      payload: {
        sessionId: browserSession.id,
        workspaceId: bootstrap.workspace.id,
        fullPage: true
      }
    });

    expect(browserCaptureResponse.statusCode).toBe(200);

    const terminalRunResponse = await app.inject({
      method: "POST",
      url: "/api/terminal/run",
      headers,
      payload: {
        workspaceId: bootstrap.workspace.id,
        command: "echo api-gateway-terminal",
        cwd: "."
      }
    });

    expect(terminalRunResponse.statusCode).toBe(200);
    expect(terminalRunResponse.json().record.status).toBe("completed");

    const terminalExecutionId = terminalRunResponse.json().record.id;
    const terminalOutputResponse = await app.inject({
      method: "GET",
      url: `/api/terminal/executions/${terminalExecutionId}/output`,
      headers
    });

    expect(terminalOutputResponse.statusCode).toBe(200);
    expect(terminalOutputResponse.json().stdout.toLowerCase()).toContain("api-gateway-terminal");

    const billingPlansResponse = await app.inject({
      method: "GET",
      url: "/api/billing/plans",
      headers
    });

    expect(billingPlansResponse.statusCode).toBe(200);
    expect(billingPlansResponse.json().length).toBeGreaterThanOrEqual(1);

    const billingSummaryResponse = await app.inject({
      method: "GET",
      url: `/api/workspaces/${bootstrap.workspace.id}/billing`,
      headers
    });

    expect(billingSummaryResponse.statusCode).toBe(200);
    expect(billingSummaryResponse.json().snapshot.workspaceId).toBe(bootstrap.workspace.id);

    const billingUsageResponse = await app.inject({
      method: "GET",
      url: `/api/workspaces/${bootstrap.workspace.id}/billing/usage`,
      headers
    });

    expect(billingUsageResponse.statusCode).toBe(200);
    expect(Array.isArray(billingUsageResponse.json())).toBe(true);

    const integrationConnectResponse = await app.inject({
      method: "POST",
      url: `/api/workspaces/${bootstrap.workspace.id}/integrations/github/connect`,
      headers,
      payload: {
        redirectUri: "https://app.jeanbot.local/oauth/callback"
      }
    });

    expect(integrationConnectResponse.statusCode).toBe(200);
    const integrationConnect = integrationConnectResponse.json();

    const integrationCallbackResponse = await app.inject({
      method: "POST",
      url: `/api/workspaces/${bootstrap.workspace.id}/integrations/github/callback`,
      headers,
      payload: {
        code: "synthetic_github_integration",
        state: integrationConnect.state,
        redirectUri: "https://app.jeanbot.local/oauth/callback"
      }
    });

    expect(integrationCallbackResponse.statusCode).toBe(200);
    expect(integrationCallbackResponse.json().provider).toBe("github");

    const integrationListResponse = await app.inject({
      method: "GET",
      url: `/api/workspaces/${bootstrap.workspace.id}/integrations`,
      headers
    });

    expect(integrationListResponse.statusCode).toBe(200);
    expect(integrationListResponse.json().length).toBeGreaterThanOrEqual(1);
  }, 75_000);

  it("exchanges API keys for bearer sessions and manages roles and memberships", async () => {
    const suffix = `${Date.now()}-session`;
    const bootstrapResponse = await app.inject({
      method: "POST",
      url: "/api/bootstrap",
      payload: {
        tenantName: "Session Tenant",
        tenantSlug: `session-tenant-${suffix}`,
        email: `session-${suffix}@example.com`,
        displayName: "Session User",
        workspaceName: "Session Workspace",
        workspaceSlug: `session-workspace-${suffix}`,
        apiKeyLabel: "session-key"
      }
    });

    expect(bootstrapResponse.statusCode).toBe(200);
    const bootstrap = bootstrapResponse.json();

    const exchangeResponse = await app.inject({
      method: "POST",
      url: "/api/auth/session/exchange",
      payload: {
        apiKey: bootstrap.rawApiKey
      }
    });

    expect(exchangeResponse.statusCode).toBe(200);
    const exchange = exchangeResponse.json();
    expect(exchange.ok).toBe(true);
    expect(exchange.accessToken).toContain("jean_access_");
    expect(exchange.authContext.permissions).toContain("workspaces:manage");

    const bearerHeaders = {
      authorization: `Bearer ${exchange.accessToken}`
    };

    const rolesResponse = await app.inject({
      method: "GET",
      url: "/api/roles",
      headers: bearerHeaders
    });

    expect(rolesResponse.statusCode).toBe(200);
    expect(rolesResponse.json().some((role: { id: string }) => role.id === "admin")).toBe(true);

    const createRoleResponse = await app.inject({
      method: "POST",
      url: "/api/roles",
      headers: bearerHeaders,
      payload: {
        name: `Auditor ${suffix}`,
        permissions: ["reports:read", "audit:read"]
      }
    });

    expect(createRoleResponse.statusCode).toBe(200);
    const createdRole = createRoleResponse.json();
    expect(createdRole.permissions).toContain("reports:read");

    const workspacesResponse = await app.inject({
      method: "GET",
      url: "/api/workspaces",
      headers: bearerHeaders
    });

    expect(workspacesResponse.statusCode).toBe(200);
    expect(workspacesResponse.json().some((workspace: { id: string }) => workspace.id === bootstrap.workspace.id)).toBe(true);

    const initialQuotaResponse = await app.inject({
      method: "GET",
      url: `/api/workspaces/${bootstrap.workspace.id}/quota`,
      headers: bearerHeaders
    });

    expect(initialQuotaResponse.statusCode).toBe(200);
    expect(initialQuotaResponse.json().limits.automations).toBe(2);

    const membershipsResponse = await app.inject({
      method: "GET",
      url: `/api/workspaces/${bootstrap.workspace.id}/memberships`,
      headers: bearerHeaders
    });

    expect(membershipsResponse.statusCode).toBe(200);
    expect(
      membershipsResponse
        .json()
        .some((membership: { id: string }) => membership.id === bootstrap.membership.id)
    ).toBe(true);

    const updateMembershipResponse = await app.inject({
      method: "PUT",
      url: `/api/workspaces/${bootstrap.workspace.id}/memberships/${bootstrap.membership.id}/roles`,
      headers: bearerHeaders,
      payload: {
        roleIds: ["admin", createdRole.id]
      }
    });

    expect(updateMembershipResponse.statusCode).toBe(200);
    expect(updateMembershipResponse.json().roleIds).toContain(createdRole.id);

    const refreshResponse = await app.inject({
      method: "POST",
      url: "/api/auth/session/refresh",
      payload: {
        refreshToken: exchange.refreshToken
      }
    });

    expect(refreshResponse.statusCode).toBe(200);
    const refreshed = refreshResponse.json();
    expect(refreshed.ok).toBe(true);
    expect(refreshed.authContext.permissions).toContain("reports:read");

    const refreshedBearerHeaders = {
      authorization: `Bearer ${refreshed.accessToken}`
    };

    const refreshedWorkspacesResponse = await app.inject({
      method: "GET",
      url: "/api/workspaces",
      headers: refreshedBearerHeaders
    });

    expect(refreshedWorkspacesResponse.statusCode).toBe(200);
    expect(refreshedWorkspacesResponse.json().length).toBeGreaterThanOrEqual(1);

    const createdHeartbeatIds: string[] = [];
    for (const name of ["Monitor alpha", "Monitor beta"]) {
      const heartbeatResponse = await app.inject({
        method: "POST",
        url: "/api/heartbeats",
        headers: refreshedBearerHeaders,
        payload: {
          workspaceId: bootstrap.workspace.id,
          name,
          schedule: "0 * * * *",
          objective: "Watch the workspace",
          active: true
        }
      });

      expect(heartbeatResponse.statusCode).toBe(200);
      createdHeartbeatIds.push(heartbeatResponse.json().id);
    }

    const triggerHeartbeatResponse = await app.inject({
      method: "POST",
      url: `/api/heartbeats/${createdHeartbeatIds[0]}/trigger`,
      headers: refreshedBearerHeaders
    });

    expect(triggerHeartbeatResponse.statusCode).toBe(200);

    const heartbeatHistoryResponse = await app.inject({
      method: "GET",
      url: `/api/heartbeats/${createdHeartbeatIds[0]}/history`,
      headers: refreshedBearerHeaders
    });

    expect(heartbeatHistoryResponse.statusCode).toBe(200);
    expect(heartbeatHistoryResponse.json().length).toBeGreaterThanOrEqual(1);
    expect(heartbeatHistoryResponse.json()[0].status).toBe("completed");

    const quotaResponse = await app.inject({
      method: "GET",
      url: `/api/workspaces/${bootstrap.workspace.id}/quota`,
      headers: refreshedBearerHeaders
    });

    expect(quotaResponse.statusCode).toBe(200);
    expect(quotaResponse.json().remaining.automations).toBe(0);

    const blockedHeartbeatResponse = await app.inject({
      method: "POST",
      url: "/api/heartbeats",
      headers: refreshedBearerHeaders,
      payload: {
        workspaceId: bootstrap.workspace.id,
        name: "Monitor gamma",
        schedule: "15 * * * *",
        objective: "This one should be blocked by quota",
        active: true
      }
    });

    expect(blockedHeartbeatResponse.statusCode).toBe(409);
    expect(blockedHeartbeatResponse.json().code).toBe("quota_exceeded");

    const adminTenantsResponse = await app.inject({
      method: "GET",
      url: "/api/admin/tenants",
      headers: refreshedBearerHeaders
    });

    expect(adminTenantsResponse.statusCode).toBe(200);
    expect(
      adminTenantsResponse
        .json()
        .some((entry: { tenant: { id: string } }) => entry.tenant.id === bootstrap.tenant.id)
    ).toBe(true);

    const quotaOverrideResponse = await app.inject({
      method: "PUT",
      url: `/api/admin/workspaces/${bootstrap.workspace.id}/quota-override`,
      headers: refreshedBearerHeaders,
      payload: {
        limits: {
          automations: 5
        },
        reason: "Integration override"
      }
    });

    expect(quotaOverrideResponse.statusCode).toBe(200);
    expect(quotaOverrideResponse.json().quota.limits.automations).toBe(5);

    const overriddenQuotaResponse = await app.inject({
      method: "GET",
      url: `/api/workspaces/${bootstrap.workspace.id}/quota`,
      headers: refreshedBearerHeaders
    });

    expect(overriddenQuotaResponse.statusCode).toBe(200);
    expect(overriddenQuotaResponse.json().limits.automations).toBe(5);
    expect(overriddenQuotaResponse.json().overrideApplied).toBe(true);
  }, 30_000);

  it("applies sliding-window rate limiting per userId", async () => {
    const suffix = `${Date.now()}-rate`;
    const bootstrapResponse = await app.inject({
      method: "POST",
      url: "/api/bootstrap",
      payload: {
        tenantName: "Rate Tenant",
        tenantSlug: `rate-tenant-${suffix}`,
        email: `rate-${suffix}@example.com`,
        displayName: "Rate User",
        workspaceName: "Rate Workspace",
        workspaceSlug: `rate-workspace-${suffix}`,
        apiKeyLabel: "rate-key"
      }
    });

    expect(bootstrapResponse.statusCode).toBe(200);
    const bootstrap = bootstrapResponse.json();
    const headers = {
      "x-api-key": bootstrap.rawApiKey
    };

    for (let index = 0; index < 30; index += 1) {
      const response = await app.inject({
        method: "GET",
        url: "/api/runtime/providers",
        headers
      });
      expect(response.statusCode).toBe(200);
    }

    const blocked = await app.inject({
      method: "GET",
      url: "/api/runtime/providers",
      headers
    });

    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().code).toBe("rate_limited");
  }, 30_000);
});
