import crypto from "node:crypto";

import Fastify from "fastify";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import type { FastifyRequest } from "fastify";

import { SlidingWindowRateLimiter } from "@jeanbot/cache";
import { createLogger } from "@jeanbot/logger";
import { captureException, initTelemetry, metrics, recordCounter, recordDuration } from "@jeanbot/telemetry";
import { isJeanbotError, loadPlatformConfig } from "@jeanbot/platform";
import type { ServiceAuthContext } from "@jeanbot/types";

import { registerMissionRoutes } from "./routes/missions.js";
import { buildGatewayServices } from "./services/gateway-services.js";
import { registerSystemRoutes } from "./routes/system.js";
import { appRouter } from "./trpc/router.js";

declare module "fastify" {
  interface FastifyRequest {
    authContext?: ServiceAuthContext;
    correlationId: string;
    startedAt: number;
  }
}

const publicRoutes = new Set([
  "/health",
  "/system/summary",
  "/metrics",
  "/api/bootstrap",
  "/api/auth/session/exchange",
  "/api/auth/session/refresh"
]);

const isPublicPath = (url: string) => {
  const path = url.split("?")[0];
  return (
    publicRoutes.has(path) ||
    path.startsWith("/trpc/health") ||
    path.startsWith("/trpc/summary") ||
    path.startsWith("/trpc/bootstrap")
  );
};

const requiredPermissionFor = (request: FastifyRequest) => {
  const route = request.routeOptions.url;
  const method = request.method.toUpperCase();
  if (route === "/api/missions" && method === "POST") {
    return "missions:write";
  }

  if (route === "/api/missions" && method === "GET") {
    return "missions:read";
  }

  if (route === "/api/missions/:missionId" && method === "GET") {
    return "missions:read";
  }

  if (route === "/api/missions/:missionId/plan") {
    return "missions:write";
  }

  if (route === "/api/missions/:missionId/run") {
    return "missions:execute";
  }

  if (route === "/api/missions/:missionId/approvals/:approvalId/approve") {
    return "missions:approve";
  }

  if (route === "/api/audit") {
    return "audit:read";
  }

  if (
    route === "/api/tools" ||
    route === "/api/tools/execute" ||
    route === "/api/tools/batch"
  ) {
    return "tools:use";
  }

  if (
    route === "/api/browser/navigate" ||
    route === "/api/browser/click" ||
    route === "/api/browser/fill" ||
    route === "/api/browser/extract" ||
    route === "/api/browser/capture" ||
    route === "/api/browser/sessions" ||
    route === "/api/browser/sessions/:sessionId" ||
    route === "/api/browser/sessions/:sessionId/events" ||
    route === "/api/browser/sessions/:sessionId/stream-info" ||
    route === "/api/runtime/providers" ||
    route === "/api/runtime/execute" ||
    route === "/api/runtime/sessions" ||
    route === "/api/runtime/sessions/:sessionId" ||
    route === "/api/terminal/run" ||
    route === "/api/terminal/background" ||
    route === "/api/terminal/executions" ||
    route === "/api/terminal/executions/:executionId" ||
    route === "/api/terminal/executions/:executionId/output" ||
    route === "/api/terminal/watch" ||
    route === "/api/terminal/watches"
  ) {
    return "tools:use";
  }

  if (route === "/api/capabilities") {
    return "missions:read";
  }

  if (route === "/api/workspaces/:workspaceId/memory") {
    return "missions:read";
  }

  if (route === "/api/workspaces/:workspaceId/memory/search") {
    return "missions:read";
  }

  if (
    route === "/api/workspaces/:workspaceId/knowledge" &&
    method === "GET"
  ) {
    return "knowledge:read";
  }

  if (
    route === "/api/workspaces/:workspaceId/knowledge" &&
    method === "POST"
  ) {
    return "knowledge:write";
  }

  if (route === "/api/workspaces/:workspaceId/knowledge/query") {
    return "knowledge:read";
  }

  if (route === "/api/workspaces/:workspaceId/knowledge/search") {
    return "knowledge:read";
  }

  if (route === "/api/workspaces/:workspaceId/knowledge/export") {
    return "knowledge:read";
  }

  if (route === "/api/workspaces/:workspaceId/communication/messages") {
    return "communication:read";
  }

  if (
    route === "/api/workspaces/:workspaceId/integrations" ||
    route === "/api/workspaces/:workspaceId/integrations/:provider/connect" ||
    route === "/api/workspaces/:workspaceId/integrations/:provider/callback" ||
    route === "/api/workspaces/:workspaceId/integrations/:provider"
  ) {
    return "tools:use";
  }

  if (
    route === "/api/workspaces/:workspaceId/communication/draft" ||
    route === "/api/workspaces/:workspaceId/communication/send"
  ) {
    return "communication:send";
  }

  if (route === "/api/workspaces/:workspaceId/notifications") {
    return "missions:read";
  }

  if (
    route === "/api/heartbeats" ||
    route === "/api/heartbeats/:heartbeatId" ||
    route === "/api/heartbeats/:heartbeatId/pause" ||
    route === "/api/heartbeats/:heartbeatId/resume" ||
    route === "/api/heartbeats/:heartbeatId/trigger" ||
    route === "/api/heartbeats/:heartbeatId/history"
  ) {
    return "heartbeats:manage";
  }

  if (route === "/api/api-keys") {
    return "apikeys:manage";
  }

  if (route === "/api/roles" || route === "/api/workspaces") {
    return "workspaces:manage";
  }

  if (
    route === "/api/workspaces/:workspaceId/memberships" ||
    route === "/api/workspaces/:workspaceId/memberships/:membershipId/roles"
  ) {
    return "workspaces:manage";
  }

  if (
    route === "/api/billing/plans" ||
    route === "/api/workspaces/:workspaceId/quota" ||
    route === "/api/workspaces/:workspaceId/billing/usage" ||
    route === "/api/workspaces/:workspaceId/billing" ||
    route === "/api/workspaces/:workspaceId/billing/portal"
  ) {
    return "billing:read";
  }

  if (
    route === "/api/admin/tenants" ||
    route === "/api/admin/workspaces/:workspaceId/quota-override"
  ) {
    return "admin:manage";
  }

  return undefined;
};

