import path from "node:path";

import { AgentRuntimeService } from "@jeanbot/agent-runtime";
import { AuditService } from "@jeanbot/audit-service";
import { LocalJsonStore, ensureDirectory } from "@jeanbot/documents";
import { createLogger } from "@jeanbot/logger";
import { applyProviderPreference } from "@jeanbot/model-router";
import type {
  Capability,
  MissionPlan,
  MissionStep,
  RuntimeExecutionResult,
  ServiceHealth,
  SubAgentExecutionRequest,
  SubAgentExecutionResult,
  SubAgentRunRecord,
  SubAgentRunStatus,
  SubAgentTemplate
} from "@jeanbot/types";

interface TemplateDefinition {
  role: string;
  instructions: string;
  toolIds: string[];
  provider: SubAgentTemplate["provider"];
  model: string;
  timeoutMs: number;
  maxParallelTasks: number;
  escalationThreshold: SubAgentTemplate["escalationThreshold"];
}

interface CapacityTicket {
  workspaceId: string;
  capability: Capability;
  runId: string;
}

const sleep = (milliseconds: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const templateByCapability: Record<Capability, TemplateDefinition> = {
  reasoning: {
    role: "strategist",
    instructions:
      "Resolve ambiguity, verify whether the current mission state is coherent, and only advance when the reasoning chain is defensible.",
    toolIds: ["memory.recall", "memory.summary", "audit.list", "policy.evaluate", "knowledge.summary"],
    provider: "anthropic",
    model: "claude-haiku-4-5",
    timeoutMs: 90_000,
    maxParallelTasks: 2,
    escalationThreshold: "high"
  },
  planning: {
    role: "planner",
    instructions:
      "Turn the mission objective into a concrete sequence of verifiable actions, dependencies, and fallback branches.",
    toolIds: [
      "memory.recall",
      "memory.summary",
      "audit.list",
      "policy.evaluate",
      "knowledge.query",
      "knowledge.summary",
      "filesystem.workspace.context.update"
    ],
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    timeoutMs: 120_000,
    maxParallelTasks: 2,
    escalationThreshold: "high"
  },
  terminal: {
    role: "terminal-operator",
    instructions:
      "Use shell access conservatively, keep cwd scoped to the mission workspace, and prefer diagnostic commands before mutation.",
    toolIds: [
      "terminal.command.run",
      "terminal.command.output",
      "terminal.command.list",
      "filesystem.workspace.scan",
      "filesystem.checkpoint.create",
      "audit.list"
    ],
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    timeoutMs: 180_000,
    maxParallelTasks: 2,
    escalationThreshold: "high"
  },
  browser: {
    role: "browser-operator",
    instructions:
      "Navigate deliberately, capture only what supports the mission, and keep a minimal browser footprint.",
    toolIds: [
      "browser.session.navigate",
      "browser.session.extract",
      "browser.session.capture",
      "browser.session.events",
      "search.query",
      "audit.list"
    ],
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    timeoutMs: 150_000,
    maxParallelTasks: 2,
    escalationThreshold: "medium"
  },
  filesystem: {
    role: "file-operator",
    instructions:
      "Inspect files, validate current workspace state, and insist on checkpoints before risky modifications or deletions.",
    toolIds: [
      "filesystem.workspace.scan",
      "filesystem.checkpoint.create",
      "filesystem.workspace.context.update",
      "filesystem.artifact.write",
      "filesystem.jean.read",
      "audit.list"
    ],
    provider: "anthropic",
    model: "claude-haiku-4-5",
    timeoutMs: 90_000,
    maxParallelTasks: 3,
    escalationThreshold: "high"
  },
  memory: {
    role: "memory-curator",
    instructions:
      "Load relevant workspace memory, avoid duplicates, and convert noisy history into durable summaries.",
    toolIds: ["memory.recall", "memory.summary", "memory.remember", "knowledge.query", "knowledge.summary"],
    provider: "openai",
    model: "gpt-4.1-mini",
    timeoutMs: 90_000,
    maxParallelTasks: 2,
    escalationThreshold: "medium"
  },
  research: {
    role: "researcher",
    instructions:
      "Collect evidence, distinguish primary signals from noise, and summarize findings with explicit caveats.",
    toolIds: [
      "search.query",
      "browser.session.navigate",
      "browser.session.extract",
      "browser.session.capture",
      "knowledge.query",
      "knowledge.summary"
    ],
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    timeoutMs: 180_000,
    maxParallelTasks: 3,
    escalationThreshold: "medium"
  },
  subagents: {
    role: "coordinator",
    instructions:
      "Distribute safe parallel work, consolidate outputs, and surface contradictions before execution continues.",
    toolIds: ["audit.list", "memory.recall", "memory.summary", "policy.evaluate", "filesystem.workspace.context.update"],
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    timeoutMs: 120_000,
    maxParallelTasks: 1,
    escalationThreshold: "high"
  },
  communication: {
    role: "communicator",
    instructions:
      "Draft external communication carefully, keep the tone professional, and never bypass approval gates for sending.",
    toolIds: [
      "communication.message.draft",
      "communication.message.send",
      "communication.message.list",
      "policy.evaluate"
    ],
    provider: "anthropic",
    model: "claude-haiku-4-5",
    timeoutMs: 90_000,
    maxParallelTasks: 1,
    escalationThreshold: "high"
  },
  skills: {
    role: "skill-integrator",
    instructions:
      "Use the smallest safe integration surface, document required configuration, and avoid loading unnecessary skills.",
    toolIds: ["knowledge.query", "knowledge.summary", "memory.recall", "memory.summary"],
    provider: "anthropic",
    model: "claude-haiku-4-5",
    timeoutMs: 120_000,
    maxParallelTasks: 1,
    escalationThreshold: "medium"
  },
  "software-development": {
    role: "coder",
    instructions:
      "Implement high-signal backend changes, validate with tests where possible, and call out residual risk explicitly.",
      toolIds: [
        "filesystem.workspace.scan",
        "filesystem.checkpoint.create",
        "filesystem.artifact.write",
        "terminal.command.run",
        "terminal.command.output",
        "memory.recall",
        "memory.summary",
        "knowledge.query",
        "knowledge.summary"
      ],
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    timeoutMs: 240_000,
    maxParallelTasks: 2,
    escalationThreshold: "high"
  },
  "data-analysis": {
    role: "analyst",
    instructions:
      "Structure data, run light analysis, and return decisions that can be defended from the evidence.",
    toolIds: [
      "memory.recall",
      "memory.summary",
      "terminal.command.run",
      "terminal.command.output",
      "knowledge.query",
      "knowledge.summary",
      "filesystem.artifact.write"
    ],
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    timeoutMs: 180_000,
    maxParallelTasks: 2,
    escalationThreshold: "medium"
  },
  writing: {
    role: "writer",
    instructions:
      "Produce concise structured output that can be handed directly to the user or stored as knowledge without cleanup.",
    toolIds: [
      "knowledge.document.ingest",
      "memory.recall",
      "memory.remember",
      "filesystem.artifact.write",
      "audit.list"
    ],
    provider: "anthropic",
    model: "claude-haiku-4-5",
    timeoutMs: 90_000,
    maxParallelTasks: 2,
    escalationThreshold: "medium"
  },
  automation: {
    role: "automation-engineer",
    instructions:
      "Design repeatable workflows with clear triggers, failure handling, and observable outputs.",
    toolIds: [
      "audit.list",
      "knowledge.query",
      "knowledge.summary",
      "memory.recall",
      "automation.heartbeat.list",
      "automation.heartbeat.summary",
      "filesystem.workspace.context.update"
    ],
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    timeoutMs: 120_000,
    maxParallelTasks: 1,
    escalationThreshold: "medium"
  },
  "project-management": {
    role: "project-manager",
    instructions:
      "Track progress, consolidate execution state, and surface blockers or missing dependencies before they become failures.",
    toolIds: [
      "audit.list",
      "memory.recall",
      "memory.summary",
      "policy.evaluate",
      "filesystem.workspace.context.update",
      "filesystem.artifact.write"
    ],
    provider: "anthropic",
    model: "claude-haiku-4-5",
    timeoutMs: 90_000,
    maxParallelTasks: 1,
    escalationThreshold: "medium"
  },
  heartbeat: {
    role: "monitor",
    instructions:
      "Focus on checks, anomalies, and reliable notification criteria with minimal noise.",
    toolIds: [
      "audit.list",
      "search.query",
      "memory.recall",
      "automation.heartbeat.list",
      "automation.heartbeat.summary",
      "communication.message.draft"
    ],
    provider: "anthropic",
    model: "claude-haiku-4-5",
    timeoutMs: 90_000,
    maxParallelTasks: 2,
    escalationThreshold: "medium"
  },
  security: {
    role: "security-reviewer",
    instructions:
      "Reduce blast radius, flag unsafe actions, and prefer approval or rollback paths over optimistic execution.",
    toolIds: ["policy.evaluate", "audit.list", "memory.recall", "memory.summary", "knowledge.summary"],
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    timeoutMs: 120_000,
    maxParallelTasks: 1,
    escalationThreshold: "high"
  },
  learning: {
    role: "learning-curator",
    instructions:
      "Extract reusable lessons, preferences, and operator guidance from the mission without copying noise.",
    toolIds: ["memory.recall", "memory.remember", "knowledge.document.ingest", "knowledge.summary"],
    provider: "openai",
    model: "gpt-4.1-mini",
    timeoutMs: 90_000,
    maxParallelTasks: 1,
    escalationThreshold: "medium"
  },
  multimodality: {
    role: "multimodal-operator",
    instructions:
      "Summarize non-text artifacts carefully and only claim what can be observed from the available media context.",
    toolIds: ["browser.session.navigate", "browser.session.extract", "browser.session.capture", "knowledge.query"],
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    timeoutMs: 120_000,
    maxParallelTasks: 1,
    escalationThreshold: "medium"
  },
  finance: {
    role: "finance-operator",
    instructions:
      "Treat all finance actions as approval gated, preserve traceability, and avoid silent assumptions around money movement.",
    toolIds: ["policy.evaluate", "audit.list", "communication.message.draft", "communication.message.list"],
    provider: "anthropic",
    model: "claude-opus-4-6",
    timeoutMs: 150_000,
    maxParallelTasks: 1,
    escalationThreshold: "critical"
  },
  orchestration: {
    role: "orchestrator",
    instructions:
      "Merge sub-results into one coherent answer, make conflicts explicit, and keep the final state consistent.",
    toolIds: [
      "audit.list",
      "memory.recall",
      "memory.summary",
      "knowledge.document.ingest",
      "filesystem.artifact.write",
      "filesystem.workspace.context.update"
    ],
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    timeoutMs: 120_000,
    maxParallelTasks: 1,
    escalationThreshold: "high"
  },
  synthesis: {
    role: "meta-agent",
    instructions:
      "Synthesize new tool logic and capabilities dynamically when existing ones are insufficient. Ensure all synthesized logic is secure and verifiable.",
    toolIds: ["synthesis.tool.generate", "filesystem.workspace.scan", "terminal.command.run", "policy.evaluate"],
    provider: "anthropic",
    model: "claude-opus-4-6",
    timeoutMs: 240_000,
    maxParallelTasks: 1,
    escalationThreshold: "critical"
  },
  verification: {
    role: "verifier",
    instructions:
      "Perform adversarial verification of mission outputs. Run tests, verify requirements, and ensure no regressions or security gaps.",
    toolIds: ["terminal.command.run", "filesystem.workspace.scan", "search.query", "knowledge.query"],
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    timeoutMs: 180_000,
    maxParallelTasks: 2,
    escalationThreshold: "high"
  }
};

const summarizeText = (value: string, maxLength = 180) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
};

