import { describe, expect, it } from "vitest";

import { AutomationService } from "../../services/automation-service/src/index.js";
import { BillingService } from "../../services/billing-service/src/index.js";
import { KnowledgeService } from "../../services/knowledge-service/src/index.js";
import { MemoryService } from "../../services/memory-service/src/index.js";

describe("BillingService", () => {
  it("builds workspace billing summaries from backend usage signals", async () => {
    process.env.JEANBOT_PERSISTENCE_MODE = "local";
    const workspaceId = `billing-workspace-${Date.now()}`;
    const knowledge = new KnowledgeService();
    const memory = new MemoryService();
    const billing = new BillingService();

    await knowledge.ingest({
      workspaceId,
      title: "Usage note",
      body: "Knowledge documents count toward the workspace plan.",
      metadata: {}
    });
    await memory.remember(workspaceId, "A billable memory record", ["billing"], "long-term", 0.8);

    const summary = await billing.getWorkspaceSummary(workspaceId);

    expect(summary.snapshot.workspaceId).toBe(workspaceId);
    expect(summary.snapshot.usage.memories).toBeGreaterThanOrEqual(1);
    expect(summary.snapshot.usage.knowledgeDocuments).toBeGreaterThanOrEqual(1);
    expect(summary.plan.id).toBe("free");
  });

  it("computes quota status and blocks active automations past the plan limit", async () => {
    process.env.JEANBOT_PERSISTENCE_MODE = "local";
    const workspaceId = `billing-quota-${Date.now()}`;
    const automation = new AutomationService();
    const billing = new BillingService();

    await automation.createHeartbeat({
      tenantId: "tenant-demo",
      workspaceId,
      name: "Heartbeat One",
      schedule: "0 * * * *",
      objective: "Check workspace state",
      active: true
    });
    await automation.createHeartbeat({
      tenantId: "tenant-demo",
      workspaceId,
      name: "Heartbeat Two",
      schedule: "30 * * * *",
      objective: "Check workspace state again",
      active: true
    });

    const quota = await billing.getWorkspaceQuotaStatus(workspaceId);

    expect(quota.limits.automations).toBe(2);
    expect(quota.usage.automations).toBe(2);
    expect(quota.remaining.automations).toBe(0);
    expect(quota.nearLimit).toContain("automations");
    await expect(billing.assertWithinQuota(workspaceId, "automations")).rejects.toThrow(
      /exceeded the automations quota/
    );

    await automation.close();
  });

  it("records usage events and exposes sync counters", async () => {
    process.env.JEANBOT_PERSISTENCE_MODE = "local";
    process.env.STRIPE_SECRET_KEY = undefined;
    const workspaceId = `billing-usage-${Date.now()}`;
    const billing = new BillingService();

    const event = await billing.recordUsage({
      workspaceId,
      tenantId: "tenant-demo",
      metric: "browserMinutes",
      quantity: 3,
      sourceService: "browser-service",
      sourceEntityId: "browser-session-1",
      timestamp: new Date().toISOString(),
      billable: true,
      metadata: {
        mode: "synthetic"
      }
    });

    if (!event) {
      throw new Error("Expected billing usage event to be recorded.");
    }
    expect(event.stripeSyncStatus).toBe("skipped");

    const usage = await billing.listUsageEvents(workspaceId, "browserMinutes", 10);
    expect(usage[0]?.metric).toBe("browserMinutes");
    expect(usage[0]?.quantity).toBe(3);

    const summary = await billing.getWorkspaceSummary(workspaceId);
    expect(summary.snapshot.usage.browserMinutes).toBeGreaterThanOrEqual(3);
    expect(summary.snapshot.stripeSync.skipped).toBeGreaterThanOrEqual(1);
  });

  it("applies quota overrides on top of the subscribed plan", async () => {
    process.env.JEANBOT_PERSISTENCE_MODE = "local";
    const workspaceId = `billing-override-${Date.now()}`;
    const billing = new BillingService();

    const updated = await billing.updateQuotaOverride({
      workspaceId,
      tenantId: "tenant-demo",
      limits: {
        missions: 500,
        automations: 12
      },
      reason: "Admin expansion",
      updatedBy: "admin-user"
    });

    expect(updated.override.limits.missions).toBe(500);
    expect(updated.quota.limits.missions).toBe(500);
    expect(updated.quota.limits.automations).toBe(12);
    expect(updated.quota.overrideApplied).toBe(true);
  });
});
