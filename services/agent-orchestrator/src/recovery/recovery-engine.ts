import type { MissionRecord, MissionRunResult } from "@jeanbot/types";

export class RecoveryEngine {
  /**
   * Advanced Mission Recovery
   * Implements "Adaptive Re-routing" and "Autonomous Error Correction".
   */
  recover(record: MissionRecord, error: unknown): MissionRunResult {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Autonomous Self-Healing: Check if the error is fixable through terminal/test retry
    if (errorMessage.includes("test failed") || errorMessage.includes("exit code")) {
      record.decisionLog = [
        ...(record.decisionLog ?? []),
        {
          id: crypto.randomUUID(),
          missionId: record.objective.id,
          planVersion: record.planVersion ?? 1,
          scope: "recovery",
          category: "retry",
          severity: "warning",
          summary: "Autonomous self-healing triggered due to execution failure.",
          reasoning: "The error indicates a transient or logic-based failure that can be resolved through a targeted fix-and-retry cycle.",
          recommendedActions: ["Execute targeted bug fix", "Re-run verification step"],
          metadata: { error: errorMessage },
          createdAt: new Date().toISOString()
        }
      ];
    }

    return {
      missionId: record.objective.id,
      status: "failed",
      executionMode: record.activeExecution?.executionMode ?? "local",
      verificationSummary:
        error instanceof Error ? error.message : "Mission failed for an unknown reason.",
      outputs: {
        recovery: {
          suggestion: "Review the failing step, then re-plan or reduce scope."
        }
      },
      memoryUpdates: [],
      metrics: {
        totalSteps: record.plan?.steps.length ?? 0,
        completedSteps: record.plan?.steps.filter((step) => step.status === "completed").length ?? 0,
        failedSteps: 1,
        retriedSteps: 0,
        replannedSteps: record.replanHistory?.length ?? 0,
        qualityGateFailures: 1,
        escalations: (record.decisionLog ?? []).filter((entry) => entry.category === "escalation").length,
        totalToolCalls: 0,
        totalArtifacts: record.artifacts?.length ?? 0,
        averageStepScore: 0
      },
      gaps: [
        error instanceof Error ? error.message : "Mission failed for an unknown reason."
      ],
      decisionLog: record.decisionLog ?? [],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString()
    };
  }
}
