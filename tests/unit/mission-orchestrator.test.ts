import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

process.env.JEANBOT_MODEL_PROVIDER = "anthropic";

import { MissionOrchestrator } from "../../services/agent-orchestrator/src/index.js";

describe("MissionOrchestrator", () => {
  it("creates, plans, and runs a backend mission", async () => {
    const orchestrator = new MissionOrchestrator();
    const workspaceRoot = path.resolve("tmp", "sessions", "mission-orchestrator-test");

    await rm(workspaceRoot, { recursive: true, force: true });
    await mkdir(workspaceRoot, { recursive: true });

    const mission = await orchestrator.createMission({
      workspaceId: "workspace-demo",
      userId: "user-demo",
      title: "Build JeanBot core",
      objective: "Implement the backend core for JeanBot with orchestration and memory.",
      context: "UI is not part of this mission.",
      constraints: ["No UI implementation"],
      requiredCapabilities: [
        "planning",
        "filesystem",
        "memory",
        "terminal",
        "research",
        "software-development",
        "writing",
        "orchestration"
      ],
      risk: "medium"
    });

    const planned = await orchestrator.planMission(mission.objective.id);
    expect(planned.plan?.steps.length).toBeGreaterThan(4);

    const completed = await orchestrator.runMission(mission.objective.id, workspaceRoot);
    expect(completed.status).toBe("completed");
    expect(completed.result?.verificationSummary).toContain('Mission "Build JeanBot core" completed');
    expect(completed.result?.stepReports?.length).toBe(completed.plan?.steps.length);
    expect(completed.artifacts?.some((artifact) => artifact.kind === "report")).toBe(true);
    expect(completed.artifacts?.some((artifact) => artifact.kind === "log")).toBe(true);
    expect(completed.result?.metrics?.totalSteps).toBe(completed.plan?.steps.length);
    expect((completed.result?.metrics?.averageStepScore ?? 0)).toBeGreaterThan(0.45);
    expect((completed.result?.metrics?.replannedSteps ?? 0)).toBeGreaterThanOrEqual(0);
    expect((completed.result?.metrics?.qualityGateFailures ?? 0)).toBeGreaterThanOrEqual(0);
    expect((completed.result?.metrics?.escalations ?? 0)).toBeGreaterThanOrEqual(0);
    expect((completed.result?.gaps?.length ?? 0)).toBeGreaterThanOrEqual(0);
    expect(
      completed.result?.stepReports?.some(
        (report) =>
          typeof report.subAgentRunId === "string" &&
          (report.toolCalls ?? 0) >= 0 &&
          typeof report.diagnostics?.overallScore === "number"
      )
    ).toBe(true);
    expect(Array.isArray(completed.result?.decisionLog ?? [])).toBe(true);

    const reportPath = completed.artifacts?.find((artifact) => artifact.kind === "report")?.path;
    expect(reportPath && existsSync(reportPath)).toBe(true);
  }, 45_000);
});
