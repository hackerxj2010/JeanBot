import type { AgentRuntimeService } from "@jeanbot/agent-runtime";
import type { AuditService } from "@jeanbot/audit-service";
import type { FileService } from "@jeanbot/file-service";
import type { MemoryService } from "@jeanbot/memory-service";
import type { PolicyService } from "@jeanbot/policy-service";
import type { SubAgentService } from "@jeanbot/subagent-service";
import type {
  ExecutionContext,
  MissionDecisionLogEntry,
  MissionArtifact,
  MissionRecord,
  MissionReplanPatch,
  MissionRunResult,
  MissionStep,
  PolicyDecision,
  StepExecutionRecord,
  StepExecutionDiagnostics,
  SubAgentExecutionResult,
  SubAgentTemplate
} from "@jeanbot/types";

import { AdaptiveReplanner, type StepExecutionFailureContext } from "./adaptive-replanner.js";
import { MissionExecutionIntelligence } from "./execution-intelligence.js";

const sleep = (milliseconds: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const summarizeText = (value: string, maxLength = 220) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
};

const jsonPreview = (value: unknown, maxLength = 280) => {
  try {
    return summarizeText(JSON.stringify(value, null, 2), maxLength);
  } catch {
    return summarizeText(String(value), maxLength);
  }
};

export interface StepOutcome {
  step: MissionStep;
  report: StepExecutionRecord;
  output: SubAgentExecutionResult["output"];
  artifact: MissionArtifact;
  memoryText: string;
  runId: string;
  diagnostics: StepExecutionDiagnostics;
}

interface StepExecutionAttempt {
  subAgentResult: SubAgentExecutionResult;
  diagnostics: StepExecutionDiagnostics;
  attempts: number;
}

export class StepExecutionFailure extends Error implements StepExecutionFailureContext {
  constructor(
    readonly step: MissionStep,
    readonly attempts: number,
    readonly errorMessage: string,
    readonly diagnostics?: StepExecutionDiagnostics | undefined
  ) {
    super(errorMessage);
    this.name = "StepExecutionFailure";
  }
}

export class MissionExecutor {
  private readonly intelligence = new MissionExecutionIntelligence();
  private readonly replanner = new AdaptiveReplanner();

  constructor(
    private readonly runtime: AgentRuntimeService,
    private readonly memoryService: MemoryService,
    private readonly auditService: AuditService,
    private readonly subAgentService: SubAgentService,
    private readonly fileService: FileService,
    private readonly policyService: PolicyService
  ) {}

  private requirePlan(record: MissionRecord) {
    if (!record.plan) {
      throw new Error(`Mission "${record.objective.id}" has no plan.`);
    }

    return record.plan;
  }

  private templateByCapability(record: MissionRecord) {
    const templates = this.subAgentService.spawnForPlan(this.requirePlan(record));
    return new Map(
      templates.map((template) => [template.specialization, template] satisfies [string, SubAgentTemplate])
    );
  }

  private isReady(step: MissionStep, steps: MissionStep[]) {
    if (step.status === "completed" || step.status === "running" || step.status === "skipped") {
      return false;
    }

    return step.dependsOn.every((dependencyId) => {
      const dependency = steps.find((candidate) => candidate.id === dependencyId);
      return dependency?.status === "completed";
    });
  }

  private promoteReadySteps(steps: MissionStep[]) {
    for (const step of steps) {
      if (this.isReady(step, steps)) {
        step.status = "ready";
      } else if (step.status === "ready") {
        step.status = "pending";
      }
    }
  }

  private selectBatch(
    readySteps: MissionStep[],
    templateByCapability: Map<string, SubAgentTemplate>,
    maxParallelism: number
  ) {
    const batch: MissionStep[] = [];
    const perCapability = new Map<string, number>();

    for (const step of readySteps) {
      if (batch.length >= Math.max(1, maxParallelism)) {
        break;
      }

      const template = templateByCapability.get(step.capability);
      const currentCount = perCapability.get(step.capability) ?? 0;
      const limit = Math.max(1, template?.maxParallelTasks ?? 1);
      if (currentCount >= limit) {
        continue;
      }

      batch.push(step);
      perCapability.set(step.capability, currentCount + 1);
    }

    return batch;
  }

  private orderedReports(record: MissionRecord, reports: StepExecutionRecord[]) {
    const order = new Map(
      record.plan?.steps.map((step, index) => [step.id, index] satisfies [string, number]) ?? []
    );

    return [...reports].sort((left, right) => {
      return (order.get(left.stepId) ?? 0) - (order.get(right.stepId) ?? 0);
    });
  }

