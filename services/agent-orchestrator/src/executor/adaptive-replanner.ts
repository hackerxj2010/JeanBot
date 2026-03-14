import type {
  MissionDecisionLogEntry,
  MissionPlan,
  MissionRecord,
  MissionReplanPatch,
  MissionStep,
  StepExecutionDiagnostics,
  ToolKind
} from "@jeanbot/types";

const unique = <T>(values: T[]) => [...new Set(values)];

const summarizeText = (value: string, maxLength = 220) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
};

const capabilityToToolKind: Partial<Record<MissionStep["capability"], ToolKind>> = {
  filesystem: "filesystem",
  terminal: "terminal",
  browser: "browser",
  research: "search",
  memory: "memory",
  communication: "communication",
  automation: "automation",
  heartbeat: "automation",
  security: "policy",
  reasoning: "memory",
  orchestration: "audit",
  "software-development": "filesystem",
  "data-analysis": "terminal"
};

export interface StepExecutionFailureContext {
  step: MissionStep;
  attempts: number;
  errorMessage: string;
  diagnostics?: StepExecutionDiagnostics | undefined;
}

export interface AdaptiveReplanResult {
  patched: boolean;
  plan: MissionPlan;
  remediationSteps: MissionStep[];
  decisionEntries: MissionDecisionLogEntry[];
  replanPatch?: MissionReplanPatch | undefined;
}

interface RemediationBlueprint {
  title: string;
  description: string;
  capability: MissionStep["capability"];
  stage: MissionStep["stage"];
  assignee: string;
}

export class AdaptiveReplanner {
  private maxMissionReplans = 8;
  private maxStepReplans = 2;

  private planVersion(record: MissionRecord) {
    return record.plan?.version ?? record.planVersion ?? 1;
  }

  private decisionEntry(
    record: MissionRecord,
    failure: StepExecutionFailureContext,
    category: MissionDecisionLogEntry["category"],
    severity: MissionDecisionLogEntry["severity"],
    summary: string,
    reasoning: string,
    recommendedActions: string[],
    metadata: Record<string, unknown> = {}
  ): MissionDecisionLogEntry {
    return {
      id: crypto.randomUUID(),
      missionId: record.objective.id,
      planVersion: this.planVersion(record),
      scope: category === "failure" ? "recovery" : "step",
      category,
      severity,
      stepId: failure.step.id,
      summary,
      reasoning,
      recommendedActions,
      metadata,
      createdAt: new Date().toISOString()
    };
  }

  private stepReplanCount(record: MissionRecord, stepId: string) {
    return (record.replanHistory ?? []).filter((patch) => patch.triggeredByStepId === stepId).length;
  }

  private missionReplanCount(record: MissionRecord) {
    return record.replanHistory?.length ?? 0;
  }

  private parseMissingKinds(diagnostics: StepExecutionDiagnostics | undefined) {
    if (!diagnostics) {
      return [] as ToolKind[];
    }

    const kinds: ToolKind[] = [];
    const catalog: ToolKind[] = [
      "filesystem",
      "terminal",
      "browser",
      "search",
      "memory",
      "communication",
      "automation",
      "knowledge",
      "policy",
      "audit"
    ];

    for (const signal of diagnostics.missingSignals) {
      const lowered = signal.toLowerCase();
      for (const kind of catalog) {
        if (lowered.includes(kind)) {
          kinds.push(kind);
        }
      }
    }

    return unique(kinds);
  }

  private capabilityFromMissingKind(kind: ToolKind, fallback: MissionStep["capability"]) {
    switch (kind) {
      case "filesystem":
        return "filesystem";
      case "terminal":
        return "terminal";
      case "browser":
        return "browser";
      case "search":
      case "knowledge":
        return "research";
      case "communication":
        return "communication";
      case "automation":
        return "automation";
      case "memory":
        return "memory";
      case "policy":
      case "audit":
        return "security";
      default:
        return fallback;
    }
  }

