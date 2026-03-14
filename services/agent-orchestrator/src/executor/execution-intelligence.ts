import type {
  MissionDecisionLogEntry,
  MissionArtifact,
  MissionExecutionMetrics,
  MissionRecord,
  MissionReplanPatch,
  MissionStep,
  PolicyDecision,
  RuntimeExecutionResult,
  StepExecutionDiagnostics,
  StepExecutionRecord,
  ToolKind
} from "@jeanbot/types";

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const roundScore = (value: number) => Number(clamp(value).toFixed(3));

const summarizeText = (value: string, maxLength = 180) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
};

const capabilityToolExpectations: Partial<Record<MissionStep["capability"], ToolKind[]>> = {
  filesystem: ["filesystem"],
  terminal: ["terminal"],
  browser: ["browser"],
  research: ["browser", "search"],
  memory: ["memory"],
  communication: ["communication"],
  automation: ["automation"],
  heartbeat: ["automation"],
  "software-development": ["terminal", "filesystem"],
  "data-analysis": ["terminal", "memory"],
  planning: ["memory", "filesystem"],
  orchestration: ["memory", "filesystem"],
  security: ["policy", "audit"]
};

const capabilityRiskFloor: Partial<Record<MissionStep["capability"], number>> = {
  security: 0.74,
  finance: 0.8,
  communication: 0.76,
  terminal: 0.68,
  browser: 0.66,
  "software-development": 0.7,
  research: 0.68
};

const failureClassPriority: StepExecutionDiagnostics["failureClass"][] = [
  "policy",
  "verification",
  "tooling",
  "coverage",
  "runtime",
  "none"
];

const requiresExplicitPolicyEvidence = (
  step: MissionStep,
  decision: PolicyDecision
) =>
  decision.approvalRequired &&
  ["security", "finance", "communication"].includes(step.capability);

interface CoverageSnapshot {
  expectedKinds: ToolKind[];
  seenKinds: Set<ToolKind>;
  missingKinds: ToolKind[];
  score: number;
}

interface EvidenceSnapshot {
  failedToolCalls: number;
  toolCalls: number;
  providerTurns: number;
  finalTextLength: number;
  score: number;
}

export class MissionExecutionIntelligence {
  private toolKindsFromOutput(output: RuntimeExecutionResult) {
    const seenKinds = new Set<ToolKind>();

    for (const toolCall of output.toolCalls) {
      const [prefix] = toolCall.toolId.split(".");
      switch (prefix) {
        case "filesystem":
        case "terminal":
        case "browser":
        case "memory":
        case "communication":
        case "automation":
        case "policy":
        case "audit":
        case "knowledge":
          seenKinds.add(prefix as ToolKind);
          break;
        case "search":
          seenKinds.add("search");
          break;
        default:
          break;
      }
    }

    return seenKinds;
  }

  private coverageSnapshot(step: MissionStep, output: RuntimeExecutionResult): CoverageSnapshot {
    const expectedKinds = capabilityToolExpectations[step.capability] ?? [];
    const seenKinds = this.toolKindsFromOutput(output);
    const missingKinds = expectedKinds.filter((kind) => !seenKinds.has(kind));
    const rawCoverage =
      expectedKinds.length === 0 ? 1 : (expectedKinds.length - missingKinds.length) / expectedKinds.length;
    const bonus = output.toolCalls.length >= expectedKinds.length && output.toolCalls.length > 0 ? 0.1 : 0;

    return {
      expectedKinds,
      seenKinds,
      missingKinds,
      score: roundScore(rawCoverage + bonus)
    };
  }

  private evidenceSnapshot(output: RuntimeExecutionResult): EvidenceSnapshot {
    const failedToolCalls = output.toolCalls.filter((toolCall) => !toolCall.ok).length;
    const providerTurns = output.providerResponses.length;
    const finalTextLength = output.finalText.trim().length;
    const toolEvidence = output.toolCalls.length === 0 ? 0.25 : Math.min(1, output.toolCalls.length / 3);
    const providerEvidence = providerTurns === 0 ? 0.2 : Math.min(1, providerTurns / 2);
    const textEvidence = finalTextLength === 0 ? 0 : Math.min(1, finalTextLength / 320);
    const failurePenalty = failedToolCalls === 0 ? 0 : Math.min(0.45, failedToolCalls * 0.18);

    return {
      failedToolCalls,
      toolCalls: output.toolCalls.length,
      providerTurns,
      finalTextLength,
      score: roundScore(toolEvidence * 0.45 + providerEvidence * 0.2 + textEvidence * 0.35 - failurePenalty)
    };
  }