  private retryLimit(step: MissionStep) {
    if (step.stage === "preflight" || step.capability === "security") {
      return 1;
    }

    if (
      step.capability === "software-development" ||
      step.capability === "terminal" ||
      step.capability === "browser" ||
      step.capability === "research"
    ) {
      return 3;
    }

    return 2;
  }

  private async updateWorkspaceContext(
    record: MissionRecord,
    context: ExecutionContext
  ) {
    await this.fileService.updateWorkspaceContext(
      context.workspaceRoot,
      record.objective.title,
      record.plan?.steps
        .filter((candidate) => candidate.status === "completed")
        .map((candidate) => candidate.title) ?? [],
      record.plan?.steps
        .filter((candidate) => candidate.status === "running")
        .map((candidate) => candidate.title) ?? [],
      record.plan?.steps
        .filter((candidate) => candidate.status === "pending" || candidate.status === "ready")
        .map((candidate) => candidate.title) ?? []
    );
  }

  private appendDecisionEntries(
    record: MissionRecord,
    entries: MissionDecisionLogEntry[]
  ) {
    if (entries.length === 0) {
      return;
    }

    record.decisionLog = [...(record.decisionLog ?? []), ...entries];
  }

  private appendReplanPatch(
    record: MissionRecord,
    patch: MissionReplanPatch | undefined
  ) {
    if (!patch) {
      return;
    }

    record.replanHistory = [...(record.replanHistory ?? []), patch];
    record.planVersion = patch.planVersion;
    record.replanCount = (record.replanHistory ?? []).length;
  }

  private async persistDecisionLogArtifact(
    record: MissionRecord,
    context: ExecutionContext
  ) {
    const decisions = record.decisionLog ?? [];
    const replans = record.replanHistory ?? [];
    if (decisions.length === 0 && replans.length === 0) {
      return undefined;
    }

    const content = [
      `# Mission Decision Log: ${record.objective.title}`,
      "",
      `Mission ID: ${record.objective.id}`,
      `Plan version: ${record.planVersion ?? record.plan?.version ?? 1}`,
      `Replans: ${replans.length}`,
      "",
      "## Decisions",
      ...(decisions.length > 0
        ? decisions.flatMap((decision) => [
            `### ${decision.createdAt} :: ${decision.category} :: ${decision.severity}`,
            `- Scope: ${decision.scope}`,
            decision.stepId ? `- Step: ${decision.stepId}` : "",
            `- Summary: ${decision.summary}`,
            `- Reasoning: ${decision.reasoning}`,
            `- Recommended actions: ${
              decision.recommendedActions.length > 0
                ? decision.recommendedActions.join(" | ")
                : "none"
            }`,
            `- Metadata: ${jsonPreview(decision.metadata, 300)}`,
            ""
          ])
        : ["No decisions were logged.", ""]),
      "## Replan History",
      ...(replans.length > 0
        ? replans.flatMap((patch) => [
            `### v${patch.planVersion} :: ${patch.triggeredByStepId}`,
            `- Summary: ${patch.summary}`,
            `- Reason: ${patch.reason}`,
            `- Inserted steps: ${
              patch.insertedStepIds.length > 0 ? patch.insertedStepIds.join(", ") : "none"
            }`,
            `- Deferred steps: ${
              patch.deferredStepIds.length > 0 ? patch.deferredStepIds.join(", ") : "none"
            }`,
            ""
          ])
        : ["No replans were needed.", ""])
    ]
      .filter(Boolean)
      .join("\n");

    const artifactPath = await this.fileService.writeArtifact(
      context.workspaceRoot,
      record.objective.id,
      "mission-decision-log.md",
      content
    );

    return {
      id: crypto.randomUUID(),
      kind: "log" as const,
      title: "Mission decision log",
      path: artifactPath,
      createdAt: new Date().toISOString(),
      metadata: {
        missionId: record.objective.id,
        decisions: decisions.length,
        replans: replans.length
      }
    } satisfies MissionArtifact;
  }