const rateLimitRuleFor = (request: FastifyRequest) => {
  const route = request.routeOptions.url ?? request.url.split("?")[0];
  if (
    route === "/api/tools/execute" ||
    route === "/api/tools/batch" ||
    route === "/api/runtime/providers" ||
    route === "/api/runtime/execute" ||
    route === "/api/browser/navigate" ||
    route === "/api/browser/click" ||
    route === "/api/browser/fill" ||
    route === "/api/browser/extract" ||
    route === "/api/browser/capture" ||
    route === "/api/terminal/run" ||
    route === "/api/terminal/background" ||
    route === "/api/missions/:missionId/run"
  ) {
    return {
      segment: "interactive",
      limit: 30,
      windowMs: 60_000
    };
  }

  if (
    route === "/api/missions" ||
    route === "/api/missions/:missionId/plan" ||
    route === "/api/heartbeats" ||
    route === "/api/heartbeats/:heartbeatId/trigger"
  ) {
    return {
      segment: "operations",
      limit: 60,
      windowMs: 60_000
    };
  }

  return {
    segment: "default",
    limit: 120,
    windowMs: 60_000
  };
};

export const buildApp = () => {
  const logger = createLogger("api-gateway");
  const config = loadPlatformConfig();
  const services = buildGatewayServices();
  const rateLimiter = new SlidingWindowRateLimiter({
    redisUrl: config.redisUrl,
    prefix: "jeanbot:gateway:ratelimit"
  });
  initTelemetry("api-gateway");
  const app = Fastify({
    logger: false
  });

  app.addHook("onRequest", async (request, reply) => {
    const correlationId =
      (typeof request.headers["x-request-id"] === "string" && request.headers["x-request-id"]) ||
      crypto.randomUUID();
    request.correlationId = correlationId;
    request.startedAt = Date.now();
    reply.header("x-request-id", correlationId);
    recordCounter("jeanbot_http_requests_total", "Total HTTP requests", {
      method: request.method
    });
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!isPublicPath(request.url)) {
      const apiKeyHeader = request.headers["x-api-key"];
      const rawApiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
      const authorizationHeader = request.headers.authorization;
      const bearerToken =
        typeof authorizationHeader === "string" && authorizationHeader.startsWith("Bearer ")
          ? authorizationHeader.slice("Bearer ".length).trim()
          : undefined;

      if (config.authRequired || rawApiKey || bearerToken) {
        if (!rawApiKey && !bearerToken) {
          reply.status(401);
          return reply.send({
            ok: false,
            error: "Missing authentication token."
          });
        }

        const verified = bearerToken
          ? await services.verifySession(bearerToken)
          : await services.verifyApiKey(String(rawApiKey));
        if (!verified) {
          reply.status(401);
          return reply.send({
            ok: false,
            error: bearerToken ? "Invalid session token." : "Invalid API key."
          });
        }

        request.authContext = verified.authContext;
        const rateLimit = await rateLimiter.consume(
          verified.authContext.userId,
          rateLimitRuleFor(request)
        );
        reply.header("x-ratelimit-limit", String(rateLimit.limit));
        reply.header("x-ratelimit-remaining", String(rateLimit.remaining));
        reply.header("x-ratelimit-reset", String(rateLimit.resetAt));
        if (!rateLimit.allowed) {
          recordCounter("jeanbot_http_rate_limited_total", "JeanBot rate limited requests", {
            route: request.routeOptions.url ?? request.url.split("?")[0],
            subject: "user"
          });
          reply.header("retry-after", String(Math.ceil(rateLimit.retryAfterMs / 1_000)));
          reply.status(429);
          return reply.send({
            ok: false,
            code: "rate_limited",
            error: "Rate limit exceeded for this user.",
            retryAfterMs: rateLimit.retryAfterMs
          });
        }

        const requiredPermission = requiredPermissionFor(request);
        if (
          requiredPermission &&
          !verified.authContext.permissions.includes(requiredPermission)
        ) {
          reply.status(403);
          return reply.send({
            ok: false,
            error: `Missing permission "${requiredPermission}".`
          });
        }
      }
    }
  });

  app.addHook("onResponse", async (request) => {
    recordDuration(
      "jeanbot_http_request_duration_ms",
      "JeanBot HTTP request duration",
      Date.now() - request.startedAt,
      {
        method: request.method,
        route: request.routeOptions.url ?? request.url.split("?")[0]
      }
    );
  });

  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : String(error);
    const statusCode = isJeanbotError(error) ? error.statusCode : 500;
    captureException(error);
    logger.error("API request failed", {
      error: message
    });

    void reply.status(statusCode).send({
      ok: false,
      code: isJeanbotError(error) ? error.code : "internal_error",
      error: message
    });
  });

  app.get("/metrics", async (_request, reply) => {
    reply.type("text/plain; version=0.0.4");
    return metrics();
  });

  registerSystemRoutes(app, services);
  registerMissionRoutes(app, services);

  app.addHook("onClose", async () => {
    await services.close();
    await rateLimiter.close();
  });

  void app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext({ req }: { req: FastifyRequest }) {
        return {
          authContext: req.authContext,
          correlationId: req.correlationId,
          services
        };
      }
    }
  });

  return {
    app,
    services
  };
};
