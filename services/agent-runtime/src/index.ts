import path from "node:path";

import { LocalJsonStore, ensureDirectory } from "@jeanbot/documents";
import { FileService } from "@jeanbot/file-service";
import { createLogger } from "@jeanbot/logger";
import { MemoryService } from "@jeanbot/memory-service";
import { PolicyService } from "@jeanbot/policy-service";
import { buildJeanSystemPrompt, buildSpecialistPrompt } from "@jeanbot/prompt-kit";
import { ToolService } from "@jeanbot/tool-service";
import type {
  ExecutionContext,
  MissionObjective,
  MissionPlan,
  MissionStep,
  ProviderExecutionRequest,
  ProviderExecutionResult,
  RuntimeExecutionRequest,
  RuntimeExecutionResult,
  RuntimeIterationRecord,
  RuntimeProviderStatus,
  RuntimeSessionRecord,
  ServiceHealth,
  SubAgentTemplate,
  SubAgentToolCallRecord,
  ToolExecutionRequest,
  ToolExecutionResult
} from "@jeanbot/types";

import { JeanContextLoader } from "./context/jean-context.js";
import { routeModel } from "./model-routing/router.js";
import { ProviderRuntime } from "./providers/provider-runtime.js";
import { verifyAndSanitize } from "./self-check/verifier.js";

interface RuntimeFrameModel {
  provider: string;
  model: string;
  reason: string;
}

export interface RuntimeFrame {
  model: RuntimeFrameModel;
  workspaceContext: string;
  memorySummary: string;
  availableTools: string[];
  policyPosture: string;
  systemPrompt: string;
  specialistPrompt: string;
}

interface PlannedToolCall {
  toolId: string;
  action: string;
  payload: Record<string, unknown>;
  objective: string;
  required: boolean;
  stage?: "preflight" | "primary" | "follow-up" | "post-processing" | undefined;
  reason?: string | undefined;
}

interface ToolCallOutcome {
  record: SubAgentToolCallRecord;
  result?: ToolExecutionResult | undefined;
  error?: string | undefined;
}

interface RuntimeIntentProfile {
  signal: string;
  url?: string | undefined;
  shellCommand: string;
  wantsArtifact: boolean;
  wantsProof: boolean;
  wantsKnowledge: boolean;
  wantsMemory: boolean;
  wantsContextUpdate: boolean;
  wantsLinks: boolean;
  wantsHistory: boolean;
  wantsImmediateTrigger: boolean;
  wantsSearch: boolean;
  wantsBrowser: boolean;
  wantsTerminal: boolean;
  wantsStructuredOutput: boolean;
}

interface ToolOutcomeFacts {
  browserSessionId?: string | undefined;
  terminalExecutionId?: string | undefined;
  heartbeatId?: string | undefined;
  searchUrl?: string | undefined;
  toolIds: Set<string>;
  failedToolIds: Set<string>;
}

const summarizeText = (value: string, maxLength = 220) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
};

const jsonPreview = (value: unknown, maxLength = 220) => {
  try {
    return summarizeText(JSON.stringify(value), maxLength);
  } catch {
    return summarizeText(String(value), maxLength);
  }
};

const stripTrailingPunctuation = (value: string) => value.replace(/[.,;:!?]+$/g, "");

const extractFirstUrl = (value: string) => {
  const match = value.match(/https?:\/\/[^\s)]+/i);
  return match?.[0] ? stripTrailingPunctuation(match[0]) : undefined;
};

const detectShellCommand = (value: string) => {
  const lower = value.toLowerCase();
  if (lower.includes("test") || lower.includes("vitest")) {
    return "pnpm test";
  }

  if (lower.includes("lint")) {
    return "pnpm lint";
  }

  if (lower.includes("build")) {
    return "pnpm build";
  }

  if (lower.includes("typecheck")) {
    return "pnpm typecheck";
  }

  return process.platform === "win32" ? "Get-ChildItem -Force" : "ls -la";
};

const toolPayloadWorkspaceRoot = (context: ExecutionContext) => ({
  workspaceRoot: context.workspaceRoot,
  workspaceId: context.authContext?.workspaceIds[0]
});

const maybeTool = (toolId: string, availableTools: string[]) => availableTools.includes(toolId);

const containsAny = (value: string, needles: string[]) =>
  needles.some((needle) => value.includes(needle));

const slugify = (value: string, fallback = "artifact") => {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || fallback;
};

const joinNonEmpty = (...values: string[]) => values.filter(Boolean).join("\n");

export class AgentRuntimeService {
  private readonly logger = createLogger("agent-runtime");
  private readonly contextLoader: JeanContextLoader;
  private readonly fileService: FileService;
  private readonly memoryService: MemoryService;
  private readonly toolService: ToolService;
  private readonly policyService: PolicyService;
  private readonly providerRuntime: ProviderRuntime;
  private readonly sessionStore = new LocalJsonStore<RuntimeSessionRecord>(
    ensureDirectory(path.resolve("tmp", "agent-runtime", "sessions"))
  );

  constructor(
    fileService = new FileService(),
    memoryService = new MemoryService(),
    toolService = new ToolService(),
    policyService = new PolicyService()
  ) {
    this.fileService = fileService;
    this.memoryService = memoryService;
    this.toolService = toolService;
    this.policyService = policyService;
    this.contextLoader = new JeanContextLoader(fileService);
    this.providerRuntime = new ProviderRuntime();
  }

  private availableToolIds(template: SubAgentTemplate) {
    const registered = new Set(this.toolService.listTools().map((tool) => tool.id));
    if (template.toolIds) {
      return [...new Set(template.toolIds.filter((toolId) => registered.has(toolId)))];
    }

    return [...registered];
  }

  private modelForStep(objective: MissionObjective, step: MissionStep, template: SubAgentTemplate) {
    const routed = routeModel(objective.risk, step.capability);
    return {
      provider: template.provider ?? routed.provider,
      model: template.model ?? routed.model,
      reason: template.model
        ? `Template override selected model ${template.model}. ${routed.reason}`
        : routed.reason
    };
  }