const normalizeTimeout = (template: SubAgentTemplate) => {
  const timeoutMs = template.timeoutMs ?? 120_000;
  return Math.min(Math.max(timeoutMs, 5_000), 15 * 60_000);
};

const buildCapabilityKey = (workspaceId: string, capability: Capability) =>
  `${workspaceId}:${capability}`;

const normalizeErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const runStatusOrder: SubAgentRunStatus[] = [
  "queued",
  "running",
  "completed",
  "failed",
  "timed_out",
  "cancelled"
];

const sortRuns = (left: SubAgentRunRecord, right: SubAgentRunRecord) => {
  const statusDelta =
    runStatusOrder.indexOf(left.status) - runStatusOrder.indexOf(right.status);
  if (statusDelta !== 0) {
    return statusDelta;
  }

  return left.createdAt.localeCompare(right.createdAt);
};

export class SubAgentService {
  private readonly logger = createLogger("subagent-service");
  private readonly runtimeService: AgentRuntimeService;
  private readonly auditService: AuditService;
  private readonly runStore = new LocalJsonStore<SubAgentRunRecord>(
    ensureDirectory(path.resolve("tmp", "subagent-service", "runs"))
  );
  private readonly activeByWorkspace = new Map<string, Set<string>>();
  private readonly activeByCapability = new Map<string, Set<string>>();

