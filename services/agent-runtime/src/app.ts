import Fastify from "fastify";

import { assertInternalRequest, loadPlatformConfig } from "@jeanbot/platform";
import { captureException, initTelemetry, metrics, recordCounter, recordDuration } from "@jeanbot/telemetry";

import { AgentRuntimeService } from "./index.js";

export const buildAgentRuntimeApp = () => {
  const app = Fastify();
  const service = new AgentRuntimeService();
  const config = loadPlatformConfig();
  const requestTimings = new WeakMap<object, number>();
  initTelemetry("agent-runtime");

  app.addHook("onRequest", async (request) => {
    requestTimings.set(request, Date.now());
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = requestTimings.get(request) ?? Date.now();
    const route = request.routeOptions.url ?? request.url.split("?")[0];
    const labels = {
      service: "agent-runtime",
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
      service: "agent-runtime",
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

  app.post("/internal/runtime/provider", async (request) => {
    assertInternalRequest(request.headers as Record<string, string | string[] | undefined>, config.internalServiceToken);
    return service.executeProvider(request.body as Parameters<AgentRuntimeService["executeProvider"]>[0]);
  });

  app.get("/internal/runtime/providers", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    return service.providerStatus();
  });

  app.post("/internal/runtime/execute", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    return service.executeTask(request.body as Parameters<AgentRuntimeService["executeTask"]>[0]);
  });

  app.get("/internal/runtime/sessions", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const query = request.query as { workspaceId?: string | undefined };
    return service.listSessions(query.workspaceId);
  });

  app.get("/internal/runtime/sessions/:sessionId", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { sessionId: string };
    return service.getSession(params.sessionId);
  });

  return {
    app,
    service
  };
};