  private intentText(request: RuntimeExecutionRequest, providerText = "") {
    return [
      request.objective.title,
      request.objective.objective,
      request.objective.context,
      request.objective.desiredOutcome ?? "",
      ...request.objective.constraints,
      request.step.title,
      request.step.description,
      request.step.verification,
      providerText
    ]
      .join("\n")
      .toLowerCase();
  }

  private buildIntentProfile(
    request: RuntimeExecutionRequest,
    providerText = ""
  ): RuntimeIntentProfile {
    const signal = this.intentText(request, providerText);

    return {
      signal,
      url: extractFirstUrl(
        [
          request.objective.objective,
          request.objective.context,
          request.objective.desiredOutcome ?? "",
          providerText
        ].join("\n")
      ),
      shellCommand: detectShellCommand(
        `${request.objective.objective}\n${request.step.title}\n${request.step.description}`
      ),
      wantsArtifact: containsAny(signal, [
        "artifact",
        "report",
        "markdown",
        "document",
        "deliverable",
        "write file",
        "save output"
      ]),
      wantsProof: containsAny(signal, [
        "proof",
        "evidence",
        "capture",
        "screenshot",
        "visual",
        "show me",
        "verify"
      ]),
      wantsKnowledge: containsAny(signal, [
        "knowledge",
        "document",
        "runbook",
        "guide",
        "docs",
        "spec"
      ]),
      wantsMemory: containsAny(signal, [
        "remember",
        "memory",
        "retain",
        "lesson",
        "decision",
        "summary"
      ]),
      wantsContextUpdate:
        containsAny(signal, [
          "workspace context",
          "status",
          "progress",
          "state file",
          "context file"
        ]) || ["planning", "project-management", "orchestration"].includes(request.step.capability),
      wantsLinks: containsAny(signal, ["link", "href", "url list", "sources", "citations"]),
      wantsHistory: containsAny(signal, ["history", "record", "execution detail", "timeline", "event"]),
      wantsImmediateTrigger: containsAny(signal, ["trigger now", "run now", "execute now"]),
      wantsSearch:
        ["research", "browser", "multimodality"].includes(request.step.capability) ||
        containsAny(signal, ["search", "find", "look up", "research", "sources"]),
      wantsBrowser:
        ["browser", "research", "multimodality"].includes(request.step.capability) ||
        containsAny(signal, ["browser", "website", "page", "url", "navigate", "click"]),
      wantsTerminal:
        ["terminal", "software-development", "data-analysis"].includes(request.step.capability) ||
        containsAny(signal, ["terminal", "shell", "command", "logs", "stdout", "stderr"]),
      wantsStructuredOutput: containsAny(signal, [
        "structured",
        "json",
        "table",
        "bullet",
        "summary",
        "report"
      ])
    };
  }

  private collectToolOutcomeFacts(toolOutcomes: ToolCallOutcome[]): ToolOutcomeFacts {
    const facts: ToolOutcomeFacts = {
      toolIds: new Set<string>(),
      failedToolIds: new Set<string>()
    };

    for (const outcome of toolOutcomes) {
      facts.toolIds.add(outcome.record.toolId);
      if (!outcome.record.ok) {
        facts.failedToolIds.add(outcome.record.toolId);
      }

      const payload = outcome.result?.payload;
      if (!payload) {
        continue;
      }

      if (
        !facts.browserSessionId &&
        (outcome.record.toolId === "browser.session.navigate" ||
          outcome.record.toolId === "browser.session.extract" ||
          outcome.record.toolId === "browser.session.capture")
      ) {
        const candidate =
          typeof (payload as Record<string, unknown>).id === "string"
            ? ((payload as Record<string, unknown>).id as string)
            : typeof (payload as Record<string, unknown>).sessionId === "string"
              ? ((payload as Record<string, unknown>).sessionId as string)
              : undefined;
        if (candidate) {
          facts.browserSessionId = candidate;
        }
      }

      if (!facts.terminalExecutionId && outcome.record.toolId === "terminal.command.run") {
        const record =
          (payload as Record<string, unknown>).record as Record<string, unknown> | undefined;
        if (typeof record?.id === "string") {
          facts.terminalExecutionId = record.id;
        }
      }

      if (!facts.heartbeatId && outcome.record.toolId === "automation.heartbeat.create") {
        const candidate = (payload as Record<string, unknown>).id;
        if (typeof candidate === "string") {
          facts.heartbeatId = candidate;
        }
      }

      if (!facts.searchUrl && outcome.record.toolId === "search.query" && Array.isArray(payload)) {
        const firstSearchHit = payload.find(
          (entry): entry is { url: string } =>
            typeof entry === "object" &&
            entry !== null &&
            typeof (entry as { url?: unknown }).url === "string"
        );
        if (firstSearchHit) {
          facts.searchUrl = firstSearchHit.url;
        }
      }
    }

    return facts;
  }

  private plannedToolKey(tool: Pick<PlannedToolCall, "toolId" | "action">) {
    return `${tool.toolId}::${tool.action}`;
  }

  private unseenToolCalls(calls: PlannedToolCall[], toolOutcomes: ToolCallOutcome[]) {
    const seen = new Set(toolOutcomes.map((outcome) => this.plannedToolKey(outcome.record)));
    const unique = new Set<string>();

    return calls.filter((call) => {
      const key = this.plannedToolKey(call);
      if (seen.has(key) || unique.has(key)) {
        return false;
      }
      unique.add(key);
      return true;
    });
  }

  private progressBuckets(plan: MissionPlan, currentStepId: string) {
    const currentIndex = Math.max(
      0,
      plan.steps.findIndex((step) => step.id === currentStepId)
    );
    return {
      completed: plan.steps.slice(0, currentIndex).map((step) => step.title),
      inProgress: plan.steps
        .slice(currentIndex, currentIndex + 1)
        .map((step) => step.title),
      upcoming: plan.steps.slice(currentIndex + 1).map((step) => step.title)
    };
  }

