import { describe, expect, it } from "vitest";

import type { MissionRecord, MissionStep, StepExecutionDiagnostics } from "../../packages/types/src/index.js";
import { AdaptiveReplanner } from "../../services/agent-orchestrator/src/executor/adaptive-replanner.js";

const createStep = (
  id: string,
  capability: MissionStep["capability"],
  overrides: Partial<MissionStep> = {}
): MissionStep => ({
  id,
  title: `Step ${id}`,
  description: `Execute ${capability}.`,
  capability,
  stage: "execution",
  dependsOn: [],
  verification: `Verify ${id}.`,
  assignee: "main-agent",
  status: "ready",
  ...overrides
});

const createDiagnostics = (
  overrides: Partial<StepExecutionDiagnostics> = {}
): StepExecutionDiagnostics => ({
  failureClass: "coverage",
  evidenceScore: 0.42,
  coverageScore: 0.2,
  verificationScore: 0.3,
  overallScore: 0.31,
  retryable: true,
  escalationRequired: false,
  missingSignals: ["Expected tool families were not used: browser, search."],
  strengths: [],
  recommendedActions: ["Force a browser-backed evidence pass before accepting the step."],
  ...overrides
});

const createRecord = (): MissionRecord => {
  const preflight = createStep("step-preflight", "filesystem", {
    stage: "preflight",
    status: "completed"
  });
  const research = createStep("step-research", "research", {
    dependsOn: [preflight.id],
    status: "running"
  });
  const verify = createStep("step-verify", "reasoning", {
    stage: "verification",
    dependsOn: [research.id],
    status: "pending"
  });

  return {
    objective: {
      id: "mission-replan-test",
      workspaceId: "workspace-test",
      userId: "user-test",
      title: "Adaptive replan mission",
      objective: "Validate adaptive replan behaviour.",
      context: "Unit test",
      constraints: [],
      requiredCapabilities: ["filesystem", "research", "reasoning"],
      risk: "medium",
      createdAt: new Date().toISOString()
    },
    plan: {
      id: "plan-mission-replan-test",
      missionId: "mission-replan-test",
      version: 1,
      summary: "Base plan.",
      steps: [preflight, research, verify],
      estimatedDurationMinutes: 20,
      estimatedCostUsd: 0.25,
      checkpoints: [],
      alternatives: [],
      generatedAt: new Date().toISOString()
    },
    status: "running",
    planVersion: 1,
    replanCount: 0,
    lastUpdatedAt: new Date().toISOString()
  };
};

describe("AdaptiveReplanner", () => {
  it("inserts remediation steps before retrying a weak step", () => {
    const replanner = new AdaptiveReplanner();
    const record = createRecord();
    const failureStep = record.plan?.steps[1];
    if (!failureStep) {
      throw new Error("Missing test step.");
    }

    const result = replanner.apply(record, {
      step: failureStep,
      attempts: 3,
      errorMessage: "Quality gate failed after repeated weak evidence.",
      diagnostics: createDiagnostics()
    });

    expect(result.patched).toBe(true);
    expect(result.plan.version).toBe(2);
    expect(result.remediationSteps.length).toBeGreaterThan(0);
    expect(result.replanPatch?.insertedStepIds).toEqual(
      result.remediationSteps.map((step) => step.id)
    );
    expect(result.decisionEntries.some((entry) => entry.category === "assessment")).toBe(true);
    expect(result.decisionEntries.some((entry) => entry.category === "replan")).toBe(true);

    const deferredStep = result.plan.steps.find((step) => step.id === failureStep.id);
    expect(deferredStep?.dependsOn).toEqual(result.remediationSteps.map((step) => step.id));
    expect(result.plan.steps.findIndex((step) => step.id === result.remediationSteps[0]?.id)).toBeLessThan(
      result.plan.steps.findIndex((step) => step.id === failureStep.id)
    );
  });

  it("refuses to replan a delivery step once step replan budget is exhausted", () => {
    const replanner = new AdaptiveReplanner();
    const record = createRecord();
    const deliveryStep = createStep("step-delivery", "writing", {
      stage: "delivery",
      dependsOn: ["step-verify"],
      status: "running"
    });

    record.plan?.steps.push(deliveryStep);
    record.replanHistory = [
      {
        id: "patch-1",
        missionId: record.objective.id,
        planVersion: 2,
        triggeredByStepId: deliveryStep.id,
        summary: "Existing patch one",
        reason: "Retry one",
        insertedStepIds: ["repair-1"],
        deferredStepIds: [deliveryStep.id],
        createdAt: new Date().toISOString()
      },
      {
        id: "patch-2",
        missionId: record.objective.id,
        planVersion: 3,
        triggeredByStepId: deliveryStep.id,
        summary: "Existing patch two",
        reason: "Retry two",
        insertedStepIds: ["repair-2"],
        deferredStepIds: [deliveryStep.id],
        createdAt: new Date().toISOString()
      }
    ];

    const result = replanner.apply(record, {
      step: deliveryStep,
      attempts: 3,
      errorMessage: "Delivery still weak.",
      diagnostics: createDiagnostics({
        failureClass: "verification",
        escalationRequired: true
      })
    });

    expect(result.patched).toBe(false);
    expect(result.remediationSteps).toHaveLength(0);
    expect(result.decisionEntries.some((entry) => entry.category === "failure")).toBe(true);
  });
});
