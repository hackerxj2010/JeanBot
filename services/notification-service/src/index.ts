import crypto from "node:crypto";

import Fastify from "fastify";

import { CommunicationService } from "@jeanbot/communication-service";
import { createLogger } from "@jeanbot/logger";
import { createPersistenceBundle } from "@jeanbot/persistence";
import {
  assertInternalRequest,
  assertWorkspaceAccess,
  authContextFromHeaders,
  loadPlatformConfig
} from "@jeanbot/platform";
import { captureException, initTelemetry, metrics, recordCounter, recordDuration } from "@jeanbot/telemetry";
import type {
  NotificationChannel,
  NotificationRecord,
  ServiceHealth,
  TaskNotificationRequest
} from "@jeanbot/types";

const dedupe = <T>(values: T[]) => [...new Set(values)];

export class NotificationService {
  private readonly logger = createLogger("notification-service");
  private readonly persistence = createPersistenceBundle();
  private readonly communication = new CommunicationService();
  private readonly config = loadPlatformConfig();

  private async userFor(userId: string) {
    return this.persistence.identity.getUserById(userId);
  }

  private modeFor(channel: NotificationChannel) {
    if (channel === "email") {
      return process.env.RESEND_API_KEY ? ("live" as const) : ("synthetic" as const);
    }

    return this.config.nodeEnv === "production" && process.env.PUSH_GATEWAY_URL
      ? ("live" as const)
      : ("synthetic" as const);
  }

  private async persistStatus(
    record: NotificationRecord,
    patch: Partial<NotificationRecord>
  ) {
    return this.persistence.notifications.save({
      ...record,
      ...patch
    });
  }