  private verificationScore(output: RuntimeExecutionResult) {
    const base = output.verification.ok ? 1 : 0.25;
    const reasonBonus =
      output.verification.reason.trim().length > 32 && output.verification.reason !== output.verification.sanitized
        ? 0.05
        : 0;

    return roundScore(base + reasonBonus);
  }

  private policyPenalty(step: MissionStep, decision: PolicyDecision) {
    if (!decision.approvalRequired) {
      return 0;
    }

    if (["security", "finance", "communication"].includes(step.capability)) {
      return 0.08;
    }

    return 0.04;
  }

  private missingSignals(
    step: MissionStep,
    output: RuntimeExecutionResult,
    coverage: CoverageSnapshot,
    evidence: EvidenceSnapshot,
    decision: PolicyDecision
  ) {
    const issues: string[] = [];

    if (!output.verification.ok) {
      issues.push(`Runtime verification did not pass for "${step.title}".`);
    }

    if (coverage.missingKinds.length > 0) {
      issues.push(
        `Expected tool families were not used: ${coverage.missingKinds.join(", ")}.`
      );
    }

    if (evidence.toolCalls === 0 && coverage.expectedKinds.length > 0) {
      issues.push("The step produced no tool evidence even though tools were expected.");
    }

    if (evidence.failedToolCalls > 0) {
      issues.push(`${evidence.failedToolCalls} tool call(s) failed during execution.`);
    }

    if (evidence.finalTextLength < 80) {
      issues.push("The final step narrative is too short to be a reliable operator handoff.");
    }

    if (
      requiresExplicitPolicyEvidence(step, decision) &&
      !output.toolCalls.some((toolCall) => toolCall.toolId.startsWith("policy."))
    ) {
      issues.push("Policy-sensitive work did not produce explicit policy evidence.");
    }

    return issues;
  }

  private strengths(
    step: MissionStep,
    output: RuntimeExecutionResult,
    coverage: CoverageSnapshot,
    evidence: EvidenceSnapshot
  ) {
    const strengths: string[] = [];

    if (output.verification.ok) {
      strengths.push("Runtime self-check passed.");
    }

    if (coverage.score >= 0.9) {
      strengths.push(`Tool coverage matched the expected ${step.capability} workflow.`);
    }

    if (evidence.providerTurns >= 2) {
      strengths.push("The runtime completed multiple provider turns before finalizing.");
    }

    if (evidence.toolCalls >= 2) {
      strengths.push("The step produced multiple concrete tool-backed signals.");
    }

    if (output.finalText.trim().length >= 180) {
      strengths.push("The final narrative is detailed enough for a handoff artifact.");
    }

    return strengths;
  }

  private failureClass(
    step: MissionStep,
    output: RuntimeExecutionResult,
    coverage: CoverageSnapshot,
    decision: PolicyDecision
  ): StepExecutionDiagnostics["failureClass"] {
    const candidates: StepExecutionDiagnostics["failureClass"][] = [];

    if (!output.verification.ok) {
      candidates.push("verification");
    }

    if (coverage.missingKinds.length > 0) {
      candidates.push("coverage");
    }

    if (output.toolCalls.some((toolCall) => !toolCall.ok)) {
      candidates.push("tooling");
    }

    if (
      requiresExplicitPolicyEvidence(step, decision) &&
      !output.toolCalls.some((toolCall) => toolCall.toolId.startsWith("policy."))
    ) {
      candidates.push("policy");
    }

    return (
      failureClassPriority.find((failureClass) => candidates.includes(failureClass)) ?? "none"
    );
  }

  private recommendedActions(
    step: MissionStep,
    diagnostics: StepExecutionDiagnostics,
    coverage: CoverageSnapshot
  ) {
    const actions: string[] = [];

    if (!diagnostics.retryable && diagnostics.failureClass === "none") {
      actions.push(`Proceed with the next dependency after "${step.title}".`);
      return actions;
    }

    if (diagnostics.failureClass === "verification") {
      actions.push("Run one more validation-oriented attempt with stricter verification instructions.");
    }

    if (diagnostics.failureClass === "coverage") {
      actions.push(
        `Force at least one ${coverage.missingKinds.join(" / ")} tool action before accepting the step.`
      );
    }

    if (diagnostics.failureClass === "tooling") {
      actions.push("Retry the step after inspecting failed tool outputs and narrowing the scope.");
    }

    if (diagnostics.failureClass === "policy") {
      actions.push("Collect explicit policy evidence or request approval before continuing.");
    }

    if (diagnostics.overallScore < 0.6) {
      actions.push("Escalate to a stronger specialist template if the next attempt still underperforms.");
    }

    return actions;
  }

