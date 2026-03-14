import crypto from "node:crypto";

import { Redis } from "ioredis";
import cron, { type ScheduledTask } from "node-cron";

import { EventBus } from "@jeanbot/events";
import { createLogger } from "@jeanbot/logger";
import { NotificationService } from "@jeanbot/notification-service";
import { createPersistenceBundle } from "@jeanbot/persistence";
import { loadPlatformConfig } from "@jeanbot/platform";
import {
  LocalJobQueue,
  RedisJobQueue,
  type JobQueueAdapter
} from "@jeanbot/queue";
import {
  embeddingContentHash
} from "@jeanbot/ai";
import type {
  HeartbeatDefinition,
  HeartbeatExecutionRecord,
  HeartbeatTriggerKind,
  MemoryRecord,
  QueueJob
} from "@jeanbot/types";

interface AutomationEvents {
  heartbeatTriggered: HeartbeatDefinition;
}

interface HeartbeatTriggerPayload {
  heartbeatId: string;
  executionId: string;
  triggerKind: HeartbeatTriggerKind;
  requestedBy?: string | undefined;
}

interface WorkspaceSnapshot {
  memoryCount: number;
  knowledgeCount: number;
  highImportanceCount: number;
  dominantTags: string[];
  recentMemories: string[];
  recentKnowledgeTitles: string[];
}

interface HeartbeatExecutionReport {
  summary: string;
  result: Record<string, unknown>;
}

const nextRunFor = (task: ScheduledTask | undefined) => {
  if (!task || typeof task.getNextRun !== "function") {
    return undefined;
  }

  const next = task.getNextRun();
  return next ? next.toISOString() : undefined;
};

export class HeartbeatService {
  private readonly logger = createLogger("heartbeat-service");
  private readonly eventBus = new EventBus<AutomationEvents>();
  private readonly persistence = createPersistenceBundle();
  private readonly notifications = new NotificationService();
  private readonly config = loadPlatformConfig();
  private readonly queue = this.createQueueAdapter();
  private readonly heartbeats = new Map<string, HeartbeatDefinition>();
  private readonly schedules = new Map<string, ScheduledTask>();
  private readonly localLocks = new Set<string>();
  private readonly redis =
    this.config.queueMode === "redis" && this.config.redisUrl
      ? new Redis(this.config.redisUrl)
      : undefined;
  private schedulerResyncTimer: NodeJS.Timeout | undefined;
  private initialized = false;

  constructor(
    private readonly options: {
      processTriggersInProcess?: boolean | undefined;
    } = {}
  ) {}

  private createQueueAdapter(): JobQueueAdapter {
    if (this.config.queueMode === "redis" && this.config.redisUrl) {
      return new RedisJobQueue(this.config.redisUrl);
    }

    return new LocalJobQueue();
  }

  private shouldProcessInProcess() {
    if (typeof this.options.processTriggersInProcess === "boolean") {
      return this.options.processTriggersInProcess;
    }

    return this.config.queueMode !== "redis" || !this.config.redisUrl;
  }

  private assertValidSchedule(schedule: string) {
    if (!cron.validate(schedule)) {
      throw new Error(`Invalid cron schedule "${schedule}".`);
    }
  }

  private async acquireLease(heartbeatId: string) {
    const leaseKey = `jeanbot:heartbeat:lease:${heartbeatId}`;
    if (this.redis) {
      const granted = await this.redis.set(leaseKey, crypto.randomUUID(), "PX", 5 * 60_000, "NX");
      return granted === "OK";
    }

    if (this.localLocks.has(leaseKey)) {
      return false;
    }

    this.localLocks.add(leaseKey);
    return true;
  }

  private async releaseLease(heartbeatId: string) {
    const leaseKey = `jeanbot:heartbeat:lease:${heartbeatId}`;
    if (this.redis) {
      await this.redis.del(leaseKey);
      return;
    }

    this.localLocks.delete(leaseKey);
  }

  private stopSchedule(heartbeatId: string) {
    const task = this.schedules.get(heartbeatId);
    if (!task) {
      return;
    }

    task.stop();
    task.destroy();
    this.schedules.delete(heartbeatId);
  }

  private async persistHeartbeat(heartbeat: HeartbeatDefinition) {
    this.heartbeats.set(heartbeat.id, heartbeat);
    await this.persistence.heartbeats.save(heartbeat);
    return heartbeat;
  }

  private async syncSchedule(heartbeat: HeartbeatDefinition) {
    this.stopSchedule(heartbeat.id);
    if (!heartbeat.active) {
      return this.persistHeartbeat({
        ...heartbeat,
        schedulerStatus: "paused",
        nextRunAt: undefined
      });
    }

    this.assertValidSchedule(heartbeat.schedule);
    const task = cron.schedule(heartbeat.schedule, () => {
      void this.trigger(heartbeat.id, {
        requestedBy: "heartbeat-scheduler",
        triggerKind: "schedule"
      });
    });
    this.schedules.set(heartbeat.id, task);
    return this.persistHeartbeat({
      ...heartbeat,
      schedulerStatus: "scheduled",
      nextRunAt: nextRunFor(task),
      lastSchedulerError: undefined
    });
  }