  async prepareFrame(
    objective: MissionObjective,
    step: MissionStep,
    plan: MissionPlan,
    template: SubAgentTemplate,
    context: ExecutionContext
  ): Promise<RuntimeFrame> {
    const jeanFile = await this.contextLoader.load(context.jeanFilePath);
    const workspaceSnapshot = await this.fileService.scanWorkspace(context.workspaceRoot);
    const memorySummary = await this.memoryService.summarizeWorkspace(objective.workspaceId);
    const availableTools = this.availableToolIds(template);
    const policyPosture = this.policyService.evaluateMission(objective);
    const model = this.modelForStep(objective, step, template);
    const workspaceContext =
      workspaceSnapshot.map((entry) => `- ${entry.type}: ${entry.name}`).join("\n") || "- empty";
    const systemPrompt = [
      buildJeanSystemPrompt(jeanFile, objective, context.planMode),
      "",
      "Mission plan summary:",
      plan.summary,
      "",
      "Workspace snapshot:",
      workspaceContext,
      "",
      "Workspace memory summary:",
      memorySummary,
      "",
      "Execution metadata:",
      `Provider: ${model.provider}`,
      `Model: ${model.model}`,
      "Identity rule: never claim a different provider, vendor, or model family than the execution metadata above.",
      "",
      "Available tools:",
      availableTools.map((toolId) => `- ${toolId}`).join("\n"),
      "",
      "Policy posture:",
      JSON.stringify(policyPosture, null, 2)
    ].join("\n");

    this.logger.info("Prepared runtime frame", {
      missionId: objective.id,
      stepId: step.id,
      model: model.model
    });

    return {
      model,
      workspaceContext,
      memorySummary,
      availableTools,
      policyPosture: policyPosture.reason,
      systemPrompt,
      specialistPrompt: buildSpecialistPrompt(template, step, plan)
    };
  }

  private createSession(
    request: RuntimeExecutionRequest,
    frame: RuntimeFrame
  ): RuntimeSessionRecord {
    const createdAt = new Date().toISOString();
    const session: RuntimeSessionRecord = {
      id: crypto.randomUUID(),
      workspaceId: request.objective.workspaceId,
      missionId: request.objective.id,
      stepId: request.step.id,
      capability: request.step.capability,
      createdAt,
      updatedAt: createdAt,
      model: frame.model,
      toolIds: [...frame.availableTools],
      messages: [
        {
          role: "system",
          content: frame.systemPrompt
        },
        {
          role: "user",
          content: [
            `Mission: ${request.objective.title}`,
            `Step: ${request.step.title}`,
            `Description: ${request.step.description}`,
            `Verification: ${request.step.verification}`,
            request.additionalInstructions ? `Additional instructions: ${request.additionalInstructions}` : ""
          ]
            .filter(Boolean)
            .join("\n")
        }
      ],
      iterations: [],
      providerResponses: []
    };

    this.persistSession(session);
    return session;
  }

  private persistSession(session: RuntimeSessionRecord) {
    return this.sessionStore.write(
      `${session.workspaceId}/${session.missionId}/${session.stepId}/${session.id}`,
      session
    );
  }

  private patchSession(
    session: RuntimeSessionRecord,
    mutate: (current: RuntimeSessionRecord) => RuntimeSessionRecord
  ) {
    const updated = mutate(session);
    updated.updatedAt = new Date().toISOString();
    return this.persistSession(updated);
  }

  private buildExecutionPrompt(
    request: RuntimeExecutionRequest,
    frame: RuntimeFrame,
    phase: "initial" | "synthesis" | "post-processing",
    session: RuntimeSessionRecord,
    toolOutcomes: ToolCallOutcome[]
  ) {
    const toolNarrative =
      toolOutcomes.length === 0
        ? "No tools have run yet."
        : toolOutcomes
            .map((outcome) => {
              const status = outcome.record.ok ? "ok" : "failed";
              const detail = outcome.result
                ? jsonPreview(outcome.result.payload, 180)
                : summarizeText(outcome.error ?? "unknown tool error", 180);
              return `- ${outcome.record.toolId} (${status}): ${detail}`;
            })
            .join("\n");

    return [
      frame.systemPrompt,
      "",
      frame.specialistPrompt,
      "",
      `Execution phase: ${phase}`,
      `Mission objective: ${request.objective.objective}`,
      `Current step: ${request.step.title}`,
      `Step capability: ${request.step.capability}`,
      `Step verification target: ${request.step.verification}`,
      `Execution provider: ${frame.model.provider}`,
      `Execution model: ${frame.model.model}`,
      "Do not claim a different vendor or model family than the execution provider/model above.",
      "",
      "Conversation so far:",
      session.messages.map((message) => `[${message.role}] ${message.content}`).join("\n\n"),
      "",
      "Tool outcomes:",
      toolNarrative,
      "",
      "Respond with a concise operator update and what is true now."
    ].join("\n");
  }

  private normalizeProviderRequest(
    request: RuntimeExecutionRequest,
    provider: RuntimeFrameModel["provider"],
    model: RuntimeFrameModel["model"],
    prompt: string
  ) {
    return {
      provider:
        provider === "openai" ||
        provider === "anthropic" ||
        provider === "ollama" ||
        provider === "github" ||
        provider === "playwright"
          ? provider
          : "anthropic",
      model,
      mode: request.providerMode,
      prompt,
      input: {
        workspaceId: request.objective.workspaceId,
        missionId: request.objective.id,
        stepId: request.step.id
      }
    } satisfies ProviderExecutionRequest;
  }

  private providerText(result: ProviderExecutionResult) {
    if (typeof result.output.text === "string") {
      return result.output.text;
    }

    if (typeof result.output.summary === "string") {
      return result.output.summary;
    }

    return result.message;
  }

