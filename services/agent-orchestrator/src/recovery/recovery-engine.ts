import type { MissionRecord, MissionRunResult } from "@jeanbot/types";

export class RecoveryEngine {
  recover(record: MissionRecord, error: unknown): MissionRunResult {
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
