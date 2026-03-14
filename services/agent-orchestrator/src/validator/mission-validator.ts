import type { MissionRecord, MissionRunResult } from "@jeanbot/types";

export class MissionValidator {
  validate(record: MissionRecord, result: MissionRunResult) {
    if (!record.plan) {
      throw new Error(`Mission "${record.objective.id}" has no plan.`);
    }

    const incomplete = record.plan.steps.filter((step) => step.status !== "completed");
    if (incomplete.length > 0) {
      throw new Error(`Mission "${record.objective.id}" has incomplete steps.`);
    }

    if (!result.verificationSummary.trim()) {
      throw new Error(`Mission "${record.objective.id}" did not produce a verification summary.`);
    }

    if (!result.stepReports || result.stepReports.length !== record.plan.steps.length) {
      throw new Error(`Mission "${record.objective.id}" did not produce a complete step report.`);
    }

    if (!result.metrics) {
      throw new Error(`Mission "${record.objective.id}" did not produce execution metrics.`);
    }

    if (result.metrics.totalSteps !== record.plan.steps.length) {
      throw new Error(`Mission "${record.objective.id}" reported inconsistent execution metrics.`);
    }

    const expectedReplannedSteps = new Set(
      (record.decisionLog ?? [])
        .filter((entry) => entry.category === "replan" && entry.stepId)
        .map((entry) => entry.stepId as string)
    ).size;
    if ((result.metrics.replannedSteps ?? 0) !== expectedReplannedSteps) {
      throw new Error(`Mission "${record.objective.id}" reported inconsistent replan metrics.`);
    }

    const reportsMissingDiagnostics = result.stepReports.filter((report) => !report.diagnostics);
    if (reportsMissingDiagnostics.length > 0) {
      throw new Error(`Mission "${record.objective.id}" has step reports without diagnostics.`);
    }

    if ((record.replanHistory?.length ?? 0) > 0 && (record.decisionLog?.length ?? 0) === 0) {
      throw new Error(`Mission "${record.objective.id}" has replans without decision log evidence.`);
    }

    return true;
  }
}