  private async resyncSchedules() {
    const persisted = await this.persistence.heartbeats.list();
    const seen = new Set<string>();
    for (const heartbeat of persisted) {
      seen.add(heartbeat.id);
      this.heartbeats.set(heartbeat.id, heartbeat);
      try {
        await this.syncSchedule(heartbeat);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.persistHeartbeat({
          ...heartbeat,
          schedulerStatus: "error",
          lastSchedulerError: message
        });
      }
    }

    for (const heartbeatId of [...this.schedules.keys()]) {
      if (!seen.has(heartbeatId)) {
        this.stopSchedule(heartbeatId);
      }
    }
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    await this.resyncSchedules();
    this.schedulerResyncTimer = setInterval(() => {
      void this.resyncSchedules();
    }, 60_000);
    this.schedulerResyncTimer.unref?.();
    this.initialized = true;
  }

  private async getOrRefreshHeartbeat(heartbeatId: string) {
    await this.initialize();
    const cached = this.heartbeats.get(heartbeatId);
    if (cached) {
      return cached;
    }

    const persisted = await this.persistence.heartbeats.get(heartbeatId);
    if (persisted) {
      this.heartbeats.set(heartbeatId, persisted);
    }

    return persisted;
  }

  async register(heartbeat: HeartbeatDefinition) {
    await this.initialize();
    this.assertValidSchedule(heartbeat.schedule);
    const normalized: HeartbeatDefinition = {
      ...heartbeat,
      active: heartbeat.active ?? true,
      schedulerStatus: heartbeat.active ?? true ? "scheduled" : "paused"
    };

    await this.persistHeartbeat(normalized);
    return this.syncSchedule(normalized);
  }

  async update(
    heartbeatId: string,
    updates: Partial<Pick<HeartbeatDefinition, "name" | "schedule" | "objective" | "active">>
  ) {
    const heartbeat = await this.getOrRefreshHeartbeat(heartbeatId);
    if (!heartbeat) {
      return undefined;
    }

    const next = {
      ...heartbeat,
      ...updates
    };
    await this.persistHeartbeat(next);
    return this.syncSchedule(next);
  }

  async pause(heartbeatId: string) {
    return this.update(heartbeatId, {
      active: false
    });
  }

  async resume(heartbeatId: string) {
    return this.update(heartbeatId, {
      active: true
    });
  }

  async get(heartbeatId: string) {
    return this.getOrRefreshHeartbeat(heartbeatId);
  }

  async close() {
    if (this.schedulerResyncTimer) {
      clearInterval(this.schedulerResyncTimer);
      this.schedulerResyncTimer = undefined;
    }

    for (const heartbeatId of [...this.schedules.keys()]) {
      this.stopSchedule(heartbeatId);
    }

    if (this.redis) {
      await this.redis.quit().catch(async () => {
        await this.redis?.disconnect();
      });
    }

    await this.queue.close();

    this.initialized = false;
  }