  constructor(dependencies?: {
    runtimeService?: AgentRuntimeService;
    auditService?: AuditService;
  }) {
    this.runtimeService = dependencies?.runtimeService ?? new AgentRuntimeService();
    this.auditService = dependencies?.auditService ?? new AuditService();
  }

  private templateDefinition(capability: Capability) {
    return templateByCapability[capability];
  }

  templateForCapability(capability: Capability, stepCount = 1): SubAgentTemplate {
    const definition = this.templateDefinition(capability);
    const selection = applyProviderPreference({
      provider: definition.provider ?? "anthropic",
      model: definition.model,
      reason: `Default template route for the ${capability} capability.`
    });
    return {
      id: `subagent-${capability}`,
      role: definition.role,
      specialization: capability,
      instructions: definition.instructions,
      maxParallelTasks: Math.max(
        1,
        Math.min(4, Math.max(definition.maxParallelTasks, Math.ceil(stepCount / 2)))
      ),
      timeoutMs: definition.timeoutMs,
      provider: selection.provider as SubAgentTemplate["provider"],
      model: selection.model,
      toolIds: [...definition.toolIds],
      escalationThreshold: definition.escalationThreshold
    };
  }

  listTemplates() {
    return Object.keys(templateByCapability)
      .map((capability) => capability as Capability)
      .map((capability) => this.templateForCapability(capability));
  }