  private async runProviderTurn(
    request: RuntimeExecutionRequest,
    frame: RuntimeFrame,
    phase: "initial" | "synthesis" | "post-processing",
    session: RuntimeSessionRecord,
    toolOutcomes: ToolCallOutcome[]
  ) {
    const startedAt = new Date().toISOString();
    const prompt = this.buildExecutionPrompt(request, frame, phase, session, toolOutcomes);
    const providerResult = await this.executeProvider(
      this.normalizeProviderRequest(request, frame.model.provider, frame.model.model, prompt)
    );
    if (!providerResult.ok && request.providerMode === "live") {
      throw new Error(providerResult.message);
    }

    const responseText = this.providerText(providerResult);
    const finishedAt = new Date().toISOString();

    const iteration: RuntimeIterationRecord = {
      index: session.iterations.length + 1,
      provider: frame.model.provider,
      model: frame.model.model,
      startedAt,
      finishedAt,
      promptSummary: summarizeText(prompt, 220),
      responseSummary: summarizeText(responseText, 220),
      toolCalls: toolOutcomes.map((outcome) => outcome.record)
    };

    const updated = this.patchSession(session, (current) => ({
      ...current,
      messages: [
        ...current.messages,
        {
          role: "assistant",
          content: responseText
        }
      ],
      iterations: [...current.iterations, iteration],
      providerResponses: [...current.providerResponses, providerResult]
    }));

    return {
      session: updated,
      providerResult,
      responseText,
      iteration
    };
  }

  private createToolRequest(
    request: RuntimeExecutionRequest,
    toolId: string,
    action: string,
    payload: Record<string, unknown>,
    allowedToolIds?: string[] | undefined
  ) {
    return {
      missionId: request.objective.id,
      toolId,
      action,
      payload,
      allowedToolIds,
      authContext: request.authContext
    } satisfies ToolExecutionRequest;
  }