  private async persistStepArtifact(
    record: MissionRecord,
    context: ExecutionContext,
    outcome: SubAgentExecutionResult,
    report: StepExecutionRecord
  ) {
    const content = [
      `# Step Report: ${outcome.stepReport.stepId}`,
      "",
      `Mission: ${record.objective.title}`,
      `Capability: ${outcome.run.capability}`,
      `Assignee: ${outcome.run.templateRole}`,
      `Run ID: ${outcome.run.id}`,
      `Status: ${outcome.run.status}`,
      `Model: ${outcome.run.provider}/${outcome.run.model}`,
      "",
      "## Summary",
      outcome.stepReport.summary,
      "",
      "## Verification",
      outcome.output.verification.reason,
      "",
      "## Diagnostics",
      `Overall score: ${(report.diagnostics?.overallScore ?? 0).toFixed(2)}`,
      `Evidence score: ${(report.diagnostics?.evidenceScore ?? 0).toFixed(2)}`,
      `Coverage score: ${(report.diagnostics?.coverageScore ?? 0).toFixed(2)}`,
      `Verification score: ${(report.diagnostics?.verificationScore ?? 0).toFixed(2)}`,
      `Failure class: ${report.diagnostics?.failureClass ?? "none"}`,
      `Retryable: ${report.diagnostics?.retryable ? "yes" : "no"}`,
      `Escalation required: ${report.diagnostics?.escalationRequired ? "yes" : "no"}`,
      "Missing signals:",
      ...(report.diagnostics?.missingSignals?.length
        ? report.diagnostics.missingSignals.map((signal) => `- ${signal}`)
        : ["- none"]),
      "",
      "Recommended actions:",
      ...(report.diagnostics?.recommendedActions?.length
        ? report.diagnostics.recommendedActions.map((action) => `- ${action}`)
        : ["- none"]),
      "",
      "## Final Text",
      outcome.output.finalText,
      "",
      "## Tool Calls",
      ...(outcome.output.toolCalls.length > 0
        ? outcome.output.toolCalls.map(
            (toolCall) =>
              `- ${toolCall.toolId} :: ${toolCall.action} :: ${toolCall.ok ? "ok" : "failed"}`
          )
        : ["- none"]),
      "",
      "## Provider Responses",
      ...outcome.output.providerResponses.map(
        (response, index) =>
          `- Turn ${index + 1}: ${response.provider}/${response.mode} :: ${summarizeText(response.message, 140)}`
      )
    ].join("\n");

    const fileName = `step-${outcome.stepReport.stepId}.md`;
    const artifactPath = await this.fileService.writeArtifact(
      context.workspaceRoot,
      record.objective.id,
      fileName,
      content
    );

    return {
      id: crypto.randomUUID(),
      kind: "log" as const,
      title: `Step report ${outcome.stepReport.stepId}`,
      path: artifactPath,
      createdAt: new Date().toISOString(),
      metadata: {
        stepId: outcome.stepReport.stepId,
        runId: outcome.run.id,
        toolCalls: outcome.output.toolCalls.length,
        overallScore: report.diagnostics?.overallScore ?? 0,
        failureClass: report.diagnostics?.failureClass ?? "none"
      }
    } satisfies MissionArtifact;
  }

  private async executeStepWithRetries(
    record: MissionRecord,
    step: MissionStep,
    template: SubAgentTemplate,
    context: ExecutionContext,
    policyDecision: PolicyDecision
  ): Promise<StepExecutionAttempt> {
    const limit = this.retryLimit(step);
    let lastError: unknown;

    for (let attempt = 1; attempt <= limit; attempt += 1) {
      try {
        await this.auditService.record("mission.step.attempt.started", step.id, "agent-orchestrator", {
          missionId: record.objective.id,
          attempt,
          capability: step.capability
        });

        const subAgentResult = await this.subAgentService.runStep({
          missionId: record.objective.id,
          objective: record.objective,
          plan: this.requirePlan(record),
          step,
          template,
          context,
          authContext: context.authContext,
          attempt
        });

        const diagnostics = this.intelligence.assessStep(
          step,
          subAgentResult.output,
          policyDecision,
          attempt
        );

        await this.auditService.record("mission.step.attempt.assessed", step.id, "agent-orchestrator", {
          missionId: record.objective.id,
          attempt,
          overallScore: diagnostics.overallScore,
          failureClass: diagnostics.failureClass,
          retryable: diagnostics.retryable,
          escalationRequired: diagnostics.escalationRequired
        });

        const qualityGateFailed =
          diagnostics.failureClass !== "none" || diagnostics.missingSignals.length >= 2;

        if (qualityGateFailed && diagnostics.retryable && attempt < limit) {
          await this.auditService.record("mission.step.attempt.retry_scheduled", step.id, "agent-orchestrator", {
            missionId: record.objective.id,
            attempt,
            reason: diagnostics.recommendedActions.join(" | ") || diagnostics.failureClass
          });
          await sleep(Math.min(175 * attempt, 650));
          continue;
        }

        if (qualityGateFailed && attempt >= limit) {
          throw new StepExecutionFailure(
            step,
            attempt,
            `Step "${step.id}" failed the quality gate after ${attempt} attempt(s): ${diagnostics.recommendedActions.join(" ")}`,
            diagnostics
          );
        }

        return {
          subAgentResult,
          diagnostics,
          attempts: attempt
        };
      } catch (error) {
        lastError = error;
        await this.auditService.record("mission.step.attempt.failed", step.id, "agent-orchestrator", {
          missionId: record.objective.id,
          attempt,
          error: error instanceof Error ? error.message : String(error)
        });

        if (attempt >= limit) {
          break;
        }

        await sleep(Math.min(150 * attempt, 500));
      }
    }

    if (lastError instanceof StepExecutionFailure) {
      throw lastError;
    }

    throw new StepExecutionFailure(
      step,
      limit,
      lastError instanceof Error
        ? lastError.message
        : `Step "${step.id}" failed after ${limit} attempt(s).`,
      undefined
    );
  }