  spawnForPlan(plan: MissionPlan): SubAgentTemplate[] {
    const capabilityCounts = plan.steps.reduce<Map<Capability, number>>((accumulator, step) => {
      accumulator.set(step.capability, (accumulator.get(step.capability) ?? 0) + 1);
      return accumulator;
    }, new Map<Capability, number>());

    const templates = [...capabilityCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([capability, count]) => this.templateForCapability(capability, count));

    this.logger.info("Spawned sub-agent templates", { count: templates.length });
    return templates;
  }

  assignStep(step: MissionStep) {
    return this.templateDefinition(step.capability).role;
  }

  private workspaceRuns(workspaceId: string) {
    return this.runStore.list().filter((run) => run.workspaceId === workspaceId).sort(sortRuns);
  }

  private persistRun(run: SubAgentRunRecord) {
    return this.runStore.write(
      `${run.workspaceId}/${run.missionId}/${run.stepId}/${run.id}`,
      run
    );
  }

  private patchRun(runId: string, mutate: (run: SubAgentRunRecord) => SubAgentRunRecord) {
    const current = this.getRun(runId);
    if (!current) {
      throw new Error(`Sub-agent run "${runId}" not found.`);
    }

    return this.persistRun(mutate(current));
  }

  private claimRun(ticket: CapacityTicket) {
    const workspaceRuns = this.activeByWorkspace.get(ticket.workspaceId) ?? new Set<string>();
    workspaceRuns.add(ticket.runId);
    this.activeByWorkspace.set(ticket.workspaceId, workspaceRuns);

    const capabilityKey = buildCapabilityKey(ticket.workspaceId, ticket.capability);
    const capabilityRuns = this.activeByCapability.get(capabilityKey) ?? new Set<string>();
    capabilityRuns.add(ticket.runId);
    this.activeByCapability.set(capabilityKey, capabilityRuns);
  }

  private releaseRun(ticket: CapacityTicket) {
    const workspaceRuns = this.activeByWorkspace.get(ticket.workspaceId);
    workspaceRuns?.delete(ticket.runId);
    if (workspaceRuns && workspaceRuns.size === 0) {
      this.activeByWorkspace.delete(ticket.workspaceId);
    }

    const capabilityKey = buildCapabilityKey(ticket.workspaceId, ticket.capability);
    const capabilityRuns = this.activeByCapability.get(capabilityKey);
    capabilityRuns?.delete(ticket.runId);
    if (capabilityRuns && capabilityRuns.size === 0) {
      this.activeByCapability.delete(capabilityKey);
    }
  }

