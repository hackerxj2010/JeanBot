import crypto from "node:crypto";

import { createLogger } from "@jeanbot/logger";
import { createPersistenceBundle } from "@jeanbot/persistence";
import { loadPlatformConfig } from "@jeanbot/platform";
import type {
  HeartbeatDefinition,
  HeartbeatExecutionRecord,
  QueueJob,
  ServiceHealth
} from "@jeanbot/types";

import { HeartbeatService } from "./heartbeat/heartbeat-service.js";

interface HeartbeatTriggerJobPayload {
  heartbeatId: string;
  executionId: string;
  triggerKind: "manual" | "schedule" | "event";
  requestedBy?: string | undefined;
}

export class AutomationService {
  private readonly logger = createLogger("automation-service");
  private readonly persistence = createPersistenceBundle();
  private readonly config = loadPlatformConfig();
  private readonly heartbeatService = new HeartbeatService();

  async createHeartbeat(input: Omit<HeartbeatDefinition, "id">) {
    const heartbeat: HeartbeatDefinition = {
      ...input,
      id: crypto.randomUUID()
    };

    return this.heartbeatService.register(heartbeat);
  }

  async updateHeartbeat(
    id: string,
    updates: Partial<Pick<HeartbeatDefinition, "name" | "schedule" | "objective" | "active">>
  ) {
    return this.heartbeatService.update(id, updates);
  }

  async pauseHeartbeat(id: string) {
    return this.heartbeatService.pause(id);
  }

  async resumeHeartbeat(id: string) {
    return this.heartbeatService.resume(id);
  }

  async getHeartbeat(id: string) {
    return this.heartbeatService.get(id);
  }

  async listHeartbeats() {
    return this.heartbeatService.list();
  }

  async listHeartbeatHistory(heartbeatId: string) {
    return this.heartbeatService.listHistory(heartbeatId);
  }

  onHeartbeat(listener: (heartbeat: HeartbeatDefinition) => void | Promise<void>) {
    this.heartbeatService.onTriggered(listener);
  }

  async triggerHeartbeat(
    id: string,
    options: {
      requestedBy?: string | undefined;
      triggerKind?: "manual" | "schedule" | "event" | undefined;
    } = {}
  ) {
    this.logger.info("Triggering heartbeat", {
      id,
      triggerKind: options.triggerKind ?? "manual",
      requestedBy: options.requestedBy
    });

    return this.heartbeatService.trigger(id, options);
  }

  async processHeartbeatJob(job: QueueJob<HeartbeatTriggerJobPayload>) {
    return this.heartbeatService.processTriggerJob(job);
  }

  async heartbeatSummary() {
    const [heartbeats, executions] = await Promise.all([
      this.heartbeatService.list(),
      this.persistence.heartbeatExecutions.list()
    ]);

    return {
      totalHeartbeats: heartbeats.length,
      activeHeartbeats: heartbeats.filter((heartbeat) => heartbeat.active).length,
      queuedExecutions: executions.filter((execution) => execution.status === "queued").length,
      runningExecutions: executions.filter((execution) => execution.status === "running").length,
      failedExecutions: executions.filter((execution) => execution.status === "failed").length,
      completedExecutions: executions.filter((execution) => execution.status === "completed").length
    };
  }

  health(): ServiceHealth {
    return {
      name: "automation-service",
      ok: true,
      details: {
        persistenceMode: this.persistence.mode,
        queueMode: this.config.queueMode,
        processMode: this.config.queueMode === "redis" ? "worker-backed" : "in-process"
      },
      readiness: {
        scheduler: {
          ok: true,
          status: "ready",
          message: "Heartbeat scheduler is initialized."
        }
      },
      metricsPath: "/metrics"
    };
  }

  async close() {
    await this.heartbeatService.close();
  }
}

export type { HeartbeatExecutionRecord };