  private async executeStep(
    record: MissionRecord,
    step: MissionStep,
    template: SubAgentTemplate,
    context: ExecutionContext
  ): Promise<StepOutcome> {
    const stepStartedAt = new Date().toISOString();
    step.status = "running";

    await this.auditService.record("mission.step.started", step.id, "agent-orchestrator", {
      missionId: record.objective.id,
      capability: step.capability,
      stage: step.stage
    });

    const policyDecision = this.policyService.evaluateMission({
      ...record.objective,
      title: `${record.objective.title} :: ${step.title}`,
      objective: `${record.objective.objective}\n${step.description}`
    });

    await this.auditService.record("mission.step.policy.checked", step.id, "policy-service", {
      missionId: record.objective.id,
      approvalRequired: policyDecision.approvalRequired,
      risk: policyDecision.risk
    });

    const runtimePreview = await this.runtime.prepareFrame(
      record.objective,
      step,
      this.requirePlan(record),
      template,
      context
    );

    const executionAttempt = await this.executeStepWithRetries(
      record,
      step,
      template,
      context,
      policyDecision
    );
    const subAgentResult = executionAttempt.subAgentResult;
    step.status = "completed";

    const report: StepExecutionRecord = {
      ...subAgentResult.stepReport,
      startedAt: stepStartedAt,
      attempts: executionAttempt.attempts,
      diagnostics: executionAttempt.diagnostics
    };

    const artifact = await this.persistStepArtifact(record, context, subAgentResult, report);
    await this.memoryService.remember(
      record.objective.workspaceId,
      subAgentResult.memoryText,
      [
        step.capability,
        step.stage ?? "execution",
        template.role,
        executionAttempt.diagnostics.failureClass
      ],
      step.stage === "verification" || step.stage === "delivery" ? "long-term" : "session",
      step.stage === "verification" || step.stage === "delivery"
        ? Math.max(0.8, executionAttempt.diagnostics.overallScore)
        : Math.max(0.55, executionAttempt.diagnostics.overallScore)
    );

    await this.auditService.record("mission.step.completed", step.id, "agent-orchestrator", {
      missionId: record.objective.id,
      capability: step.capability,
      model: runtimePreview.model.model,
      runId: subAgentResult.run.id,
      overallScore: executionAttempt.diagnostics.overallScore,
      failureClass: executionAttempt.diagnostics.failureClass,
      attempts: executionAttempt.attempts
    });

    return {
      step,
      report,
      output: subAgentResult.output,
      artifact,
      memoryText: subAgentResult.memoryText,
      runId: subAgentResult.run.id,
      diagnostics: executionAttempt.diagnostics
    };
  }

