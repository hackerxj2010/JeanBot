import { describe, expect, it } from "vitest";

import { AutomationService } from "../../services/automation-service/src/index.js";
import { KnowledgeService } from "../../services/knowledge-service/src/index.js";
import { MemoryService } from "../../services/memory-service/src/index.js";
import { UserService } from "../../services/user-service/src/index.js";
import { createPersistenceBundle } from "../../packages/persistence/src/index.js";

describe("AutomationService", () => {
  it("records heartbeat execution history, audit, and memory in local mode", async () => {
    process.env.JEANBOT_PERSISTENCE_MODE = "local";
    process.env.JEANBOT_QUEUE_MODE = "local";

    const knowledge = new KnowledgeService();
    const memory = new MemoryService();
    const automation = new AutomationService();
    const userService = new UserService();
    const persistence = createPersistenceBundle();
    const bootstrapped = await userService.bootstrap({
      tenantName: "Automation Tenant",
      tenantSlug: `automation-tenant-${Date.now()}`,
      email: `automation-${Date.now()}@example.com`,
      displayName: "Automation User",
      workspaceName: "Automation Workspace",
      workspaceSlug: `automation-workspace-${Date.now()}`
    });

    await knowledge.ingest({
      workspaceId: bootstrapped.workspace.id,
      title: "Runbook",
      body: "Investigate incidents and capture the follow-up in memory.",
      metadata: {
        source: "unit-test"
      }
    });
    await memory.remember(
      bootstrapped.workspace.id,
      "Previous incident response was successful after reviewing the runbook.",
      ["incident", "runbook"],
      "short-term",
      0.8
    );

    const heartbeat = await automation.createHeartbeat({
      tenantId: bootstrapped.tenant.id,
      workspaceId: bootstrapped.workspace.id,
      name: "Incident monitor",
      schedule: "0 * * * *",
      objective: "Monitor incident readiness and summarize workspace signals.",
      active: true
    });

    const triggered = await automation.triggerHeartbeat(heartbeat.id, {
      requestedBy: "unit-tester"
    });

    expect(triggered?.lastRunAt).toBeDefined();

    const history = await automation.listHeartbeatHistory(heartbeat.id);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0]?.status).toBe("completed");
    expect(history[0]?.summary).toContain("Incident monitor");

    const memories = await new MemoryService().recall(bootstrapped.workspace.id);
    expect(memories.some((record) => record.tags.includes("heartbeat"))).toBe(true);

    const auditEvents = await persistence.audit.list(heartbeat.id);
    expect(auditEvents.some((event) => event.kind === "heartbeat.execution.completed")).toBe(
      true
    );

    const notifications = await persistence.notifications.list(bootstrapped.workspace.id, undefined);
    expect(notifications.some((record) => record.eventType === "heartbeat.completed")).toBe(true);

    await automation.close();
  });

  it("updates scheduler metadata on pause and resume", async () => {
    process.env.JEANBOT_PERSISTENCE_MODE = "local";
    process.env.JEANBOT_QUEUE_MODE = "local";

    const automation = new AutomationService();
    const workspaceId = `automation-scheduler-${Date.now()}`;

    const heartbeat = await automation.createHeartbeat({
      tenantId: "tenant-demo",
      workspaceId,
      name: "Scheduler heartbeat",
      schedule: "*/5 * * * *",
      objective: "Watch scheduler metadata",
      active: true
    });

    expect(heartbeat.schedulerStatus).toBe("scheduled");
    expect(heartbeat.nextRunAt).toBeDefined();

    const paused = await automation.pauseHeartbeat(heartbeat.id);
    expect(paused?.active).toBe(false);
    expect(paused?.schedulerStatus).toBe("paused");

    const resumed = await automation.resumeHeartbeat(heartbeat.id);
    expect(resumed?.active).toBe(true);
    expect(resumed?.schedulerStatus).toBe("scheduled");
    expect(resumed?.nextRunAt).toBeDefined();

    await automation.close();
  });
});
