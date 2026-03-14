import { describe, expect, it } from "vitest";

import type {
  MissionArtifact,
  MissionRecord,
  MissionStep,
  PolicyDecision,
  RuntimeExecutionResult,
  StepExecutionRecord
} from "../../packages/types/src/index.js";
import { MissionExecutionIntelligence } from "../../services/agent-orchestrator/src/executor/execution-intelligence.js";

const createStep = (
  capability: MissionStep["capability"],
  overrides: Partial<MissionStep> = {}
): MissionStep => ({
  id: `step-${capability}`,
  title: `Step ${capability}`,
  description: `Execute ${capability} work.`,
  capability,
  stage: "execution",
  dependsOn: [],
  verification: `Verify ${capability}.`,
  assignee: "test-agent",
  status: "completed",
  ...overrides
});

const createPolicyDecision = (overrides: Partial<PolicyDecision> = {}): PolicyDecision => ({
  allowed: true,
  reason: "Allowed in test mode.",
  approvalRequired: false,
  risk: "low",
  ruleHits: [],
  blockedActions: [],
  ...overrides
});

const createRuntimeResult = (overrides: Partial<RuntimeExecutionResult> = {}): RuntimeExecutionResult => ({
  finalText: "JeanBot gathered evidence and completed the step with concrete outputs.",
  provider: "anthropic",
  model: "claude-haiku-4-5",
  mode: "synthetic",
  promptDigest: "prompt",
  workspaceSummary: "workspace",
  memorySummary: "memory",
  policyPosture: "allowed",
  toolCalls: [],
  iterations: [],
  providerResponses: [
    {
      provider: "anthropic",
      mode: "synthetic",
      ok: true,
      message: "Synthetic execution completed.",
      output: {
        text: "Synthetic execution completed."
      }
    }
  ],
  verification: {
    ok: true,
    sanitized: "Synthetic execution completed.",
    reason: "Runtime self-check passed."
  },
  ...overrides
});

describe("MissionExecutionIntelligence", () => {
  it("scores strong browser-backed execution as non-retryable", () => {
    const intelligence = new MissionExecutionIntelligence();
    const step = createStep("research");
    const result = createRuntimeResult({
      finalText:
        "JeanBot searched for supporting material, opened the strongest source, extracted link evidence, and captured the page state for the report.",
      toolCalls: [
        {
          id: "tool-1",
          toolId: "search.query",
          action: "query",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          ok: true,
          message: "Search complete",
          payloadPreview: "search results"
        },
        {
          id: "tool-2",
          toolId: "browser.session.navigate",
          action: "navigate",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          ok: true,
          message: "Navigation complete",
          payloadPreview: "https://example.com"
        },
        {
          id: "tool-3",
          toolId: "browser.session.extract",
          action: "extract-browser-state",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          ok: true,
          message: "Extraction complete",
          payloadPreview: "page text"
        },
        {
          id: "tool-4",
          toolId: "browser.session.capture",
          action: "capture-browser",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          ok: true,
          message: "Capture complete",
          payloadPreview: "capture path"
        }
      ]
    });

    const diagnostics = intelligence.assessStep(step, result, createPolicyDecision(), 1);

    expect(diagnostics.retryable).toBe(false);
    expect(diagnostics.failureClass).toBe("none");
    expect(diagnostics.overallScore).toBeGreaterThan(0.75);
    expect(diagnostics.strengths.length).toBeGreaterThan(0);
  });

  it("flags weak terminal execution for retry with diagnostics and mission metrics", () => {
    const intelligence = new MissionExecutionIntelligence();
    const step = createStep("software-development");
    const result = createRuntimeResult({
      finalText: "Done.",
      toolCalls: [
        {
          id: "tool-1",
          toolId: "terminal.command.run",
          action: "run-command",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          ok: false,
          message: "Command failed",
          payloadPreview: "exit 1"
        }
      ],
      verification: {
        ok: false,
        sanitized: "Done.",
        reason: "Runtime self-check failed."
      }
    });

    const diagnostics = intelligence.assessStep(
      step,
      result,
      createPolicyDecision({ risk: "medium" }),
      1
    );

    const report: StepExecutionRecord = {
      stepId: step.id,
      assignee: step.assignee,
      status: "completed",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      summary: "Weak terminal execution",
      verification: result.verification.reason,
      attempts: 1,
      toolCalls: result.toolCalls.length,
      diagnostics
    };

    const artifacts: MissionArtifact[] = [
      {
        id: "artifact-1",
        kind: "log",
        title: "Step report",
        path: "memory://artifact",
        createdAt: new Date().toISOString(),
        metadata: {}
      }
    ];

    const metrics = intelligence.buildMissionMetrics([report], artifacts);
    const verificationSummary = intelligence.buildVerificationSummary(
      {
        objective: {
          id: "mission-test",
          workspaceId: "workspace-test",
          userId: "user-test",
          title: "Test mission",
          objective: "Validate execution intelligence.",
          context: "Unit test",
          constraints: [],
          requiredCapabilities: ["software-development"],
          risk: "medium",
          createdAt: new Date().toISOString()
        },
        status: "completed",
        planVersion: 1,
        lastUpdatedAt: new Date().toISOString()
      } satisfies MissionRecord,
      [report],
      metrics
    );

    expect(diagnostics.retryable).toBe(true);
    expect(diagnostics.failureClass).toBe("verification");
    expect(diagnostics.missingSignals.length).toBeGreaterThan(0);
    expect(metrics.averageStepScore).toBeLessThan(0.6);
    expect(metrics.qualityGateFailures).toBe(1);
    expect(metrics.replannedSteps).toBe(0);
    expect(verificationSummary).toContain("Average step score");
  });
});