  private async applyAdaptiveReplan(
    record: MissionRecord,
    failure: StepExecutionFailure,
    context: ExecutionContext
  ) {
    const plan = this.requirePlan(record);
    const currentStep = plan.steps.find((candidate) => candidate.id === failure.step.id) ?? failure.step;
    const replan = this.replanner.apply(record, {
      step: currentStep,
      attempts: failure.attempts,
      errorMessage: failure.errorMessage,
      diagnostics: failure.diagnostics
    });

    this.appendDecisionEntries(record, replan.decisionEntries);
    for (const entry of replan.decisionEntries) {
      await this.auditService.record(
        `mission.decision.${entry.category}`,
        entry.stepId ?? record.objective.id,
        "agent-orchestrator",
        {
          missionId: record.objective.id,
          planVersion: entry.planVersion,
          severity: entry.severity,
          summary: entry.summary,
          reasoning: entry.reasoning
        }
      );
    }

    if (!replan.patched) {
      return false;
    }

    record.plan = replan.plan;
    this.appendReplanPatch(record, replan.replanPatch);

    await this.auditService.record("mission.replanned", failure.step.id, "agent-orchestrator", {
      missionId: record.objective.id,
      insertedSteps: replan.remediationSteps.map((step) => step.id),
      planVersion: record.planVersion ?? replan.plan.version ?? 1
    });

    await this.persistDecisionLogArtifact(record, context);

    return true;
  }

  private buildMissionReport(
    record: MissionRecord,
    reports: StepExecutionRecord[],
    artifacts: MissionArtifact[]
  ) {
    const metrics = this.intelligence.buildMissionMetrics(reports, artifacts, record.decisionLog);
    return this.intelligence.buildMissionReport(
      record,
      reports,
      artifacts,
      metrics,
      record.decisionLog,
      record.replanHistory
    );
  }

  private syncRemainingSteps(
    record: MissionRecord,
    remainingSteps: Set<string>
  ) {
    const plan = this.requirePlan(record);
    for (const step of plan.steps) {
      if (step.status === "completed" || step.status === "skipped") {
        remainingSteps.delete(step.id);
        continue;
      }

      remainingSteps.add(step.id);
    }
  }

  findStep(record: MissionRecord, stepId: string) {
    return this.requirePlan(record).steps.find((step) => step.id === stepId);
  }

  async executeQueuedStep(
    record: MissionRecord,
    stepId: string,
    context: ExecutionContext
  ): Promise<StepOutcome> {
    const step = this.findStep(record, stepId);
    if (!step) {
      throw new Error(`Step "${stepId}" not found for mission "${record.objective.id}".`);
    }

    const template = this.templateByCapability(record).get(step.capability);
    if (!template) {
      throw new Error(`Missing sub-agent template for capability "${step.capability}".`);
    }

    return this.executeStep(record, step, template, context);
  }

  async recoverFailedStep(
    record: MissionRecord,
    failure: StepExecutionFailure,
    context: ExecutionContext
  ) {
    return this.applyAdaptiveReplan(record, failure, context);
  }

  async finalizeDistributedExecution(
    record: MissionRecord,
    context: ExecutionContext
  ): Promise<MissionRunResult> {
    const activeExecution = record.activeExecution;
    if (!activeExecution) {
      throw new Error(`Mission "${record.objective.id}" has no active execution state.`);
    }

    const artifacts = [...activeExecution.artifacts];
    const orderedReports = this.orderedReports(record, activeExecution.stepReports);
    const decisionArtifact = await this.persistDecisionLogArtifact(record, context);
    if (decisionArtifact) {
      artifacts.push(decisionArtifact);
    }

    const metrics = this.intelligence.buildMissionMetrics(
      orderedReports,
      artifacts,
      record.decisionLog
    );
    const gaps = this.intelligence.buildMissionGaps(orderedReports);
    const reportContent = this.buildMissionReport(record, orderedReports, artifacts);
    const reportPath = await this.fileService.writeArtifact(
      context.workspaceRoot,
      record.objective.id,
      "mission-report.md",
      reportContent
    );

    artifacts.push({
      id: crypto.randomUUID(),
      kind: "report",
      title: "Mission report",
      path: reportPath,
      createdAt: new Date().toISOString(),
      metadata: {
        missionId: record.objective.id,
        stepCount: orderedReports.length
      }
    });

    return {
      missionId: record.objective.id,
      status: "completed",
      executionMode: "distributed",
      verificationSummary: this.intelligence.buildVerificationSummary(record, orderedReports, metrics),
      outputs: activeExecution.outputs,
      memoryUpdates: activeExecution.memoryUpdates,
      stepReports: orderedReports,
      artifacts,
      metrics: {
        ...metrics,
        totalArtifacts: artifacts.length
      },
      gaps,
      decisionLog: record.decisionLog,
      startedAt: activeExecution.startedAt,
      finishedAt: new Date().toISOString()
    };
  }

