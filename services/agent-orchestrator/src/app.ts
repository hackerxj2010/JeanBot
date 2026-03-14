import Fastify from "fastify";

import { assertInternalRequest, authContextFromHeaders, loadPlatformConfig } from "@jeanbot/platform";
import { captureException, initTelemetry, metrics, recordCounter, recordDuration } from "@jeanbot/telemetry";

import { MissionOrchestrator } from "./index.js";

export const buildAgentOrchestratorApp = () => {
  const app = Fastify();
  const service = new MissionOrchestrator();
  const config = loadPlatformConfig();
  const requestTimings = new WeakMap<object, number>();
  initTelemetry("agent-orchestrator");

  app.addHook("onRequest", async (request) => {
    requestTimings.set(request, Date.now());
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = requestTimings.get(request) ?? Date.now();
    const route = request.routeOptions.url ?? request.url.split("?")[0];
    const labels = {
      service: "agent-orchestrator",
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
      service: "agent-orchestrator",
      route: request.routeOptions.url ?? request.url.split("?")[0]
    });
  });

  app.get("/health", async () => ({
    ok: true,
    services: service.health()
  }));

  app.get("/metrics", async (_request, reply) => {
    reply.type("text/plain; version=0.0.4");
    return metrics();
  });

  app.post("/internal/missions", async (request) => {
    assertInternalRequest(request.headers as Record<string, string | string[] | undefined>, config.internalServiceToken);
    const authContext = authContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    return service.createMission(request.body, authContext);
  });

  app.post("/internal/missions/:missionId/plan", async (request) => {
    assertInternalRequest(request.headers as Record<string, string | string[] | undefined>, config.internalServiceToken);
    const params = request.params as { missionId: string };
    return service.planMission(params.missionId);
  });

  app.post("/internal/missions/:missionId/run", async (request) => {
    assertInternalRequest(request.headers as Record<string, string | string[] | undefined>, config.internalServiceToken);
    const params = request.params as { missionId: string };
    const body = (request.body ?? {}) as {
      workspaceRoot?: string;
    };
    const authContext = authContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    return service.runMission(params.missionId, body.workspaceRoot ?? "./workspace/users/{userId}", authContext);
  });

  app.post("/internal/missions/:missionId/approvals/:approvalId/approve", async (request) => {
    assertInternalRequest(request.headers as Record<string, string | string[] | undefined>, config.internalServiceToken);
    const params = request.params as { missionId: string; approvalId: string };
    const body = request.body as { approverId: string };
    return service.approveMission(params.missionId, params.approvalId, body.approverId);
  });

  app.get("/internal/missions/:missionId", async (request) => {
    assertInternalRequest(request.headers as Record<string, string | string[] | undefined>, config.internalServiceToken);
    const params = request.params as { missionId: string };
    return service.getMission(params.missionId);
  });

  app.get("/internal/missions/:missionId/execution", async (request) => {
    assertInternalRequest(request.headers as Record<string, string | string[] | undefined>, config.internalServiceToken);
    const params = request.params as { missionId: string };
    return service.getMissionExecutionTelemetry(params.missionId);
  });

  app.get("/internal/missions", async (request) => {
    assertInternalRequest(request.headers as Record<string, string | string[] | undefined>, config.internalServiceToken);
    return service.listMissions();
  });

  app.get("/internal/capabilities", async (request) => {
    assertInternalRequest(request.headers as Record<string, string | string[] | undefined>, config.internalServiceToken);
    return service.listCapabilities();
  });

  app.get("/internal/tools", async (request) => {
    assertInternalRequest(request.headers as Record<string, string | string[] | undefined>, config.internalServiceToken);
    return service.listTools();
  });

  app.post("/internal/tools/execute", async (request) => {
    assertInternalRequest(request.headers as Record<string, string | string[] | undefined>, config.internalServiceToken);
    const authContext = authContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    return service.executeTool(
      request.body as Parameters<typeof service.executeTool>[0],
      authContext
    );
  });

  app.post("/internal/tools/batch", async (request) => {
    assertInternalRequest(request.headers as Record<string, string | string[] | undefined>, config.internalServiceToken);
    const authContext = authContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    return service.executeToolBatch(
      request.body as Parameters<typeof service.executeToolBatch>[0],
      authContext
    );
  });

  app.get("/internal/workspaces/:workspaceId/memory", async (request) => {
    assertInternalRequest(request.headers as Record<string, string | string[] | undefined>, config.internalServiceToken);
    const params = request.params as { workspaceId: string };
    return service.workspaceMemory(params.workspaceId);
  });

  app.get("/internal/audit", async (request) => {
    assertInternalRequest(request.headers as Record<string, string | string[] | undefined>, config.internalServiceToken);
    const query = (request.query ?? {}) as { entityId?: string };
    return service.listAuditEvents(query.entityId);
  });

  return {
    app,
    service
  };
};