  private remediationBlueprints(
    step: MissionStep,
    diagnostics: StepExecutionDiagnostics | undefined,
    errorMessage: string
  ): RemediationBlueprint[] {
    const blueprints: RemediationBlueprint[] = [];
    const missingKinds = this.parseMissingKinds(diagnostics);

    if (missingKinds.length > 0) {
      for (const kind of missingKinds) {
        const capability = this.capabilityFromMissingKind(kind, step.capability);
        blueprints.push({
          title: `Collect ${kind} evidence for ${step.title}`,
          description: `Gather explicit ${kind} evidence before retrying "${step.title}". Prior failure: ${summarizeText(errorMessage, 160)}`,
          capability,
          stage: capability === "security" ? "analysis" : "execution",
          assignee: capability === "security" ? "safety-agent" : "repair-agent"
        });
      }
    }

    switch (diagnostics?.failureClass) {
      case "coverage":
        blueprints.push({
          title: `Backfill missing coverage for ${step.title}`,
          description: `Force the missing tool families and evidence required for "${step.title}" before another attempt.`,
          capability: missingKinds[0] ? this.capabilityFromMissingKind(missingKinds[0], step.capability) : step.capability,
          stage: "execution",
          assignee: "repair-agent"
        });
        break;
      case "tooling":
        blueprints.push({
          title: `Stabilize tooling for ${step.title}`,
          description: `Inspect tool failures, reduce scope, and produce a clean execution path for "${step.title}".`,
          capability:
            step.capability === "software-development" || step.capability === "filesystem"
              ? "terminal"
              : step.capability,
          stage: "analysis",
          assignee: "repair-agent"
        });
        break;
      case "verification":
        blueprints.push({
          title: `Verify and explain ${step.title}`,
          description: `Run an explicit verification pass with stronger evidence requirements for "${step.title}".`,
          capability: "reasoning",
          stage: "verification",
          assignee: "verifier-agent"
        });
        break;
      case "policy":
        blueprints.push({
          title: `Collect policy evidence for ${step.title}`,
          description: `Produce explicit policy or approval evidence before "${step.title}" can continue safely.`,
          capability: "security",
          stage: "analysis",
          assignee: "safety-agent"
        });
        break;
      case "runtime":
        blueprints.push({
          title: `Repair runtime context for ${step.title}`,
          description: `Refresh context, reduce ambiguity, and prepare a narrower retry for "${step.title}".`,
          capability: "memory",
          stage: "analysis",
          assignee: "repair-agent"
        });
        break;
      default:
        break;
    }

    if (diagnostics?.escalationRequired) {
      blueprints.push({
        title: `Escalate review for ${step.title}`,
        description: `Route "${step.title}" through a stronger specialist review before retrying the original task.`,
        capability: step.capability === "security" ? "security" : "orchestration",
        stage: "analysis",
        assignee: "escalation-agent"
      });
    }

    if (blueprints.length === 0) {
      blueprints.push({
        title: `Repair path for ${step.title}`,
        description: `Generate a narrower recovery path for "${step.title}" because the current execution did not meet the quality bar.`,
        capability: step.capability,
        stage: "analysis",
        assignee: "repair-agent"
      });
    }

    return unique(
      blueprints.map((blueprint) => JSON.stringify(blueprint))
    ).map((serialized) => JSON.parse(serialized) as RemediationBlueprint);
  }

  private clonePlan(plan: MissionPlan): MissionPlan {
    return {
      ...plan,
      steps: plan.steps.map((step) => ({
        ...step,
        dependsOn: [...step.dependsOn]
      })),
      checkpoints: [...plan.checkpoints],
      alternatives: [...plan.alternatives]
    };
  }

  private buildRemediationSteps(
    record: MissionRecord,
    failure: StepExecutionFailureContext,
    nextPlanVersion: number
  ) {
    const blueprints = this.remediationBlueprints(
      failure.step,
      failure.diagnostics,
      failure.errorMessage
    );
    const remediationSteps: MissionStep[] = [];
    let dependencyCursor = [...failure.step.dependsOn];

    for (let index = 0; index < blueprints.length; index += 1) {
      const blueprint = blueprints[index];
      const stepId = `${record.objective.id}-replan-v${nextPlanVersion}-${failure.step.id}-${index + 1}`;
      const remediationStep: MissionStep = {
        id: stepId,
        title: blueprint.title,
        description: blueprint.description,
        capability: blueprint.capability,
        stage: blueprint.stage,
        toolKind: capabilityToToolKind[blueprint.capability],
        dependsOn: [...dependencyCursor],
        verification: `Confirm that ${blueprint.title.toLowerCase()} produced evidence that unblocks "${failure.step.title}".`,
        assignee: blueprint.assignee,
        status: dependencyCursor.length === 0 ? "ready" : "pending"
      };

      remediationSteps.push(remediationStep);
      dependencyCursor = [stepId];
    }

    return remediationSteps;
  }

  private canReplan(record: MissionRecord, failure: StepExecutionFailureContext) {
    if (!record.plan) {
      return false;
    }

    if (failure.step.stage === "delivery") {
      return false;
    }

    if (this.stepReplanCount(record, failure.step.id) >= this.maxStepReplans) {
      return false;
    }

    if (this.missionReplanCount(record) >= this.maxMissionReplans) {
      return false;
    }

    return Boolean(
      failure.diagnostics?.retryable ||
        failure.diagnostics?.failureClass === "policy" ||
        failure.diagnostics?.failureClass === "verification" ||
        failure.errorMessage.length > 0
    );
  }