  assessStep(
    step: MissionStep,
    output: RuntimeExecutionResult,
    decision: PolicyDecision,
    attempt: number
  ): StepExecutionDiagnostics {
    const coverage = this.coverageSnapshot(step, output);
    const evidence = this.evidenceSnapshot(output);
    const verificationScore = this.verificationScore(output);
    const policyPenalty = this.policyPenalty(step, decision);
    const overallScore = roundScore(
      coverage.score * 0.35 + evidence.score * 0.3 + verificationScore * 0.35 - policyPenalty
    );
    const missingSignals = this.missingSignals(step, output, coverage, evidence, decision);
    const failureClass = this.failureClass(step, output, coverage, decision);
    const riskFloor = capabilityRiskFloor[step.capability] ?? 0.6;
    const retryable =
      failureClass !== "none" ||
      overallScore < riskFloor ||
      (attempt <= 1 && missingSignals.length >= 2);
    const escalationRequired =
      ["security", "finance", "communication"].includes(step.capability) && overallScore < 0.76;

    const diagnostics: StepExecutionDiagnostics = {
      failureClass,
      evidenceScore: evidence.score,
      coverageScore: coverage.score,
      verificationScore,
      overallScore,
      retryable,
      escalationRequired,
      missingSignals,
      strengths: this.strengths(step, output, coverage, evidence),
      recommendedActions: []
    };

    diagnostics.recommendedActions = this.recommendedActions(step, diagnostics, coverage);
    return diagnostics;
  }

  buildMissionMetrics(
    reports: StepExecutionRecord[],
    artifacts: MissionArtifact[],
    decisionLog: MissionDecisionLogEntry[] = []
  ): MissionExecutionMetrics {
    const completedSteps = reports.filter((report) => report.status === "completed").length;
    const failedSteps = reports.filter((report) => report.status === "failed").length;
    const retriedSteps = reports.filter((report) => (report.attempts ?? 1) > 1).length;
    const replannedSteps = new Set(
      decisionLog
        .filter((entry) => entry.category === "replan" && entry.stepId)
        .map((entry) => entry.stepId as string)
    ).size;
    const qualityGateFailures = reports.filter(
      (report) => report.diagnostics && report.diagnostics.failureClass !== "none"
    ).length;
    const escalations = decisionLog.filter((entry) => entry.category === "escalation").length;
    const totalToolCalls = reports.reduce((total, report) => total + (report.toolCalls ?? 0), 0);
    const scoredReports = reports.filter(
      (report): report is StepExecutionRecord & { diagnostics: StepExecutionDiagnostics } =>
        Boolean(report.diagnostics)
    );
    const averageStepScore =
      scoredReports.length === 0
        ? 0
        : roundScore(
            scoredReports.reduce(
              (total, report) => total + (report.diagnostics?.overallScore ?? 0),
              0
            ) / scoredReports.length
          );

    const weakest = scoredReports.reduce<
      (StepExecutionRecord & { diagnostics: StepExecutionDiagnostics }) | undefined
    >((current, report) => {
      if (!current) {
        return report;
      }

      return (report.diagnostics?.overallScore ?? 0) < (current.diagnostics?.overallScore ?? 0)
        ? report
        : current;
    }, undefined);

    const strongest = scoredReports.reduce<
      (StepExecutionRecord & { diagnostics: StepExecutionDiagnostics }) | undefined
    >((current, report) => {
      if (!current) {
        return report;
      }

      return (report.diagnostics?.overallScore ?? 0) > (current.diagnostics?.overallScore ?? 0)
        ? report
        : current;
    }, undefined);

    return {
      totalSteps: reports.length,
      completedSteps,
      failedSteps,
      retriedSteps,
      replannedSteps,
      qualityGateFailures,
      escalations,
      totalToolCalls,
      totalArtifacts: artifacts.length,
      averageStepScore,
      weakestStepId: weakest?.stepId,
      strongestStepId: strongest?.stepId
    };
  }

