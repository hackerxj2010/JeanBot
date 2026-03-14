import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

process.env.JEANBOT_MODEL_PROVIDER = "anthropic";

import { SubAgentService } from "../../services/subagent-service/src/index.js";
import type { MissionObjective } from "../../packages/types/src/index.js";

describe("SubAgentService", () => {
  it("executes a sub-agent run, persists it, and exposes workspace utilization", async () => {
    const service = new SubAgentService();
    const workspaceRoot = path.resolve("tmp", "sessions", "subagent-service-test");
    const workspaceId = `workspace-subagent-${Date.now()}`;
    const missionId = `mission-subagent-${Date.now()}`;

    await rm(workspaceRoot, { recursive: true, force: true });
    await mkdir(workspaceRoot, { recursive: true });

    const step = {
      id: `${missionId}-step-1`,
      title: "Create safety checkpoint",
      description: "Scan the workspace and create a checkpoint.",
      capability: "filesystem" as const,
      stage: "preflight" as const,
      toolKind: "filesystem" as const,
      dependsOn: [],
      verification: "A checkpoint exists.",
      assignee: "file-operator",
      status: "ready" as const
    };

    const plan = {
      id: `plan-${missionId}`,
      missionId,
      version: 1,
      summary: "Inspect the workspace and protect it with a checkpoint.",
      steps: [step],
      estimatedDurationMinutes: 5,
      estimatedCostUsd: 0.01,
      checkpoints: [step.id],
      alternatives: [],
      generatedAt: new Date().toISOString()
    };

    const objective: MissionObjective = {
      id: missionId,
      workspaceId,
      userId: "user-subagent",
      title: "Workspace safety",
      objective: "Protect the workspace before making changes.",
      context: "Backend mission.",
      constraints: ["No UI work"],
      requiredCapabilities: ["filesystem"],
      risk: "medium" as const,
      createdAt: new Date().toISOString()
    };

    const result = await service.runStep({
      missionId,
      objective,
      plan,
      step,
      template: service.templateForCapability("filesystem"),
      context: {
        sessionId: crypto.randomUUID(),
        workspaceRoot,
        jeanFilePath: path.join(workspaceRoot, "JEAN.md"),
        planMode: true,
        maxParallelism: 2
      }
    });

    expect(result.run.status).toBe("completed");
    expect(result.stepReport.subAgentRunId).toBe(result.run.id);
    expect(result.output.toolCalls.length).toBeGreaterThan(0);
    expect(service.listMissionRuns(missionId).some((run) => run.id === result.run.id)).toBe(true);

    const utilization = service.workspaceUtilization(workspaceId);
    expect(utilization.totalRuns).toBeGreaterThan(0);
    expect(utilization.completedRuns).toBeGreaterThan(0);
  }, 20_000);
});