  private async deliverEmail(record: NotificationRecord) {
    try {
      await this.communication.sendMessage({
        workspaceId: record.workspaceId,
        tenantId: record.tenantId,
        channel: "email",
        target: record.target,
        subject: record.subject,
        body: record.body,
        metadata: {
          ...record.metadata,
          notificationId: record.id,
          eventType: record.eventType
        }
      });
      return this.persistStatus(record, {
        status: "sent",
        sentAt: new Date().toISOString(),
        error: undefined
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.persistStatus(record, {
        status: "failed",
        error: message
      });
    }
  }

  private async deliverPush(record: NotificationRecord) {
    if (!process.env.PUSH_GATEWAY_URL) {
      return this.persistStatus(record, {
        status: "sent",
        sentAt: new Date().toISOString(),
        error: undefined
      });
    }

    try {
      const response = await fetch(process.env.PUSH_GATEWAY_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          userId: record.userId,
          workspaceId: record.workspaceId,
          title: record.subject,
          body: record.body,
          metadata: {
            ...record.metadata,
            notificationId: record.id,
            eventType: record.eventType
          }
        })
      });
      if (!response.ok) {
        throw new Error(`Push gateway rejected notification with status ${response.status}.`);
      }
      return this.persistStatus(record, {
        status: "sent",
        sentAt: new Date().toISOString(),
        error: undefined
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.persistStatus(record, {
        status: "failed",
        error: message
      });
    }
  }

  private async createRecord(
    input: TaskNotificationRequest,
    channel: NotificationChannel,
    target: string
  ) {
    const record: NotificationRecord = {
      id: crypto.randomUUID(),
      tenantId: undefined,
      workspaceId: input.workspaceId,
      userId: input.userId,
      channel,
      eventType: input.eventType,
      target,
      subject: input.subject,
      body: input.body,
      status: "queued",
      mode: this.modeFor(channel),
      metadata: input.metadata ?? {},
      createdAt: new Date().toISOString()
    };
    return this.persistence.notifications.save(record);
  }

  async notifyUserTaskCompletion(input: TaskNotificationRequest) {
    const user = await this.userFor(input.userId);
    const channels: NotificationChannel[] = dedupe(input.channels ?? ["email", "push"]);
    const sent: NotificationRecord[] = [];

    for (const channel of channels) {
      if (channel === "email" && !user?.email) {
        const skipped = await this.persistence.notifications.save({
          id: crypto.randomUUID(),
          tenantId: user?.tenantId,
          workspaceId: input.workspaceId,
          userId: input.userId,
          channel,
          eventType: input.eventType,
          target: "",
          subject: input.subject,
          body: input.body,
          status: "skipped",
          mode: this.modeFor(channel),
          metadata: {
            ...(input.metadata ?? {}),
            reason: "missing_email"
          },
          createdAt: new Date().toISOString()
        });
        sent.push(skipped);
        continue;
      }

      const queued = await this.createRecord(
        input,
        channel,
        channel === "email" ? user?.email ?? "" : input.userId
      );
      const delivered =
        channel === "email"
          ? await this.deliverEmail({
              ...queued,
              tenantId: user?.tenantId
            })
          : await this.deliverPush({
              ...queued,
              tenantId: user?.tenantId
            });
      sent.push(delivered);
    }

    this.logger.info("Delivered task completion notifications", {
      workspaceId: input.workspaceId,
      userId: input.userId,
      eventType: input.eventType,
      count: sent.length
    });
    return sent;
  }

  async notifyWorkspaceMembers(input: {
    workspaceId: string;
    eventType: TaskNotificationRequest["eventType"];
    subject: string;
    body: string;
    metadata?: Record<string, unknown> | undefined;
    channels?: NotificationChannel[] | undefined;
    roleIds?: string[] | undefined;
  }) {
    const memberships = await this.persistence.identity.listMembershipsForWorkspace(input.workspaceId);
    const allowedRoles = new Set(input.roleIds ?? ["admin", "operator"]);
    const recipients = dedupe(
      memberships
        .filter((membership) => membership.roleIds.some((roleId) => allowedRoles.has(roleId)))
        .map((membership) => membership.userId)
    );

    const all = await Promise.all(
      recipients.map((userId) =>
        this.notifyUserTaskCompletion({
          workspaceId: input.workspaceId,
          userId,
          eventType: input.eventType,
          subject: input.subject,
          body: input.body,
          metadata: input.metadata,
          channels: input.channels
        })
      )
    );
    return all.flat();
  }

  async listNotifications(workspaceId: string, userId?: string) {
    return this.persistence.notifications.list(workspaceId, userId);
  }

  health(): ServiceHealth {
    return {
      name: "notification-service",
      ok: true,
      details: {
        persistenceMode: this.persistence.mode,
        pushConfigured: Boolean(process.env.PUSH_GATEWAY_URL)
      },
      readiness: {
        notifications: {
          ok: true,
          status: "ready",
          message: process.env.PUSH_GATEWAY_URL
            ? "Email and push notification paths are available."
            : "Email delivery is available; push falls back to synthetic mode."
        }
      },
      metricsPath: "/metrics"
    };
  }
}

export const buildNotificationServiceApp = () => {
  const app = Fastify();
  const service = new NotificationService();
  const config = loadPlatformConfig();
  const requestTimings = new WeakMap<object, number>();
  initTelemetry("notification-service");

  app.addHook("onRequest", async (request) => {
    requestTimings.set(request, Date.now());
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = requestTimings.get(request) ?? Date.now();
    const route = request.routeOptions.url ?? request.url.split("?")[0];
    const labels = {
      service: "notification-service",
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
      service: "notification-service",
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

  app.post("/internal/notifications/task-completed", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    return service.notifyUserTaskCompletion(request.body as TaskNotificationRequest);
  });

  app.post("/internal/notifications/workspaces/:workspaceId/broadcast", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string };
    return service.notifyWorkspaceMembers({
      workspaceId: params.workspaceId,
      ...(request.body as Omit<
        Parameters<NotificationService["notifyWorkspaceMembers"]>[0],
        "workspaceId"
      >)
    });
  });

  app.get("/internal/notifications/workspaces/:workspaceId", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string };
    const query = (request.query ?? {}) as { userId?: string };
    const authContext = authContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    assertWorkspaceAccess(authContext, params.workspaceId);
    return service.listNotifications(params.workspaceId, query.userId);
  });

  return {
    app,
    service
  };
};