  buildVerificationSummary(
    record: MissionRecord,
    reports: StepExecutionRecord[],
    metrics: MissionExecutionMetrics
  ) {
    const weakestReport = reports.find((report) => report.stepId === metrics.weakestStepId);
    const weakestNote =
      weakestReport?.diagnostics?.failureClass && weakestReport.diagnostics.failureClass !== "none"
        ? ` Weakest step: ${weakestReport.stepId} (${weakestReport.diagnostics.failureClass}).`
        : "";

    return [
      `Mission "${record.objective.title}" completed ${metrics.completedSteps}/${metrics.totalSteps} planned steps.`,
      `Average step score: ${metrics.averageStepScore.toFixed(2)}.`,
      `Tool calls executed: ${metrics.totalToolCalls}.`,
      metrics.retriedSteps > 0 ? `Retried steps: ${metrics.retriedSteps}.` : "No retries were needed.",
      metrics.replannedSteps > 0 ? `Adaptive replans: ${metrics.replannedSteps}.` : "",
      metrics.escalations > 0 ? `Escalations: ${metrics.escalations}.` : "",
      weakestNote.trim()
    ]
      .filter(Boolean)
      .join(" ");
  }

  buildMissionGaps(reports: StepExecutionRecord[]) {
    return reports.flatMap((report) =>
      report.diagnostics?.missingSignals?.map((signal) => `${report.stepId}: ${signal}`) ?? []
    );
  }

  buildMissionReport(
    record: MissionRecord,
    reports: StepExecutionRecord[],
    artifacts: MissionArtifact[],
    metrics: MissionExecutionMetrics,
    decisionLog: MissionDecisionLogEntry[] = [],
    replanHistory: MissionReplanPatch[] = []
  ) {
    return [
      `# Mission Report: ${record.objective.title}`,
      "",
      `Mission ID: ${record.objective.id}`,
      `Objective: ${record.objective.objective}`,
      "Status: completed",
      `Plan version: ${record.planVersion ?? 1}`,
      "",
      "## Metrics",
      `- Total steps: ${metrics.totalSteps}`,
      `- Completed steps: ${metrics.completedSteps}`,
      `- Retried steps: ${metrics.retriedSteps}`,
      `- Replanned steps: ${metrics.replannedSteps}`,
      `- Escalations: ${metrics.escalations}`,
      `- Quality-gate failures observed: ${metrics.qualityGateFailures}`,
      `- Total tool calls: ${metrics.totalToolCalls}`,
      `- Artifacts: ${metrics.totalArtifacts}`,
      `- Average step score: ${metrics.averageStepScore.toFixed(2)}`,
      metrics.weakestStepId ? `- Weakest step: ${metrics.weakestStepId}` : "",
      metrics.strongestStepId ? `- Strongest step: ${metrics.strongestStepId}` : "",
      "",
      "## Step Diagnostics",
      ...reports.flatMap((report) => [
        `### ${report.stepId}`,
        `- Summary: ${summarizeText(report.summary, 240)}`,
        `- Verification: ${report.verification}`,
        `- Attempts: ${report.attempts ?? 1}`,
        `- Tool calls: ${report.toolCalls ?? 0}`,
        `- Overall score: ${(report.diagnostics?.overallScore ?? 0).toFixed(2)}`,
        `- Failure class: ${report.diagnostics?.failureClass ?? "none"}`,
        `- Missing signals: ${
          report.diagnostics?.missingSignals?.length
            ? report.diagnostics.missingSignals.join(" | ")
            : "none"
        }`,
        `- Strengths: ${
          report.diagnostics?.strengths?.length ? report.diagnostics.strengths.join(" | ") : "none"
        }`,
        `- Recommended actions: ${
          report.diagnostics?.recommendedActions?.length
            ? report.diagnostics.recommendedActions.join(" | ")
            : "none"
        }`,
        ""
      ]),
      "## Decision Log",
      ...(decisionLog.length > 0
        ? decisionLog.flatMap((entry) => [
            `### ${entry.category} :: ${entry.severity}`,
            `- Step: ${entry.stepId ?? "mission"}`,
            `- Summary: ${entry.summary}`,
            `- Reasoning: ${entry.reasoning}`,
            `- Recommended actions: ${
              entry.recommendedActions.length > 0
                ? entry.recommendedActions.join(" | ")
                : "none"
            }`,
            ""
          ])
        : ["No decision log entries.", ""]),
      "## Replan History",
      ...(replanHistory.length > 0
        ? replanHistory.flatMap((patch) => [
            `### v${patch.planVersion} :: ${patch.triggeredByStepId}`,
            `- Summary: ${patch.summary}`,
            `- Reason: ${patch.reason}`,
            `- Inserted steps: ${patch.insertedStepIds.join(", ") || "none"}`,
            `- Deferred steps: ${patch.deferredStepIds.join(", ") || "none"}`,
            ""
          ])
        : ["No replans were applied.", ""]),
      "## Artifact Index",
      ...artifacts.map((artifact) => `- ${artifact.kind} :: ${artifact.title} :: ${artifact.path}`)
    ]
      .filter(Boolean)
      .join("\n");
  }
}