  private hasCapacity(
    workspaceId: string,
    capability: Capability,
    template: SubAgentTemplate,
    maxParallelism: number
  ) {
    const workspaceActive = this.activeByWorkspace.get(workspaceId)?.size ?? 0;
    const capabilityActive =
      this.activeByCapability.get(buildCapabilityKey(workspaceId, capability))?.size ?? 0;

    return (
      workspaceActive < Math.max(1, maxParallelism) &&
      capabilityActive < Math.max(1, template.maxParallelTasks)
    );
  }

  private async waitForCapacity(
    workspaceId: string,
    capability: Capability,
    template: SubAgentTemplate,
    maxParallelism: number,
    runId: string
  ) {
    const startedAt = Date.now();
    const waitTimeoutMs = Math.min(normalizeTimeout(template), 15_000);

    while (!this.hasCapacity(workspaceId, capability, template, maxParallelism)) {
      if (Date.now() - startedAt > waitTimeoutMs) {
        throw new Error(
          `Sub-agent capacity exhausted for capability "${capability}" in workspace "${workspaceId}".`
        );
      }

      await sleep(25);
    }

    const ticket = {
      workspaceId,
      capability,
      runId
    } satisfies CapacityTicket;
    this.claimRun(ticket);
    return ticket;
  }

  private createRunRecord(request: SubAgentExecutionRequest, template: SubAgentTemplate) {
    const now = new Date().toISOString();
    const run: SubAgentRunRecord = {
      id: crypto.randomUUID(),
      missionId: request.missionId,
      planId: request.plan.id,
      stepId: request.step.id,
      workspaceId: request.objective.workspaceId,
      capability: request.step.capability,
      templateId: template.id,
      templateRole: template.role,
      status: "queued",
      createdAt: now,
      requestedBy: request.authContext?.userId ?? request.objective.userId,
      timeoutMs: normalizeTimeout(template),
      attempt: Math.max(1, request.attempt ?? 1),
      provider: template.provider ?? "anthropic",
      model: template.model ?? "claude-haiku-4-5",
      toolIds: [...(template.toolIds ?? [])],
      iterationCount: 0,
      outputSummary: "Run has been queued."
    };

    return this.persistRun(run);
  }

  private buildMemoryText(step: MissionStep, output: RuntimeExecutionResult) {
    return `${step.title}: ${summarizeText(output.verification.sanitized, 220)}`;
  }

  private buildStepReport(
    request: SubAgentExecutionRequest,
    run: SubAgentRunRecord,
    output: RuntimeExecutionResult
  ) {
    const finishedAt = run.finishedAt ?? new Date().toISOString();

    return {
      stepId: request.step.id,
      assignee: request.step.assignee,
      status: "completed" as const,
      startedAt: run.startedAt ?? run.createdAt,
      finishedAt,
      summary: summarizeText(output.finalText, 200) || `${request.step.title} completed.`,
      verification: output.verification.reason,
      toolId: output.toolCalls[0]?.toolId,
      subAgentRunId: run.id,
      attempts: run.attempt,
      toolCalls: output.toolCalls.length
    };
  }

  private completeRun(
    request: SubAgentExecutionRequest,
    run: SubAgentRunRecord,
    output: RuntimeExecutionResult
  ) {
    const finishedAt = new Date().toISOString();
    const completed: SubAgentRunRecord = {
      ...run,
      status: "completed",
      finishedAt,
      iterationCount: output.iterations.length,
      outputSummary: summarizeText(output.finalText, 240),
      result: output
    };

    this.persistRun(completed);
    return {
      run: completed,
      output,
      memoryText: this.buildMemoryText(request.step, output),
      stepReport: this.buildStepReport(request, completed, output)
    } satisfies SubAgentExecutionResult;
  }

  private failRun(run: SubAgentRunRecord, status: Extract<SubAgentRunStatus, "failed" | "timed_out">, error: unknown) {
    return this.persistRun({
      ...run,
      status,
      finishedAt: new Date().toISOString(),
      outputSummary: summarizeText(normalizeErrorMessage(error), 240),
      error: normalizeErrorMessage(error)
    });
  }