  private buildPlannedToolCalls(
    request: RuntimeExecutionRequest,
    frame: RuntimeFrame,
    providerText: string
  ): PlannedToolCall[] {
    const workspaceId = request.objective.workspaceId;
    const intent = this.buildIntentProfile(request, providerText);
    const signal = intent.signal;
    const url = intent.url;
    const command = intent.shellCommand;
    const baseWorkspace = toolPayloadWorkspaceRoot(request.context);
    const progress = this.progressBuckets(request.plan, request.step.id);
    const plans: PlannedToolCall[] = [];

    const pushTool = (tool: PlannedToolCall) => {
      if (!maybeTool(tool.toolId, frame.availableTools)) {
        return;
      }

      if (plans.some((candidate) => candidate.toolId === tool.toolId && candidate.action === tool.action)) {
        return;
      }

      plans.push(tool);
    };

    if (
      containsAny(signal, [
        "workspace context",
        "status",
        "progress",
        "state file",
        "context file"
      ])
    ) {
      pushTool({
        toolId: "filesystem.workspace.context.update",
        action: "update-workspace-context",
        payload: {
          ...baseWorkspace,
          missionTitle: request.objective.title,
          completed: progress.completed,
          inProgress: progress.inProgress,
          upcoming: progress.upcoming,
          permissions: ["write"]
        },
        objective: "Update the persisted workspace context with current mission progress.",
        required: false,
        stage: "preflight",
        reason: "The mission text asks for visible state tracking."
      });
    }

    if (
      containsAny(signal, [
        "artifact",
        "report",
        "markdown",
        "document",
        "write file",
        "save output"
      ])
    ) {
      pushTool({
        toolId: "filesystem.artifact.write",
        action: "write-artifact",
        payload: {
          ...baseWorkspace,
          fileName: `${slugify(request.step.title)}.md`,
          content: joinNonEmpty(
            `# ${request.objective.title} :: ${request.step.title}`,
            "",
            `Objective: ${request.objective.objective}`,
            `Verification: ${request.step.verification}`,
            providerText ? `Initial runtime note: ${summarizeText(providerText, 320)}` : ""
          ),
          permissions: ["write"]
        },
        objective: "Persist a structured artifact for this step.",
        required: false,
        stage: "post-processing",
        reason: "The request asks for a durable artifact or report."
      });
    }

    switch (request.step.capability) {
      case "filesystem":
        pushTool({
          toolId: "filesystem.workspace.scan",
          action: "scan-workspace",
          payload: {
            ...baseWorkspace,
            permissions: ["read"]
          },
          objective: "Inspect the workspace before mutating anything.",
          required: true
        });
        if (
          request.step.stage === "preflight" ||
          request.step.title.toLowerCase().includes("checkpoint")
        ) {
          pushTool({
            toolId: "filesystem.checkpoint.create",
            action: "create-checkpoint",
            payload: {
              ...baseWorkspace,
              note: `Checkpoint before ${request.step.title}`,
              files: [],
              permissions: ["write"]
            },
            objective: "Preserve a rollback point before risky work.",
            required: true
          });
        }
        if (containsAny(signal, ["jean", "instruction", "prompt", "system file"])) {
          pushTool({
            toolId: "filesystem.jean.read",
            action: "read-jean-file",
            payload: {
              ...baseWorkspace,
              jeanFilePath: request.context.jeanFilePath,
              permissions: ["read"]
            },
            objective: "Load the workspace JEAN rules before editing files.",
            required: false
          });
        }
        break;
      case "memory":
        pushTool({
          toolId: "memory.recall",
          action: "recall-memory",
          payload: {
            workspaceId,
            query: request.objective.objective,
            permissions: ["query"]
          },
          objective: "Load relevant memory before execution.",
          required: true
        });
        pushTool({
          toolId: "memory.summary",
          action: "summarize-memory",
          payload: {
            workspaceId,
            permissions: ["read"]
          },
          objective: "Summarize memory posture before continuing.",
          required: false
        });
        break;
      case "security":
        pushTool({
          toolId: "policy.evaluate",
          action: "evaluate-risk",
          payload: {
            workspaceId,
            actionName: request.step.title,
            permissions: ["evaluate"]
          },
          objective: "Score the risk posture of the current step.",
          required: true
        });
        pushTool({
          toolId: "audit.list",
          action: "list-audit-events",
          payload: {
            workspaceId,
            entityId: request.objective.id,
            permissions: ["read"]
          },
          objective: "Review recent mission events before approving risk.",
          required: false
        });
        pushTool({
          toolId: "knowledge.summary",
          action: "summarize-knowledge",
          payload: {
            workspaceId,
            permissions: ["read"]
          },
          objective: "Review current knowledge coverage while checking security posture.",
          required: false
        });
        break;
      case "planning":
      case "project-management":
      case "orchestration":
        pushTool({
          toolId: "memory.recall",
          action: "recall-memory",
          payload: {
            workspaceId,
            query: request.objective.title,
            permissions: ["query"]
          },
          objective: "Bring prior execution context into the planning loop.",
          required: false
        });
        pushTool({
          toolId: "audit.list",
          action: "list-audit-events",
          payload: {
            workspaceId,
            entityId: request.objective.id,
            permissions: ["read"]
          },
          objective: "Use audit history to understand mission state.",
          required: false
        });
        pushTool({
          toolId: "memory.summary",
          action: "summarize-memory",
          payload: {
            workspaceId,
            permissions: ["read"]
          },
          objective: "Review the current memory summary while planning.",
          required: false
        });
        break;
      case "terminal":
      case "software-development":
      case "data-analysis":
        pushTool({
          toolId: "filesystem.workspace.scan",
          action: "scan-workspace",
          payload: {
            ...baseWorkspace,
            permissions: ["read"]
          },
          objective: "Establish current workspace state before using the terminal.",
          required: false
        });
        pushTool({
          toolId: "terminal.command.run",
          action: "run-command",
          payload: {
            workspaceId,
            cwd: request.context.workspaceRoot,
            command,
            timeoutMs: 20_000,
            permissions: ["execute"]
          },
          objective: "Collect command output to ground the current task.",
          required: true
        });
        pushTool({
          toolId: "terminal.command.list",
          action: "list-terminal-executions",
          payload: {
            workspaceId,
            permissions: ["read"]
          },
          objective: "Review prior terminal runs for additional context.",
          required: false
        });
        break;
      case "browser":
      case "research":
      case "multimodality":
        if (request.step.capability === "browser" || url) {
          pushTool({
            toolId: "browser.session.navigate",
            action: "navigate",
            payload: {
              workspaceId,
              url: url ?? "https://example.com",
              permissions: ["navigate"]
            },
            objective: "Gather current browser state from a relevant page.",
            required: request.step.capability === "browser" || Boolean(url),
            stage: "primary",
            reason: url
              ? "A concrete URL is present in the mission context."
              : "Browser execution needs a live page to inspect."
          });
        }
        if (request.step.capability === "research" || intent.wantsSearch) {
          pushTool({
            toolId: "search.query",
            action: "query",
            payload: {
              workspaceId,
              query: request.objective.objective,
              permissions: ["query"]
            },
            objective: "Search for supporting external information.",
            required: false,
            stage: "primary",
            reason: "Research and browser tasks benefit from search discovery before extraction."
          });
        }
        break;
      case "communication":
      case "finance":
        pushTool({
          toolId: "policy.evaluate",
          action: "evaluate-risk",
          payload: {
            workspaceId,
            actionName: request.step.title,
            permissions: ["evaluate"]
          },
          objective: "Confirm approval posture before drafting anything outbound.",
          required: true
        });
        pushTool({
          toolId: "communication.message.draft",
          action: "draft-message",
          payload: {
            workspaceId,
            target: "ops@example.com",
            channel: "email",
            subject: `JeanBot draft for ${request.objective.title}`,
            body: summarizeText(
              `${request.objective.objective}\n\nStep: ${request.step.title}`,
              400
            ),
            permissions: ["draft"]
          },
          objective: "Draft the outbound communication without sending it.",
          required: false
        });
        pushTool({
          toolId: "communication.message.list",
          action: "list-messages",
          payload: {
            workspaceId,
            permissions: ["read"]
          },
          objective: "Review prior message history before deciding next steps.",
          required: false
        });
        break;
      case "automation":
      case "heartbeat":
        pushTool({
          toolId: "automation.heartbeat.summary",
          action: "summarize-heartbeats",
          payload: {
            workspaceId,
            permissions: ["read"]
          },
          objective: "Inspect current automation health before changing schedules.",
          required: false
        });
        pushTool({
          toolId: "automation.heartbeat.list",
          action: "list-heartbeats",
          payload: {
            workspaceId,
            permissions: ["read"]
          },
          objective: "Review existing heartbeat definitions in the workspace.",
          required: false
        });
        break;
      default:
        pushTool({
          toolId: "memory.recall",
          action: "recall-memory",
          payload: {
            workspaceId,
            query: request.objective.objective,
            permissions: ["query"]
          },
          objective: "Pull relevant stored context before internal synthesis.",
          required: false
        });
        pushTool({
          toolId: "knowledge.query",
          action: "query-knowledge",
          payload: {
            workspaceId,
            query: request.step.title,
            permissions: ["query"]
          },
          objective: "Search workspace knowledge for prior relevant material.",
          required: false
        });
        break;
    }

    if (containsAny(signal, ["knowledge", "document", "runbook", "guide", "docs", "spec"])) {
      pushTool({
        toolId: "knowledge.query",
        action: "query-knowledge",
        payload: {
          workspaceId,
          query: request.step.title,
          permissions: ["query"]
        },
        objective: "Search workspace knowledge relevant to this step.",
        required: false
      });
      pushTool({
        toolId: "knowledge.summary",
        action: "summarize-knowledge",
        payload: {
          workspaceId,
          permissions: ["read"]
        },
        objective: "Review overall knowledge base coverage for the task.",
        required: false
      });
    }

    if (containsAny(signal, ["remember", "store memory", "save memory", "long-term memory"])) {
      pushTool({
        toolId: "memory.summary",
        action: "summarize-memory",
        payload: {
          workspaceId,
          permissions: ["read"]
        },
        objective: "Review current memory before deciding what to retain.",
        required: false
      });
    }

    return plans.slice(0, Math.max(2, (request.maxIterations ?? 4) * 2));
  }

