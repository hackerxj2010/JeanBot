import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";
import type { MissionRecord } from "../../packages/types/src/index.js";
import type { MissionStateStore } from "../../services/agent-orchestrator/src/mission-state/store.js";
import type { FileService } from "../../services/file-service/src/index.js";

process.env.JEANBOT_MODEL_PROVIDER = "anthropic";

import { MissionOrchestrator } from "../../services/agent-orchestrator/src/index.js";

type OrchestratorInternals = {
  fileService: FileService;
  stateStore: MissionStateStore;
};

describe("Distributed step worker path", () => {
  it("persists queued step execution outcomes into mission active execution state", async () => {
    const orchestrator = new MissionOrchestrator();
    const internals = orchestrator as unknown as OrchestratorInternals;
    const workspaceRoot = path.resolve("tmp", "sessions", "distributed-step-worker-test");

    await rm(workspaceRoot, { recursive: true, force: true });
    await mkdir(workspaceRoot, { recursive: true });
    await internals.fileService.ensureWorkspace(workspaceRoot);

    const mission = await orchestrator.createMission({
      workspaceId: "workspace-distributed-step",
      userId: "user-distributed-step",
      title: "Distributed step persistence",
      objective: "Run one distributed step and persist its outcome.",
      context: "Unit test for step worker persistence.",
      constraints: ["Keep scope minimal"],
      requiredCapabilities: ["filesystem", "memory", "reasoning"],
      risk: "low"
    });

    await orchestrator.planMission(mission.objective.id);
    await orchestrator.setMissionStatus(mission.objective.id, "running");

    await internals.stateStore.patch(mission.objective.id, (record: MissionRecord) => {
      record.activeExecution = {
        sessionId: "distributed-step-session",
        workspaceRoot,
        executionMode: "distributed",
        startedAt: new Date().toISOString(),
        outputs: {},
        memoryUpdates: [],
        stepReports: [],
        artifacts: [],
        queuedStepIds: [],
        completedStepIds: [],
        failedSteps: [],
        stepLeases: [],
        workerEvents: []
      };
      return record;
    });

    const record = await orchestrator.getMission(mission.objective.id);
    const step = record.plan?.steps.find((candidate) => candidate.status === "ready");
    expect(step).toBeTruthy();
    if (!step) {
      throw new Error("Expected a ready step in the planned mission.");
    }

    await orchestrator.processStepExecutionJob({
      id: crypto.randomUUID(),
      kind: "mission.step.execute",
      missionId: mission.objective.id,
      payload: {
        missionId: mission.objective.id,
        stepId: step.id,
        workspaceRoot
      },
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date().toISOString()
    });

    const updated = await orchestrator.getMission(mission.objective.id);
    expect(updated.activeExecution?.completedStepIds).toContain(step.id);
    expect(updated.activeExecution?.failedSteps).toHaveLength(0);
    expect(updated.activeExecution?.stepReports.some((report) => report.stepId === step.id)).toBe(true);
    expect(updated.activeExecution?.artifacts.length).toBeGreaterThan(0);
    expect(updated.activeExecution?.outputs[step.id]).toBeTruthy();
    expect(updated.activeExecution?.stepLeases.some((lease) => lease.stepId === step.id && lease.status === "completed")).toBe(true);
    expect(updated.activeExecution?.workerEvents.some((event) => event.kind === "step-started" && event.stepId === step.id)).toBe(true);
    expect(updated.activeExecution?.workerEvents.some((event) => event.kind === "step-completed" && event.stepId === step.id)).toBe(true);
  }, 20_000);

  it("ignores stale step jobs when the active lease has already moved on", async () => {
    const orchestrator = new MissionOrchestrator();
    const internals = orchestrator as unknown as OrchestratorInternals;
    const workspaceRoot = path.resolve("tmp", "sessions", "distributed-step-worker-stale-job-test");

    await rm(workspaceRoot, { recursive: true, force: true });
    await mkdir(workspaceRoot, { recursive: true });
    await internals.fileService.ensureWorkspace(workspaceRoot);

    const mission = await orchestrator.createMission({
      workspaceId: "workspace-distributed-step-stale",
      userId: "user-distributed-step-stale",
      title: "Distributed stale job protection",
      objective: "Ignore a stale step job when a newer lease is active.",
      context: "Unit test for stale distributed worker jobs.",
      constraints: ["Do not execute stale jobs"],
      requiredCapabilities: ["filesystem", "reasoning"],
      risk: "low"
    });

    await orchestrator.planMission(mission.objective.id);
    await orchestrator.setMissionStatus(mission.objective.id, "running");

    const record = await orchestrator.getMission(mission.objective.id);
    const step = record.plan?.steps.find((candidate) => candidate.status === "ready");
    expect(step).toBeTruthy();
    if (!step) {
      throw new Error("Expected a ready step in the planned mission.");
    }

    const activeLeaseId = crypto.randomUUID();
    await internals.stateStore.patch(mission.objective.id, (current: MissionRecord) => {
      current.activeExecution = {
        sessionId: "distributed-step-stale-session",
        workspaceRoot,
        executionMode: "distributed",
        startedAt: new Date().toISOString(),
        outputs: {},
        memoryUpdates: [],
        stepReports: [],
        artifacts: [],
        queuedStepIds: [step.id],
        completedStepIds: [],
        failedSteps: [],
        stepLeases: [
          {
            id: activeLeaseId,
            missionId: mission.objective.id,
            stepId: step.id,
            jobId: "job-active-lease",
            queueKind: "mission.step.execute",
            status: "queued",
            attempt: 2,
            queuedAt: new Date().toISOString()
          }
        ],
        workerEvents: []
      };
      return current;
    });

    await orchestrator.processStepExecutionJob({
      id: crypto.randomUUID(),
      kind: "mission.step.execute",
      missionId: mission.objective.id,
      payload: {
        missionId: mission.objective.id,
        stepId: step.id,
        workspaceRoot,
        leaseId: crypto.randomUUID(),
        attempt: 1
      },
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date().toISOString()
    });

    const updated = await orchestrator.getMission(mission.objective.id);
    expect(updated.activeExecution?.completedStepIds).not.toContain(step.id);
    expect(updated.activeExecution?.outputs[step.id]).toBeUndefined();
    expect(updated.activeExecution?.workerEvents.some((event) => event.kind === "step-ignored" && event.stepId === step.id)).toBe(true);
    expect(updated.activeExecution?.stepLeases.find((lease) => lease.stepId === step.id)?.id).toBe(activeLeaseId);
  }, 20_000);
});