  async runStep(request: SubAgentExecutionRequest): Promise<SubAgentExecutionResult> {
    const template = {
      ...this.templateForCapability(request.step.capability),
      ...request.template,
      toolIds: [...(request.template.toolIds ?? this.templateForCapability(request.step.capability).toolIds ?? [])]
    } satisfies SubAgentTemplate;
    const run = this.createRunRecord(request, template);

    await this.auditService.record("subagent.run.queued", run.id, "subagent-service", {
      missionId: request.missionId,
      stepId: request.step.id,
      capability: request.step.capability,
      workspaceId: request.objective.workspaceId
    });

    const ticket = await this.waitForCapacity(
      request.objective.workspaceId,
      request.step.capability,
      template,
      request.context.maxParallelism,
      run.id
    );

    const startedAt = new Date().toISOString();
    const running = this.patchRun(run.id, (candidate) => ({
      ...candidate,
      status: "running",
      startedAt,
      outputSummary: `Running ${request.step.capability} task with ${template.role}.`
    }));

    await this.auditService.record("subagent.run.started", running.id, "subagent-service", {
      missionId: request.missionId,
      stepId: request.step.id,
      capability: request.step.capability,
      templateId: template.id
    });

    try {
      const output = await Promise.race([
        this.runtimeService.executeTask({
          objective: request.objective,
          step: request.step,
          plan: request.plan,
          template,
          context: request.context,
          authContext: request.authContext,
          maxIterations: Math.max(2, Math.min(5, request.context.maxParallelism + 1))
        }),
        (async () => {
          await sleep(normalizeTimeout(template));
          throw new Error(
            `Sub-agent run "${running.id}" exceeded timeout ${normalizeTimeout(template)}ms.`
          );
        })()
      ]) as RuntimeExecutionResult;

      const completed = this.completeRun(request, running, output);
      await this.auditService.record("subagent.run.completed", completed.run.id, "subagent-service", {
        missionId: request.missionId,
        stepId: request.step.id,
        toolCalls: output.toolCalls.length,
        iterations: output.iterations.length
      });
      return completed;
    } catch (error) {
      const status = normalizeErrorMessage(error).includes("exceeded timeout")
        ? "timed_out"
        : "failed";
      const failed = this.failRun(running, status, error);
      await this.auditService.record("subagent.run.failed", failed.id, "subagent-service", {
        missionId: request.missionId,
        stepId: request.step.id,
        status,
        error: normalizeErrorMessage(error)
      });
      throw error;
    } finally {
      this.releaseRun(ticket);
    }
  }

  listRuns(filter?: {
    workspaceId?: string;
    missionId?: string;
    stepId?: string;
    status?: SubAgentRunStatus;
  }) {
    return this.runStore
      .list()
      .filter((run) => (filter?.workspaceId ? run.workspaceId === filter.workspaceId : true))
      .filter((run) => (filter?.missionId ? run.missionId === filter.missionId : true))
      .filter((run) => (filter?.stepId ? run.stepId === filter.stepId : true))
      .filter((run) => (filter?.status ? run.status === filter.status : true))
      .sort(sortRuns);
  }

  listMissionRuns(missionId: string) {
    return this.listRuns({ missionId });
  }

  getRun(runId: string) {
    return this.runStore.list().find((run) => run.id === runId);
  }

  workspaceUtilization(workspaceId: string) {
    const allRuns = this.workspaceRuns(workspaceId);
    const active = this.activeByWorkspace.get(workspaceId)?.size ?? 0;
    const failed = allRuns.filter((run) => run.status === "failed" || run.status === "timed_out");
    const completed = allRuns.filter((run) => run.status === "completed");
    const recent = allRuns.slice(-10);

    return {
      workspaceId,
      totalRuns: allRuns.length,
      activeRuns: active,
      completedRuns: completed.length,
      failedRuns: failed.length,
      recent: recent.map((run) => ({
        id: run.id,
        stepId: run.stepId,
        status: run.status,
        role: run.templateRole,
        summary: run.outputSummary
      }))
    };
  }

  summarizeMissionRuns(missionId: string) {
    const runs = this.listMissionRuns(missionId);
    const byCapability = runs.reduce<Record<string, number>>((accumulator, run) => {
      accumulator[run.capability] = (accumulator[run.capability] ?? 0) + 1;
      return accumulator;
    }, {});

    return {
      missionId,
      totalRuns: runs.length,
      completedRuns: runs.filter((run) => run.status === "completed").length,
      failedRuns: runs.filter((run) => run.status === "failed" || run.status === "timed_out").length,
      byCapability
    };
  }

  health(): ServiceHealth {
    return {
      name: "subagent-service",
      ok: true,
      details: {
        templates: Object.keys(templateByCapability).length,
        activeWorkspaces: this.activeByWorkspace.size,
        trackedRuns: this.runStore.list().length
      }
    };
  }
}