  private buildFollowUpToolCalls(
    request: RuntimeExecutionRequest,
    frame: RuntimeFrame,
    providerText: string,
    toolOutcomes: ToolCallOutcome[]
  ) {
    const intent = this.buildIntentProfile(request, providerText);
    const facts = this.collectToolOutcomeFacts(toolOutcomes);
    const plans: PlannedToolCall[] = [];
    const pushTool = (tool: PlannedToolCall) => {
      if (!maybeTool(tool.toolId, frame.availableTools)) {
        return;
      }

      if (plans.some((candidate) => candidate.toolId === tool.toolId && candidate.action === tool.action)) {
        return;
      }

      plans.push(tool);
    };

    if (!facts.browserSessionId && facts.searchUrl && intent.wantsBrowser) {
      pushTool({
        toolId: "browser.session.navigate",
        action: "navigate",
        payload: {
          workspaceId: request.objective.workspaceId,
          url: facts.searchUrl,
          permissions: ["navigate"]
        },
        objective: "Open the strongest discovered source after search completes.",
        required: false,
        stage: "follow-up",
        reason: "Search returned a candidate URL and the task still needs browser evidence."
      });
    }

    if (facts.browserSessionId) {
      pushTool({
        toolId: "browser.session.extract",
        action: "extract-browser-state",
        payload: {
          workspaceId: request.objective.workspaceId,
          sessionId: facts.browserSessionId,
          kind: intent.wantsLinks ? "links" : "text",
          permissions: ["read"]
        },
        objective: "Extract the page contents after navigation.",
        required: false,
        stage: "follow-up",
        reason: intent.wantsLinks
          ? "The task asks for links or citations."
          : "The task needs browser evidence, not just navigation."
      });

      if (intent.wantsProof || request.step.capability === "browser") {
        pushTool({
          toolId: "browser.session.capture",
          action: "capture-browser",
          payload: {
            workspaceId: request.objective.workspaceId,
            sessionId: facts.browserSessionId,
            fullPage: true,
            permissions: ["read"]
          },
          objective: "Capture the browser state after navigation.",
          required: false,
          stage: "follow-up",
          reason: "The task asks for proof, screenshot, or browser evidence."
        });
      }

      if (intent.wantsHistory) {
        pushTool({
          toolId: "browser.session.events",
          action: "list-browser-events",
          payload: {
            sessionId: facts.browserSessionId,
            workspaceId: request.objective.workspaceId,
            permissions: ["read"]
          },
          objective: "Inspect recorded browser events for the session.",
          required: false,
          stage: "follow-up",
          reason: "The task asks for timeline or event history."
        });
      }
    }

    if (facts.terminalExecutionId) {
      pushTool({
        toolId: "terminal.command.output",
        action: "read-terminal-output",
        payload: {
          executionId: facts.terminalExecutionId,
          workspaceId: request.objective.workspaceId,
          permissions: ["read"]
        },
        objective: "Read terminal stdout and stderr after the command finishes.",
        required: false,
        stage: "follow-up",
        reason: "Command execution should be grounded in actual stdout and stderr."
      });

      if (intent.wantsHistory) {
        pushTool({
          toolId: "terminal.command.get",
          action: "read-terminal-execution",
          payload: {
            executionId: facts.terminalExecutionId,
            workspaceId: request.objective.workspaceId,
            permissions: ["read"]
          },
          objective: "Inspect the execution record for terminal metadata.",
          required: false,
          stage: "follow-up",
          reason: "The task asks for execution history or metadata."
        });
      }
    }

    if (facts.heartbeatId && intent.wantsImmediateTrigger) {
      pushTool({
        toolId: "automation.heartbeat.trigger",
        action: "trigger-heartbeat",
        payload: {
          heartbeatId: facts.heartbeatId,
          workspaceId: request.objective.workspaceId,
          permissions: ["execute"]
        },
        objective: "Trigger the created heartbeat immediately.",
        required: false,
        stage: "follow-up",
        reason: "The request explicitly asks for immediate execution."
      });
    }

    if (
      intent.wantsKnowledge &&
      facts.failedToolIds.has("search.query") &&
      !facts.toolIds.has("knowledge.query")
    ) {
      pushTool({
        toolId: "knowledge.query",
        action: "query-knowledge",
        payload: {
          workspaceId: request.objective.workspaceId,
          query: request.step.title,
          permissions: ["query"]
        },
        objective: "Fallback to local knowledge when external search is unavailable.",
        required: false,
        stage: "follow-up",
        reason: "Search failed and the mission still needs reference material."
      });
    }

    if (intent.wantsMemory && facts.toolIds.has("memory.recall") && !facts.toolIds.has("memory.summary")) {
      pushTool({
        toolId: "memory.summary",
        action: "summarize-memory",
        payload: {
          workspaceId: request.objective.workspaceId,
          permissions: ["read"]
        },
        objective: "Compress recalled memory into a stable summary for the next turn.",
        required: false,
        stage: "follow-up",
        reason: "The mission is memory-heavy and needs a concise working summary."
      });
    }

    return plans;
  }

  private formatToolOutcomeMessage(toolOutcomes: ToolCallOutcome[]) {
    return toolOutcomes
      .map((outcome) => {
        const status = outcome.record.ok ? "ok" : "failed";
        const payload = outcome.result
          ? jsonPreview(outcome.result.payload)
          : summarizeText(outcome.error ?? "tool failure", 200);
        return `${outcome.record.toolId} (${status}): ${payload}`;
      })
      .join("\n");
  }

  private async executeAdaptiveFollowUpLoop(
    request: RuntimeExecutionRequest,
    frame: RuntimeFrame,
    providerText: string,
    toolOutcomes: ToolCallOutcome[]
  ) {
    const loopOutcomes: ToolCallOutcome[] = [];
    const maxPasses = Math.min(3, Math.max(1, request.maxIterations ?? 4));

    for (let pass = 0; pass < maxPasses; pass += 1) {
      const planned = this.unseenToolCalls(
        this.buildFollowUpToolCalls(request, frame, providerText, [
          ...toolOutcomes,
          ...loopOutcomes
        ]),
        [...toolOutcomes, ...loopOutcomes]
      );

      if (planned.length === 0) {
        break;
      }

      const outcomes = await this.executePlannedToolCalls(request, planned);
      loopOutcomes.push(...outcomes);
    }

    return loopOutcomes;
  }