  async execute(record: MissionRecord, context: ExecutionContext): Promise<MissionRunResult> {
    const startedAt = new Date().toISOString();
    const outputs: Record<string, unknown> = {};
    const memoryUpdates: string[] = [];
    const stepReports: StepExecutionRecord[] = [];
    const artifacts: MissionArtifact[] = [];
    const remainingSteps = new Set(this.requirePlan(record).steps.map((step) => step.id));

    while (remainingSteps.size > 0) {
      const activePlan = this.requirePlan(record);
      const templateByCapability = this.templateByCapability(record);
      this.promoteReadySteps(activePlan.steps);
      this.syncRemainingSteps(record, remainingSteps);
      const readySteps = activePlan.steps.filter((step) => step.status === "ready");

      if (readySteps.length === 0) {
        throw new Error(
          `Mission "${record.objective.id}" cannot make progress because no steps are ready.`
        );
      }

      const batch = this.selectBatch(readySteps, templateByCapability, context.maxParallelism);
      await this.auditService.record("mission.batch.started", record.objective.id, "agent-orchestrator", {
        batchSize: batch.length,
        stepIds: batch.map((step) => step.id)
      });

      const batchResults = await Promise.allSettled(
        batch.map(async (step) => {
          const template = templateByCapability.get(step.capability);
          if (!template) {
            throw new Error(`Missing sub-agent template for capability "${step.capability}".`);
          }

          return this.executeStep(record, step, template, context);
        })
      );

      let replanApplied = false;
      let unrecoverableFailure: unknown;

      for (let index = 0; index < batchResults.length; index += 1) {
        const settled = batchResults[index];
        const step = batch[index];
        if (settled.status === "fulfilled") {
          const outcome = settled.value;
          outputs[outcome.step.id] = {
            assignee: outcome.step.assignee,
            runId: outcome.runId,
            result: outcome.output,
            payloadPreview: jsonPreview(outcome.output.providerResponses)
          };
          memoryUpdates.push(outcome.memoryText);
          stepReports.push(outcome.report);
          artifacts.push(outcome.artifact);
          remainingSteps.delete(outcome.step.id);
          continue;
        }

        const reason = settled.reason;
        if (reason instanceof StepExecutionFailure) {
          const patched = await this.applyAdaptiveReplan(record, reason, context);
          if (patched) {
            replanApplied = true;
            step.status = "pending";
            continue;
          }
        }

        unrecoverableFailure = reason;
      }

      if (unrecoverableFailure) {
        throw unrecoverableFailure;
      }

      if (replanApplied) {
        this.syncRemainingSteps(record, remainingSteps);
        await this.updateWorkspaceContext(record, context);
        await this.auditService.record("mission.batch.replanned", record.objective.id, "agent-orchestrator", {
          remainingSteps: remainingSteps.size,
          planVersion: record.planVersion ?? record.plan?.version ?? 1
        });
        continue;
      }

      await this.updateWorkspaceContext(record, context);
      await this.auditService.record("mission.batch.completed", record.objective.id, "agent-orchestrator", {
        completedSteps: batchResults
          .filter(
            (outcome): outcome is PromiseFulfilledResult<StepOutcome> => outcome.status === "fulfilled"
          )
          .map((outcome) => outcome.value.step.id),
        remainingSteps: remainingSteps.size
      });
    }

    const orderedReports = this.orderedReports(record, stepReports);
    const decisionArtifact = await this.persistDecisionLogArtifact(record, context);
    if (decisionArtifact) {
      artifacts.push(decisionArtifact);
    }

    const metrics = this.intelligence.buildMissionMetrics(
      orderedReports,
      artifacts,
      record.decisionLog
    );
    const gaps = this.intelligence.buildMissionGaps(orderedReports);
    const reportContent = this.buildMissionReport(record, orderedReports, artifacts);
    const reportPath = await this.fileService.writeArtifact(
      context.workspaceRoot,
      record.objective.id,
      "mission-report.md",
      reportContent
    );

    artifacts.push({
      id: crypto.randomUUID(),
      kind: "report",
      title: "Mission report",
      path: reportPath,
      createdAt: new Date().toISOString(),
      metadata: {
        missionId: record.objective.id,
        stepCount: orderedReports.length
      }
    });

    return {
      missionId: record.objective.id,
      status: "completed",
      executionMode: "local",
      verificationSummary: this.intelligence.buildVerificationSummary(record, orderedReports, metrics),
      outputs,
      memoryUpdates,
      stepReports: orderedReports,
      artifacts,
      metrics: {
        ...metrics,
        totalArtifacts: artifacts.length
      },
      gaps,
      decisionLog: record.decisionLog,
      startedAt,
      finishedAt: new Date().toISOString()
    };
  }
}
