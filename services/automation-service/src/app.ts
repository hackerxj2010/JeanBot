import Fastify from "fastify";

import {
  assertInternalRequest,
  authContextFromHeaders,
  loadPlatformConfig
} from "@jeanbot/platform";
import { captureException, initTelemetry, metrics, recordCounter, recordDuration } from "@jeanbot/telemetry";

import { AutomationService } from "./index.js";

export const buildAutomationServiceApp = () => {
  const app = Fastify();
  const service = new AutomationService();
  const config = loadPlatformConfig();
  const requestTimings = new WeakMap<object, number>();
  initTelemetry("automation-service");

  app.addHook("onRequest", async (request) => {
    requestTimings.set(request, Date.now());
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = requestTimings.get(request) ?? Date.now();
    const route = request.routeOptions.url ?? request.url.split("?")[0];
    const labels = {
      service: "automation-service",
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
      service: "automation-service",
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

  app.post("/internal/heartbeats", async (request) => {
    assertInternalRequest(request.headers as Record<string, string | string[] | undefined>, config.internalServiceToken);
    return service.createHeartbeat(request.body as Parameters<AutomationService["createHeartbeat"]>[0]);
  });

  app.get("/internal/heartbeats", async (request) => {
    assertInternalRequest(request.headers as Record<string, string | string[] | undefined>, config.internalServiceToken);
    return service.listHeartbeats();
  });

  app.get("/internal/heartbeats/:heartbeatId/history", async (request) => {
    assertInternalRequest(request.headers as Record<string, string | string[] | undefined>, config.internalServiceToken);
    const params = request.params as { heartbeatId: string };
    return service.listHeartbeatHistory(params.heartbeatId);
  });

  app.put("/internal/heartbeats/:heartbeatId", async (request) => {
    assertInternalRequest(request.headers as Record<string, string | string[] | undefined>, config.internalServiceToken);
    const params = request.params as { heartbeatId: string };
    return service.updateHeartbeat(params.heartbeatId, request.body as {
      name?: string;
      schedule?: string;
      objective?: string;
      active?: boolean;
    });
  });

  app.post("/internal/heartbeats/:heartbeatId/pause", async (request) => {
    assertInternalRequest(request.headers as Record<string, string | string[] | undefined>, config.internalServiceToken);
    const params = request.params as { heartbeatId: string };
    return service.pauseHeartbeat(params.heartbeatId);
  });

  app.post("/internal/heartbeats/:heartbeatId/resume", async (request) => {
    assertInternalRequest(request.headers as Record<string, string | string[] | undefined>, config.internalServiceToken);
    const params = request.params as { heartbeatId: string };
    return service.resumeHeartbeat(params.heartbeatId);
  });

  app.post("/internal/heartbeats/:heartbeatId/trigger", async (request) => {
    assertInternalRequest(request.headers as Record<string, string | string[] | undefined>, config.internalServiceToken);
    const params = request.params as { heartbeatId: string };
    const authContext = authContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    return service.triggerHeartbeat(params.heartbeatId, {
      requestedBy: authContext?.userId,
      triggerKind: "manual"
    });
  });

  return {
    app,
    service
  };
};