  apply(record: MissionRecord, failure: StepExecutionFailureContext): AdaptiveReplanResult {
    if (!record.plan) {
      return {
        patched: false,
        plan: {
          id: `plan-${record.objective.id}`,
          missionId: record.objective.id,
          summary: "No plan available.",
          steps: [],
          estimatedDurationMinutes: 0,
          estimatedCostUsd: 0,
          checkpoints: [],
          alternatives: [],
          generatedAt: new Date().toISOString()
        },
        remediationSteps: [],
        decisionEntries: [
          this.decisionEntry(
            record,
            failure,
            "failure",
            "critical",
            `Mission "${record.objective.title}" cannot be replanned because no plan exists.`,
            "The executor raised a failure before a plan could be mutated.",
            ["Re-run planning before execution."]
          )
        ]
      };
    }

    const severity: MissionDecisionLogEntry["severity"] =
      failure.diagnostics?.escalationRequired || failure.step.stage === "verification"
        ? "critical"
        : "warning";
    const assessmentEntry = this.decisionEntry(
      record,
      failure,
      "assessment",
      severity,
      `Step "${failure.step.title}" failed its quality gate after ${failure.attempts} attempt(s).`,
      summarizeText(
        failure.diagnostics?.recommendedActions.join(" ") || failure.errorMessage,
        240
      ),
      failure.diagnostics?.recommendedActions ?? ["Inspect the failing step before continuing."],
      {
        attempts: failure.attempts,
        failureClass: failure.diagnostics?.failureClass ?? "runtime",
        overallScore: failure.diagnostics?.overallScore ?? 0
      }
    );

    if (!this.canReplan(record, failure)) {
      return {
        patched: false,
        plan: record.plan,
        remediationSteps: [],
        decisionEntries: [
          assessmentEntry,
          this.decisionEntry(
            record,
            failure,
            "failure",
            "critical",
            `Replan budget exhausted for "${failure.step.title}".`,
            "The step exceeded the allowed number of repair attempts or is in a non-repairable stage.",
            ["Escalate to manual review or narrow the mission scope."],
            {
              missionReplans: this.missionReplanCount(record),
              stepReplans: this.stepReplanCount(record, failure.step.id)
            }
          )
        ]
      };
    }

    const nextPlanVersion = this.planVersion(record) + 1;
    const patchedPlan = this.clonePlan(record.plan);
    patchedPlan.version = nextPlanVersion;
    const stepIndex = patchedPlan.steps.findIndex((step) => step.id === failure.step.id);
    if (stepIndex < 0) {
      return {
        patched: false,
        plan: record.plan,
        remediationSteps: [],
        decisionEntries: [
          assessmentEntry,
          this.decisionEntry(
            record,
            failure,
            "failure",
            "critical",
            `Failed step "${failure.step.id}" could not be found in the active plan.`,
            "The plan changed while the executor was attempting to patch it.",
            ["Reload mission state before retrying the replan."]
          )
        ]
      };
    }

    const remediationSteps = this.buildRemediationSteps(record, failure, nextPlanVersion);
    const originalStep = patchedPlan.steps[stepIndex];
    const deferredStep: MissionStep = {
      ...originalStep,
      dependsOn: remediationSteps.length > 0 ? remediationSteps.map((step) => step.id) : [...originalStep.dependsOn],
      status: remediationSteps.length === 0 && originalStep.dependsOn.length === 0 ? "ready" : "pending"
    };

    patchedPlan.steps.splice(stepIndex, 1, ...remediationSteps, deferredStep);
    patchedPlan.summary = `${record.plan.summary} Replanned around "${failure.step.title}" after execution diagnostics exposed gaps.`;
    patchedPlan.estimatedDurationMinutes += remediationSteps.length * 5;
    patchedPlan.alternatives = unique([
      ...patchedPlan.alternatives,
      `Adaptive replan inserted ${remediationSteps.length} remediation step(s) for "${failure.step.title}".`
    ]);
    patchedPlan.checkpoints = unique([
      ...patchedPlan.checkpoints,
      ...remediationSteps
        .filter((step) => step.capability === "filesystem" || step.capability === "security")
        .map((step) => step.id)
    ]);
    patchedPlan.generatedAt = new Date().toISOString();

    const replanPatch: MissionReplanPatch = {
      id: crypto.randomUUID(),
      missionId: record.objective.id,
      planVersion: nextPlanVersion,
      triggeredByStepId: failure.step.id,
      summary: `Inserted ${remediationSteps.length} remediation step(s) before retrying "${failure.step.title}".`,
      reason: failure.errorMessage,
      insertedStepIds: remediationSteps.map((step) => step.id),
      deferredStepIds: [failure.step.id],
      createdAt: new Date().toISOString()
    };

    const decisionEntries: MissionDecisionLogEntry[] = [
      assessmentEntry,
      this.decisionEntry(
        record,
        failure,
        "replan",
        severity,
        `Adaptive replan v${nextPlanVersion} inserted repair work before "${failure.step.title}".`,
        summarizeText(replanPatch.summary, 220),
        remediationSteps.map((step) => step.title),
        {
          insertedStepIds: replanPatch.insertedStepIds,
          planVersion: nextPlanVersion
        }
      )
    ];

    if (failure.diagnostics?.escalationRequired) {
      decisionEntries.push(
        this.decisionEntry(
          record,
          failure,
          "escalation",
          "critical",
          `Escalation required for "${failure.step.title}".`,
          "The diagnostics show the step is too weak for its risk class without a stronger review path.",
          ["Route the retry through the escalation step before accepting the result."],
          {
            failureClass: failure.diagnostics.failureClass,
            overallScore: failure.diagnostics.overallScore
          }
        )
      );
    }

    return {
      patched: true,
      plan: patchedPlan,
      remediationSteps,
      decisionEntries,
      replanPatch
    };
  }
}