  async list() {
    await this.initialize();
    return [...this.heartbeats.values()].sort((left, right) => {
      if (left.active !== right.active) {
        return left.active ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });
  }

  async listHistory(heartbeatId: string) {
    return this.persistence.heartbeatExecutions.list(heartbeatId);
  }

  onTriggered(listener: (heartbeat: HeartbeatDefinition) => void | Promise<void>) {
    this.eventBus.on("heartbeatTriggered", listener);
  }

  private buildQueuedExecution(
    heartbeat: HeartbeatDefinition,
    options: {
      triggerKind: HeartbeatTriggerKind;
      requestedBy?: string | undefined;
    }
  ) {
    const createdAt = new Date().toISOString();
    const execution: HeartbeatExecutionRecord = {
      id: crypto.randomUUID(),
      heartbeatId: heartbeat.id,
      tenantId: heartbeat.tenantId,
      workspaceId: heartbeat.workspaceId,
      status: "queued",
      triggerKind: options.triggerKind,
      requestedBy: options.requestedBy,
      summary: `Queued heartbeat "${heartbeat.name}" for execution.`,
      result: {
        objective: heartbeat.objective,
        schedule: heartbeat.schedule
      },
      createdAt
    };

    const job: QueueJob<HeartbeatTriggerPayload> = {
      id: crypto.randomUUID(),
      kind: "heartbeat.trigger",
      tenantId: heartbeat.tenantId,
      workspaceId: heartbeat.workspaceId,
      payload: {
        heartbeatId: heartbeat.id,
        executionId: execution.id,
        triggerKind: options.triggerKind,
        requestedBy: options.requestedBy
      },
      attempts: 0,
      maxAttempts: 3,
      createdAt
    };

    return {
      execution,
      job
    };
  }

  async trigger(
    heartbeatId: string,
    options: {
      triggerKind?: HeartbeatTriggerKind | undefined;
      requestedBy?: string | undefined;
    } = {}
  ) {
    const heartbeat = await this.getOrRefreshHeartbeat(heartbeatId);
    if (!heartbeat || !heartbeat.active) {
      return undefined;
    }

    const now = new Date().toISOString();
    const updatedHeartbeat: HeartbeatDefinition = {
      ...heartbeat,
      lastRunAt: options.triggerKind === "schedule" ? heartbeat.lastRunAt : now,
      lastScheduledAt: options.triggerKind === "schedule" ? now : heartbeat.lastScheduledAt,
      nextRunAt: nextRunFor(this.schedules.get(heartbeat.id))
    };

    const { execution, job } = this.buildQueuedExecution(updatedHeartbeat, {
      triggerKind: options.triggerKind ?? "manual",
      requestedBy: options.requestedBy
    });
    await this.persistHeartbeat(updatedHeartbeat);

    const acquired = await this.acquireLease(heartbeat.id);
    if (!acquired) {
      const skipped = await this.persistence.heartbeatExecutions.save({
        ...execution,
        status: "skipped",
        summary: `Skipped heartbeat "${heartbeat.name}" because another run already holds the lease.`,
        finishedAt: new Date().toISOString(),
        error: "overlapping_execution"
      });
      await this.persistence.audit.save({
        id: crypto.randomUUID(),
        kind: "heartbeat.execution.skipped",
        entityId: heartbeat.id,
        actor: options.requestedBy ?? "heartbeat-scheduler",
        details: {
          workspaceId: heartbeat.workspaceId,
          executionId: skipped.id
        },
        createdAt: skipped.finishedAt ?? skipped.createdAt
      });
      return updatedHeartbeat;
    }

    await this.persistence.heartbeatExecutions.save(execution);
    if (this.shouldProcessInProcess()) {
      try {
        await this.processTriggerJob(job);
      } finally {
        await this.releaseLease(heartbeat.id);
      }
    } else {
      await this.queue.enqueue(job);
    }

    return updatedHeartbeat;
  }

  private async loadExecution(job: QueueJob<HeartbeatTriggerPayload>, heartbeat: HeartbeatDefinition) {
    const existing = await this.persistence.heartbeatExecutions.get(job.payload.executionId);
    if (existing) {
      return existing;
    }

    return this.persistence.heartbeatExecutions.save({
      id: job.payload.executionId,
      heartbeatId: heartbeat.id,
      tenantId: heartbeat.tenantId,
      workspaceId: heartbeat.workspaceId,
      status: "queued",
      triggerKind: job.payload.triggerKind,
      requestedBy: job.payload.requestedBy,
      summary: `Recovered queued heartbeat "${heartbeat.name}" from job replay.`,
      result: {
        objective: heartbeat.objective,
        schedule: heartbeat.schedule
      },
      createdAt: job.createdAt
    });
  }

  private async snapshotWorkspace(workspaceId: string): Promise<WorkspaceSnapshot> {
    const [memories, documents] = await Promise.all([
      this.persistence.memory.list(workspaceId),
      this.persistence.knowledge.list(workspaceId)
    ]);

    const tagCounts = new Map<string, number>();
    for (const memory of memories) {
      for (const tag of memory.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }

    return {
      memoryCount: memories.length,
      knowledgeCount: documents.length,
      highImportanceCount: memories.filter((memory) => (memory.importance ?? 0) >= 0.7).length,
      dominantTags: [...tagCounts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 5)
        .map(([tag]) => tag),
      recentMemories: memories.slice(-3).map((memory) => memory.text.slice(0, 160)),
      recentKnowledgeTitles: documents.slice(0, 3).map((document) => document.title)
    };
  }

  private buildExecutionReport(
    heartbeat: HeartbeatDefinition,
    execution: HeartbeatExecutionRecord,
    snapshot: WorkspaceSnapshot
  ): HeartbeatExecutionReport {
    const recommendedActions: string[] = [];
    if (snapshot.knowledgeCount === 0) {
      recommendedActions.push("Ingest at least one knowledge document.");
    }
    if (snapshot.memoryCount === 0) {
      recommendedActions.push("Store a short-term memory after important runs.");
    }
    if (recommendedActions.length === 0) {
      recommendedActions.push("No immediate follow-up needed.");
    }

    return {
      summary: `Heartbeat "${heartbeat.name}" completed for workspace "${heartbeat.workspaceId}".`,
      result: {
        executionId: execution.id,
        heartbeatId: heartbeat.id,
        workspaceId: heartbeat.workspaceId,
        objective: heartbeat.objective,
        schedule: heartbeat.schedule,
        queueMode: this.config.queueMode,
        persistenceMode: this.persistence.mode,
        snapshot,
        recommendedActions,
        executedAt: new Date().toISOString()
      }
    };
  }

  private async appendExecutionMemory(
    heartbeat: HeartbeatDefinition,
    execution: HeartbeatExecutionRecord
  ) {
    const existing = await this.persistence.memory.list(heartbeat.workspaceId);
    const record: MemoryRecord = {
      id: crypto.randomUUID(),
      workspaceId: heartbeat.workspaceId,
      scope: execution.status === "completed" ? "long-term" : "short-term",
      text: execution.summary,
      tags: ["heartbeat", heartbeat.id, heartbeat.name.toLowerCase().replace(/\s+/g, "-")],
      importance: execution.status === "failed" ? 0.9 : 0.7,
      contentHash: embeddingContentHash(execution.summary),
      createdAt: execution.finishedAt ?? execution.createdAt
    };

    const next = [...existing, record].slice(-500);
    await this.persistence.memory.save(heartbeat.workspaceId, next);
  }

  private async notifyExecution(
    heartbeat: HeartbeatDefinition,
    execution: HeartbeatExecutionRecord
  ) {
    const eventType =
      execution.status === "completed" ? "heartbeat.completed" : "heartbeat.failed";
    const subject = `JeanBot heartbeat ${execution.status}: ${heartbeat.name}`;
    const body = [
      `Heartbeat: ${heartbeat.name}`,
      `Status: ${execution.status}`,
      `Workspace: ${heartbeat.workspaceId}`,
      `Objective: ${heartbeat.objective}`,
      `Summary: ${execution.summary}`
    ].join("\n");

    try {
      return await this.notifications.notifyWorkspaceMembers({
        workspaceId: heartbeat.workspaceId,
        eventType,
        subject,
        body,
        metadata: {
          heartbeatId: heartbeat.id,
          executionId: execution.id,
          triggerKind: execution.triggerKind
        }
      });
    } catch (error) {
      this.logger.warn("Heartbeat notification failed", {
        heartbeatId: heartbeat.id,
        executionId: execution.id,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  async processTriggerJob(job: QueueJob<HeartbeatTriggerPayload>) {
    const heartbeat = await this.getOrRefreshHeartbeat(job.payload.heartbeatId);
    if (!heartbeat) {
      return undefined;
    }

    const queued = await this.loadExecution(job, heartbeat);
    const startedAt = new Date().toISOString();
    const running = await this.persistence.heartbeatExecutions.save({
      ...queued,
      status: "running",
      summary: `Running heartbeat "${heartbeat.name}".`,
      startedAt
    });

    try {
      const snapshot = await this.snapshotWorkspace(heartbeat.workspaceId);
      const report = this.buildExecutionReport(heartbeat, running, snapshot);
      const finishedAt = new Date().toISOString();
      const completed = await this.persistence.heartbeatExecutions.save({
        ...running,
        status: "completed",
        summary: report.summary,
        result: report.result,
        finishedAt,
        error: undefined
      });

      await this.persistHeartbeat({
        ...heartbeat,
        lastRunAt: finishedAt,
        nextRunAt: nextRunFor(this.schedules.get(heartbeat.id))
      });
        await Promise.all([
          this.appendExecutionMemory(heartbeat, completed),
          this.notifyExecution(heartbeat, completed),
          this.persistence.audit.save({
            id: crypto.randomUUID(),
            kind: "heartbeat.execution.completed",
          entityId: heartbeat.id,
          actor: completed.requestedBy ?? "heartbeat-worker",
          details: {
            workspaceId: heartbeat.workspaceId,
            executionId: completed.id
          },
          createdAt: finishedAt
        }),
        this.eventBus.emit("heartbeatTriggered", heartbeat)
      ]);

      return completed;
    } catch (error) {
      const finishedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      const failed = await this.persistence.heartbeatExecutions.save({
        ...running,
        status: "failed",
        summary: `Heartbeat "${heartbeat.name}" failed during execution.`,
        finishedAt,
        error: message
      });
        await Promise.all([
          this.appendExecutionMemory(heartbeat, failed),
          this.notifyExecution(heartbeat, failed),
          this.persistence.audit.save({
            id: crypto.randomUUID(),
            kind: "heartbeat.execution.failed",
          entityId: heartbeat.id,
          actor: failed.requestedBy ?? "heartbeat-worker",
          details: {
            workspaceId: heartbeat.workspaceId,
            executionId: failed.id,
            error: message
          },
          createdAt: finishedAt
        })
      ]);
      throw error;
    } finally {
      await this.releaseLease(job.payload.heartbeatId);
    }
  }
}