  private buildPostProcessToolCalls(
    request: RuntimeExecutionRequest,
    frame: RuntimeFrame,
    finalText: string
  ) {
    const signal = this.intentText(request, finalText);
    const progress = this.progressBuckets(request.plan, request.step.id);
    const plans: PlannedToolCall[] = [];
    const pushTool = (tool: PlannedToolCall) => {
      if (!maybeTool(tool.toolId, frame.availableTools)) {
        return;
      }

      if (plans.some((candidate) => candidate.toolId === tool.toolId && candidate.action === tool.action)) {
        return;
      }

      plans.push(tool);
    };

    if (
      ["writing", "orchestration", "learning", "project-management", "research", "security"].includes(
        request.step.capability
      ) ||
      containsAny(signal, ["knowledge", "document", "runbook", "guide", "report"])
    ) {
      pushTool({
        toolId: "knowledge.document.ingest",
        action: "ingest-knowledge-document",
        payload: {
          workspaceId: request.objective.workspaceId,
          title: `${request.objective.title} :: ${request.step.title}`,
          body: finalText,
          metadata: {
            missionId: request.objective.id,
            stepId: request.step.id,
            capability: request.step.capability
          },
          permissions: ["write"]
        },
        objective: "Persist the useful result as workspace knowledge.",
        required: false
      });
    }

    if (
      containsAny(signal, ["artifact", "report", "markdown", "deliverable", "write file"]) ||
      ["writing", "orchestration", "software-development", "data-analysis"].includes(
        request.step.capability
      )
    ) {
      pushTool({
        toolId: "filesystem.artifact.write",
        action: "write-artifact",
        payload: {
          ...toolPayloadWorkspaceRoot(request.context),
          fileName: `${slugify(request.objective.title)}-${slugify(request.step.title)}.md`,
          content: finalText,
          permissions: ["write"]
        },
        objective: "Persist a durable artifact for the finished step.",
        required: false
      });
    }

    if (
      ["planning", "project-management", "orchestration"].includes(request.step.capability) ||
      request.step.stage === "verification" ||
      request.step.stage === "delivery"
    ) {
      pushTool({
        toolId: "filesystem.workspace.context.update",
        action: "update-workspace-context",
        payload: {
          ...toolPayloadWorkspaceRoot(request.context),
          missionTitle: request.objective.title,
          completed: [...progress.completed, request.step.title],
          inProgress: [],
          upcoming: progress.upcoming,
          permissions: ["write"]
        },
        objective: "Update workspace context after finishing a coordination step.",
        required: false
      });
    }

    if (
      containsAny(signal, ["remember", "retain", "memory", "lesson", "decision"]) ||
      ["learning", "orchestration", "project-management", "security"].includes(
        request.step.capability
      )
    ) {
      pushTool({
        toolId: "memory.remember",
        action: "remember-runtime-result",
        payload: {
          workspaceId: request.objective.workspaceId,
          text: finalText,
          tags: [request.step.capability, request.step.stage ?? "execution", request.step.assignee],
          scope: request.step.capability === "learning" ? "long-term" : "short-term",
          importance: request.step.capability === "security" ? 0.9 : 0.7,
          permissions: ["write"]
        },
        objective: "Store the useful runtime outcome in memory.",
        required: false
      });
    }

    return plans;
  }

  private async executePlannedToolCalls(
    request: RuntimeExecutionRequest,
    calls: PlannedToolCall[]
  ) {
    const toOutcome = (
      planned: PlannedToolCall,
      startedAt: string,
      finishedAt: string,
      result?: ToolExecutionResult,
      error?: string
    ): ToolCallOutcome => ({
      record: {
        id: crypto.randomUUID(),
        toolId: planned.toolId,
        action: planned.action,
        startedAt,
        finishedAt,
        ok: Boolean(result?.ok) && !error,
        message: result?.message ?? error ?? "Unknown tool execution result.",
        payloadPreview: result
          ? jsonPreview(result.payload)
          : summarizeText(error ?? "tool failure", 220)
      },
      result,
      error
    });

    const requiredCalls = calls.filter((call) => call.required);
    const optionalCalls = calls.filter((call) => !call.required);
    const outcomes: ToolCallOutcome[] = [];

    for (const planned of requiredCalls) {
      const startedAt = new Date().toISOString();
      try {
        const result = await this.toolService.execute(
          this.createToolRequest(
            request,
            planned.toolId,
            planned.action,
            planned.payload,
            this.availableToolIds(request.template)
          )
        );
        const finishedAt = new Date().toISOString();
        outcomes.push(toOutcome(planned, startedAt, finishedAt, result));
      } catch (error) {
        const finishedAt = new Date().toISOString();
        const message = error instanceof Error ? error.message : String(error);
        outcomes.push(toOutcome(planned, startedAt, finishedAt, undefined, message));
        throw new Error(`Tool "${planned.toolId}" failed for step "${request.step.id}": ${message}`);
      }
    }

    if (optionalCalls.length === 1) {
      const planned = optionalCalls[0];
      if (!planned) {
        return outcomes;
      }
      const startedAt = new Date().toISOString();
      try {
        const result = await this.toolService.execute(
          this.createToolRequest(
            request,
            planned.toolId,
            planned.action,
            planned.payload,
            this.availableToolIds(request.template)
          )
        );
        const finishedAt = new Date().toISOString();
        outcomes.push(toOutcome(planned, startedAt, finishedAt, result));
      } catch (error) {
        const finishedAt = new Date().toISOString();
        const message = error instanceof Error ? error.message : String(error);
        outcomes.push(toOutcome(planned, startedAt, finishedAt, undefined, message));
      }
      return outcomes;
    }

    if (optionalCalls.length > 1) {
      const startedAt = new Date().toISOString();
      const batch = await this.toolService.executeBatch({
        continueOnError: true,
        requests: optionalCalls.map((planned) =>
          this.createToolRequest(
            request,
            planned.toolId,
            planned.action,
            planned.payload,
            this.availableToolIds(request.template)
          )
        )
      });
      outcomes.push(
        ...optionalCalls.map((planned, index) => {
          const result = batch.results[index];
          return toOutcome(
            planned,
            startedAt,
            result?.finishedAt ?? new Date().toISOString(),
            result?.ok ? result : undefined,
            result && !result.ok ? result.message : undefined
          );
        })
      );
    }

    return outcomes;
  }

