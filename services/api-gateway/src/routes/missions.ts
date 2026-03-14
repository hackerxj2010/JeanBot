import type { FastifyInstance } from "fastify";

import type { ServiceAuthContext, UsageEventRecord } from "@jeanbot/types";

export const registerMissionRoutes = (
  app: FastifyInstance,
  services: import("../services/gateway-services.js").GatewayServices
) => {
  const authContextOf = (request: unknown) => {
    return (request as { authContext?: ServiceAuthContext }).authContext;
  };

  app.post("/api/bootstrap", async (request) => {
    return services.bootstrap(request.body as Parameters<typeof services.bootstrap>[0]);
  });

  app.post("/api/auth/session/exchange", async (request) => {
    const body = request.body as { apiKey: string };
    return services.exchangeApiKeyForSession(body.apiKey);
  });

  app.post("/api/auth/session/refresh", async (request) => {
    const body = request.body as { refreshToken: string };
    return services.refreshSession(body.refreshToken);
  });

  app.post("/api/missions", async (request) => {
    return services.createMission(request.body, authContextOf(request));
  });

  app.post("/api/missions/:missionId/plan", async (request) => {
    const params = request.params as { missionId: string };
    return services.planMission(params.missionId, authContextOf(request));
  });

  app.post("/api/missions/:missionId/run", async (request) => {
    const params = request.params as { missionId: string };
    const body = (request.body ?? {}) as { workspaceRoot?: string };
    return services.runMission(
      params.missionId,
      body.workspaceRoot ?? "./workspace/users/{userId}",
      authContextOf(request)
    );
  });

  app.post("/api/missions/:missionId/approvals/:approvalId/approve", async (request) => {
    const params = request.params as { missionId: string; approvalId: string };
    const authContext = authContextOf(request);
    if (!authContext) {
      throw new Error("Authentication is required to approve missions.");
    }

    return services.approveMission(params.missionId, params.approvalId, authContext);
  });

  app.get("/api/missions/:missionId", async (request) => {
    const params = request.params as { missionId: string };
    return services.getMission(params.missionId, authContextOf(request));
  });

  app.get("/api/missions/:missionId/execution", async (request) => {
    const params = request.params as { missionId: string };
    return services.missionExecutionTelemetry(params.missionId, authContextOf(request));
  });

  app.get("/api/missions", async (request) => {
    return services.listMissions(authContextOf(request));
  });

  app.get("/api/capabilities", async (request) => {
    return services.listCapabilities(authContextOf(request));
  });

  app.get("/api/tools", async (request) => {
    return services.listTools(authContextOf(request));
  });

  app.post("/api/tools/execute", async (request) => {
    return services.executeTool(
      request.body as Parameters<typeof services.executeTool>[0],
      authContextOf(request)
    );
  });

  app.post("/api/tools/batch", async (request) => {
    return services.executeToolBatch(
      request.body as Parameters<typeof services.executeToolBatch>[0],
      authContextOf(request)
    );
  });

  app.get("/api/runtime/providers", async (request) => {
    return services.runtimeProviderStatus(authContextOf(request));
  });

  app.post("/api/runtime/execute", async (request) => {
    return services.executeRuntime(
      request.body as Parameters<typeof services.executeRuntime>[0],
      authContextOf(request)
    );
  });

  app.get("/api/runtime/sessions", async (request) => {
    const query = (request.query ?? {}) as { workspaceId?: string };
    return services.listRuntimeSessions(query.workspaceId, authContextOf(request));
  });

  app.get("/api/runtime/sessions/:sessionId", async (request) => {
    const params = request.params as { sessionId: string };
    return services.getRuntimeSession(params.sessionId, authContextOf(request));
  });

  app.get("/api/workspaces/:workspaceId/memory", async (request) => {
    const params = request.params as { workspaceId: string };
    return services.workspaceMemory(params.workspaceId, authContextOf(request));
  });

  app.post("/api/workspaces/:workspaceId/memory/search", async (request) => {
    const params = request.params as { workspaceId: string };
    const body = request.body as {
      query: string;
      limit?: number;
      injectLimit?: number;
      sourceKinds?: Array<"memory" | "knowledge">;
    };
    return services.searchWorkspaceMemory(
      params.workspaceId,
      {
        query: body.query,
        limit: body.limit,
        injectLimit: body.injectLimit,
        sourceKinds: body.sourceKinds
      },
      authContextOf(request)
    );
  });

  app.get("/api/workspaces/:workspaceId/knowledge", async (request) => {
    const params = request.params as { workspaceId: string };
    return services.listKnowledgeDocuments(params.workspaceId, authContextOf(request));
  });

  app.post("/api/workspaces/:workspaceId/knowledge", async (request) => {
    const params = request.params as { workspaceId: string };
    const body = request.body as {
      title: string;
      body: string;
      metadata?: Record<string, unknown>;
    };
    return services.ingestKnowledge(
      params.workspaceId,
      {
        title: body.title,
        body: body.body,
        metadata: body.metadata
      },
      authContextOf(request)
    );
  });

  app.post("/api/workspaces/:workspaceId/knowledge/query", async (request) => {
    const params = request.params as { workspaceId: string };
    const body = request.body as { term: string; limit?: number };
    return services.queryKnowledge(
      params.workspaceId,
      body.term,
      body.limit,
      authContextOf(request)
    );
  });

  app.post("/api/workspaces/:workspaceId/knowledge/search", async (request) => {
    const params = request.params as { workspaceId: string };
    const body = request.body as { query: string; limit?: number; injectLimit?: number };
    return services.searchKnowledge(
      params.workspaceId,
      {
        query: body.query,
        limit: body.limit,
        injectLimit: body.injectLimit
      },
      authContextOf(request)
    );
  });

  app.get("/api/workspaces/:workspaceId/knowledge/export", async (request) => {
    const params = request.params as { workspaceId: string };
    return services.exportKnowledge(params.workspaceId, authContextOf(request));
  });

  app.get("/api/workspaces/:workspaceId/quota", async (request) => {
    const params = request.params as { workspaceId: string };
    return services.workspaceQuota(params.workspaceId, authContextOf(request));
  });

  app.get("/api/workspaces/:workspaceId/billing/usage", async (request) => {
    const params = request.params as { workspaceId: string };
    const query = (request.query ?? {}) as {
      metric?: UsageEventRecord["metric"];
      limit?: string;
    };
    return services.workspaceUsage(
      params.workspaceId,
      {
        metric: query.metric,
        limit: query.limit ? Number(query.limit) : undefined
      },
      authContextOf(request)
    );
  });

  app.get("/api/audit", async (request) => {
    const query = (request.query ?? {}) as { entityId?: string };
    return services.listAuditEvents(query.entityId, authContextOf(request));
  });

  app.post("/api/heartbeats", async (request) => {
    const body = request.body as {
      workspaceId: string;
      name: string;
      schedule: string;
      objective: string;
      active?: boolean;
    };

    return services.createHeartbeat(
      {
        workspaceId: body.workspaceId,
        name: body.name,
        schedule: body.schedule,
        objective: body.objective,
        active: body.active ?? true
      },
      authContextOf(request)
    );
  });

  app.get("/api/heartbeats", async (request) => {
    return services.listHeartbeats(authContextOf(request));
  });

  app.put("/api/heartbeats/:heartbeatId", async (request) => {
    const params = request.params as { heartbeatId: string };
    return services.updateHeartbeat(
      params.heartbeatId,
      request.body as {
        name?: string;
        schedule?: string;
        objective?: string;
        active?: boolean;
      },
      authContextOf(request)
    );
  });

  app.post("/api/heartbeats/:heartbeatId/pause", async (request) => {
    const params = request.params as { heartbeatId: string };
    return services.pauseHeartbeat(params.heartbeatId, authContextOf(request));
  });

  app.post("/api/heartbeats/:heartbeatId/resume", async (request) => {
    const params = request.params as { heartbeatId: string };
    return services.resumeHeartbeat(params.heartbeatId, authContextOf(request));
  });

  app.post("/api/heartbeats/:heartbeatId/trigger", async (request) => {
    const params = request.params as { heartbeatId: string };
    return services.triggerHeartbeat(params.heartbeatId, authContextOf(request));
  });

  app.get("/api/heartbeats/:heartbeatId/history", async (request) => {
    const params = request.params as { heartbeatId: string };
    return services.listHeartbeatHistory(params.heartbeatId, authContextOf(request));
  });

  app.post("/api/browser/navigate", async (request) => {
    return services.browserNavigate(
      request.body as {
        workspaceId: string;
        url: string;
        sessionId?: string;
      },
      authContextOf(request)
    );
  });

  app.post("/api/browser/click", async (request) => {
    return services.browserClick(
      request.body as {
        sessionId: string;
        workspaceId: string;
        selector?: string;
        x?: number;
        y?: number;
      },
      authContextOf(request)
    );
  });

  app.post("/api/browser/fill", async (request) => {
    return services.browserFill(
      request.body as {
        sessionId: string;
        workspaceId: string;
        selector?: string;
        value?: string;
      },
      authContextOf(request)
    );
  });

  app.post("/api/browser/extract", async (request) => {
    return services.browserExtract(
      request.body as {
        sessionId: string;
        workspaceId: string;
        selector?: string;
        kind?: "text" | "links" | "html";
      },
      authContextOf(request)
    );
  });

  app.post("/api/browser/capture", async (request) => {
    return services.browserCapture(
      request.body as {
        sessionId: string;
        workspaceId: string;
        fullPage?: boolean;
      },
      authContextOf(request)
    );
  });

  app.get("/api/browser/sessions", async (request) => {
    return services.listBrowserSessions(authContextOf(request));
  });

  app.get("/api/browser/sessions/:sessionId", async (request) => {
    const params = request.params as { sessionId: string };
    return services.getBrowserSession(params.sessionId, authContextOf(request));
  });

  app.get("/api/browser/sessions/:sessionId/events", async (request) => {
    const params = request.params as { sessionId: string };
    return services.listBrowserSessionEvents(params.sessionId, authContextOf(request));
  });

  app.get("/api/browser/sessions/:sessionId/stream-info", async (request) => {
    const params = request.params as { sessionId: string };
    return services.browserStreamInfo(params.sessionId, authContextOf(request));
  });

  app.delete("/api/browser/sessions/:sessionId", async (request) => {
    const params = request.params as { sessionId: string };
    return services.closeBrowserSession(params.sessionId, authContextOf(request));
  });

  app.post("/api/terminal/run", async (request) => {
    return services.terminalRun(
      request.body as {
        workspaceId: string;
        command: string;
        cwd?: string;
        timeoutMs?: number;
      },
      authContextOf(request)
    );
  });

  app.post("/api/terminal/background", async (request) => {
    return services.terminalRunBackground(
      request.body as {
        workspaceId: string;
        command: string;
        cwd?: string;
        timeoutMs?: number;
      },
      authContextOf(request)
    );
  });

  app.get("/api/terminal/executions", async (request) => {
    const query = (request.query ?? {}) as { workspaceId?: string };
    return services.listTerminalExecutions(query.workspaceId, authContextOf(request));
  });

  app.get("/api/terminal/executions/:executionId", async (request) => {
    const params = request.params as { executionId: string };
    return services.getTerminalExecution(params.executionId, authContextOf(request));
  });

  app.get("/api/terminal/executions/:executionId/output", async (request) => {
    const params = request.params as { executionId: string };
    return services.getTerminalExecutionOutput(params.executionId, authContextOf(request));
  });

  app.get("/api/terminal/background", async (request) => {
    const query = (request.query ?? {}) as { workspaceId?: string };
    return services.listTerminalBackgroundJobs(query.workspaceId, authContextOf(request));
  });

  app.post("/api/terminal/watch", async (request) => {
    return services.watchTerminalWorkspace(
      request.body as {
        workspaceId: string;
        cwd: string;
      },
      authContextOf(request)
    );
  });

  app.get("/api/terminal/watches", async (request) => {
    const query = (request.query ?? {}) as { workspaceId?: string };
    return services.listTerminalWatches(query.workspaceId, authContextOf(request));
  });

  app.get("/api/api-keys", async (request) => {
    const authContext = authContextOf(request);
    if (!authContext) {
      throw new Error("Authentication is required to list API keys.");
    }

    return services.listApiKeys(authContext);
  });

  app.get("/api/roles", async (request) => {
    const authContext = authContextOf(request);
    if (!authContext) {
      throw new Error("Authentication is required to list roles.");
    }

    return services.listRoles(authContext);
  });

  app.post("/api/roles", async (request) => {
    const authContext = authContextOf(request);
    if (!authContext) {
      throw new Error("Authentication is required to create roles.");
    }

    const body = request.body as { name: string; permissions: string[] };
    return services.createRole(body, authContext);
  });

  app.get("/api/workspaces", async (request) => {
    const authContext = authContextOf(request);
    if (!authContext) {
      throw new Error("Authentication is required to list workspaces.");
    }

    return services.listWorkspaces(authContext);
  });

  app.post("/api/workspaces", async (request) => {
    const authContext = authContextOf(request);
    if (!authContext) {
      throw new Error("Authentication is required to create workspaces.");
    }

    const body = request.body as { name: string; slug: string; roleIds?: string[] };
    return services.createWorkspace(body, authContext);
  });

  app.get("/api/workspaces/:workspaceId/memberships", async (request) => {
    const authContext = authContextOf(request);
    if (!authContext) {
      throw new Error("Authentication is required to list memberships.");
    }

    const params = request.params as { workspaceId: string };
    return services.listWorkspaceMemberships(params.workspaceId, authContext);
  });

  app.post("/api/workspaces/:workspaceId/memberships", async (request) => {
    const authContext = authContextOf(request);
    if (!authContext) {
      throw new Error("Authentication is required to add memberships.");
    }

    const params = request.params as { workspaceId: string };
    const body = request.body as { userId: string; roleIds: string[] };
    return services.addWorkspaceMembership(params.workspaceId, body, authContext);
  });

  app.put("/api/workspaces/:workspaceId/memberships/:membershipId/roles", async (request) => {
    const authContext = authContextOf(request);
    if (!authContext) {
      throw new Error("Authentication is required to update membership roles.");
    }

    const params = request.params as { workspaceId: string; membershipId: string };
    const body = request.body as { roleIds: string[] };
    return services.updateWorkspaceMembershipRoles(
      params.workspaceId,
      params.membershipId,
      body.roleIds,
      authContext
    );
  });

  app.get("/api/workspaces/:workspaceId/communication/messages", async (request) => {
    const params = request.params as { workspaceId: string };
    return services.listCommunicationMessages(params.workspaceId, authContextOf(request));
  });

  app.get("/api/workspaces/:workspaceId/notifications", async (request) => {
    const params = request.params as { workspaceId: string };
    return services.listNotifications(params.workspaceId, authContextOf(request));
  });

  app.get("/api/workspaces/:workspaceId/integrations", async (request) => {
    const params = request.params as { workspaceId: string };
    return services.listWorkspaceIntegrations(params.workspaceId, authContextOf(request));
  });

  app.post("/api/workspaces/:workspaceId/integrations/:provider/connect", async (request) => {
    const params = request.params as { workspaceId: string; provider: "gmail" | "github" };
    const body = request.body as { redirectUri: string };
    return services.startWorkspaceIntegration(
      params.workspaceId,
      params.provider,
      {
        redirectUri: body.redirectUri
      },
      authContextOf(request)
    );
  });

  app.post("/api/workspaces/:workspaceId/integrations/:provider/callback", async (request) => {
    const params = request.params as { workspaceId: string; provider: "gmail" | "github" };
    const body = request.body as {
      code: string;
      state: string;
      redirectUri: string;
    };
    return services.completeWorkspaceIntegration(
      params.workspaceId,
      params.provider,
      body,
      authContextOf(request)
    );
  });

  app.delete("/api/workspaces/:workspaceId/integrations/:provider", async (request) => {
    const params = request.params as { workspaceId: string; provider: "gmail" | "github" };
    return services.disconnectWorkspaceIntegration(
      params.workspaceId,
      params.provider,
      authContextOf(request)
    );
  });

  app.post("/api/workspaces/:workspaceId/communication/draft", async (request) => {
    const params = request.params as { workspaceId: string };
    const body = request.body as {
      channel: "email" | "slack" | "push";
      target: string;
      subject: string;
      body: string;
      metadata?: Record<string, unknown>;
    };

    return services.draftCommunicationMessage(
      params.workspaceId,
      {
        channel: body.channel,
        target: body.target,
        subject: body.subject,
        body: body.body,
        metadata: body.metadata ?? {}
      },
      authContextOf(request)
    );
  });

  app.post("/api/workspaces/:workspaceId/communication/send", async (request) => {
    const params = request.params as { workspaceId: string };
    const body = request.body as {
      channel: "email" | "slack" | "push";
      target: string;
      subject: string;
      body: string;
      metadata?: Record<string, unknown>;
    };

    return services.sendCommunicationMessage(
      params.workspaceId,
      {
        channel: body.channel,
        target: body.target,
        subject: body.subject,
        body: body.body,
        metadata: body.metadata ?? {}
      },
      authContextOf(request)
    );
  });

  app.get("/api/billing/plans", async (request) => {
    return services.listBillingPlans(authContextOf(request));
  });

  app.get("/api/workspaces/:workspaceId/billing", async (request) => {
    const params = request.params as { workspaceId: string };
    return services.workspaceBilling(params.workspaceId, authContextOf(request));
  });

  app.post("/api/workspaces/:workspaceId/billing", async (request) => {
    const params = request.params as { workspaceId: string };
    const body = request.body as {
      planId: string;
      stripeCustomerId?: string;
    };
    return services.updateWorkspaceBilling(
      params.workspaceId,
      {
        planId: body.planId,
        stripeCustomerId: body.stripeCustomerId
      },
      authContextOf(request)
    );
  });

  app.post("/api/workspaces/:workspaceId/billing/portal", async (request) => {
    const params = request.params as { workspaceId: string };
    return services.createBillingPortal(params.workspaceId, authContextOf(request));
  });

  app.get("/api/admin/tenants", async (request) => {
    return services.listAdminTenants(authContextOf(request));
  });

  app.get("/api/admin/workspaces/:workspaceId/quota-override", async (request) => {
    const params = request.params as { workspaceId: string };
    return services.getWorkspaceQuotaOverride(params.workspaceId, authContextOf(request));
  });

  app.put("/api/admin/workspaces/:workspaceId/quota-override", async (request) => {
    const params = request.params as { workspaceId: string };
    const body = request.body as {
      limits: Partial<
        Record<
          | "missions"
          | "memories"
          | "knowledgeDocuments"
          | "automations"
          | "browserMinutes"
          | "terminalSeconds",
          number
        >
      >;
      reason?: string;
    };
    return services.updateWorkspaceQuotaOverride(
      params.workspaceId,
      {
        limits: body.limits,
        reason: body.reason
      },
      authContextOf(request)
    );
  });
};