  private mergeNarrative(textSections: string[], postProcessing: ToolCallOutcome[]) {
    const sections = textSections
      .filter(Boolean)
      .map((section, index) => summarizeText(section, index === 0 ? 280 : 360));

    if (postProcessing.length > 0) {
      sections.push(
        `Post-processing: ${postProcessing
          .map((outcome) => `${outcome.record.toolId}=${outcome.record.ok ? "ok" : "failed"}`)
          .join(", ")}`
      );
    }

    return sections.filter(Boolean).join("\n\n");
  }

  private finalizeResult(
    session: RuntimeSessionRecord,
    frame: RuntimeFrame,
    finalText: string
  ) {
    const verification = this.selfCheck(finalText);
    const updated = this.patchSession(session, (current) => ({
      ...current,
      finalText: verification.sanitized
    }));

    return {
      finalText: verification.sanitized,
      provider: frame.model.provider,
      model: frame.model.model,
      mode:
        updated.providerResponses.find((response) => response.mode === "live")?.mode ??
        "synthetic",
      promptDigest: summarizeText(updated.messages[0]?.content ?? "", 220),
      workspaceSummary: frame.workspaceContext,
      memorySummary: frame.memorySummary,
      policyPosture: frame.policyPosture,
      toolCalls: updated.iterations.flatMap((iteration) => iteration.toolCalls),
      iterations: updated.iterations,
      providerResponses: updated.providerResponses,
      verification
    } satisfies RuntimeExecutionResult;
  }

  async executeTask(request: RuntimeExecutionRequest): Promise<RuntimeExecutionResult> {
    await this.fileService.ensureWorkspace(request.context.workspaceRoot);
    const frame = await this.prepareFrame(
      request.objective,
      request.step,
      request.plan,
      request.template,
      request.context
    );
    let session = this.createSession(request, frame);

    const initialTurn = await this.runProviderTurn(
      request,
      frame,
      "initial",
      session,
      []
    );
    session = initialTurn.session;

    const plannedCalls = this.buildPlannedToolCalls(request, frame, initialTurn.responseText);
    const initialToolOutcomes =
      plannedCalls.length > 0 ? await this.executePlannedToolCalls(request, plannedCalls) : [];
    const followUpOutcomes = await this.executeAdaptiveFollowUpLoop(
      request,
      frame,
      initialTurn.responseText,
      initialToolOutcomes
    );
    const toolOutcomes = [...initialToolOutcomes, ...followUpOutcomes];

    if (toolOutcomes.length > 0) {
      session = this.patchSession(session, (current) => ({
        ...current,
        messages: [
          ...current.messages,
          {
            role: "tool",
            content: this.formatToolOutcomeMessage(toolOutcomes)
          }
        ]
      }));
    }

    const synthesisTurn = await this.runProviderTurn(
      request,
      frame,
      "synthesis",
      session,
      toolOutcomes
    );
    session = synthesisTurn.session;

    const synthesisFollowUpOutcomes = await this.executeAdaptiveFollowUpLoop(
      request,
      frame,
      synthesisTurn.responseText,
      toolOutcomes
    );

    if (synthesisFollowUpOutcomes.length > 0) {
      session = this.patchSession(session, (current) => ({
        ...current,
        messages: [
          ...current.messages,
          {
            role: "tool",
            content: this.formatToolOutcomeMessage(synthesisFollowUpOutcomes)
          }
        ]
      }));

      const gapClosureTurn = await this.runProviderTurn(
        request,
        frame,
        "synthesis",
        session,
        [...toolOutcomes, ...synthesisFollowUpOutcomes]
      );
      session = gapClosureTurn.session;
    }

    const resolvedSynthesisText =
      synthesisFollowUpOutcomes.length > 0
        ? (session.messages.at(-1)?.content ?? synthesisTurn.responseText)
        : synthesisTurn.responseText;

    const postProcessCalls = this.buildPostProcessToolCalls(
      request,
      frame,
      resolvedSynthesisText
    );
    const postProcessOutcomes =
      postProcessCalls.length > 0
        ? await this.executePlannedToolCalls(request, postProcessCalls)
        : [];

    if (postProcessOutcomes.length > 0) {
      session = this.patchSession(session, (current) => ({
        ...current,
        messages: [
          ...current.messages,
          {
            role: "tool",
            content: postProcessOutcomes
              .map((outcome) => `${outcome.record.toolId}: ${outcome.record.message}`)
              .join("\n")
          }
        ]
      }));

      const postProcessTurn = await this.runProviderTurn(
        request,
        frame,
        "post-processing",
        session,
        postProcessOutcomes
      );
      session = postProcessTurn.session;
    }

    const finalText = this.mergeNarrative(
      [initialTurn.responseText, synthesisTurn.responseText, resolvedSynthesisText],
      [...synthesisFollowUpOutcomes, ...postProcessOutcomes]
    );

    this.logger.info("Runtime task executed", {
      missionId: request.objective.id,
      stepId: request.step.id,
      capability: request.step.capability,
      iterations: session.iterations.length,
      toolCalls: session.iterations.flatMap((iteration) => iteration.toolCalls).length
    });

    return this.finalizeResult(session, frame, finalText);
  }

  executeProvider(request: ProviderExecutionRequest) {
    return this.providerRuntime.execute(request);
  }

  providerStatus(): RuntimeProviderStatus {
    return this.providerRuntime.status();
  }

  listSessions(workspaceId?: string) {
    return this.sessionStore
      .list()
      .filter((session) => (workspaceId ? session.workspaceId === workspaceId : true))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  getSession(sessionId: string) {
    return this.sessionStore.list().find((session) => session.id === sessionId);
  }

  selfCheck(text: string) {
    return verifyAndSanitize(text);
  }

  health(): ServiceHealth {
    const providerStatus = this.providerRuntime.status();
    return {
      name: "agent-runtime",
      ok: true,
      details: {
        providers: providerStatus.providers,
        sessions: this.sessionStore.list().length
      },
      readiness: {
        providers: {
          ok: providerStatus.liveProviders.length > 0,
          status: providerStatus.liveProviders.length > 0 ? "ready" : "degraded",
          message:
            providerStatus.liveProviders.length > 0
              ? "At least one live provider is available."
              : "Runtime is operating with synthetic-only provider availability."
        }
      },
      metricsPath: "/metrics"
    };
  }
}
