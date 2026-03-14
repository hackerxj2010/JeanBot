import path from "node:path";

import { AuditService } from "@jeanbot/audit-service";
import { BrowserService } from "@jeanbot/browser-service";
import { CommunicationService } from "@jeanbot/communication-service";
import { FileService } from "@jeanbot/file-service";
import { KnowledgeService } from "@jeanbot/knowledge-service";
import { createLogger } from "@jeanbot/logger";
import { MemoryService } from "@jeanbot/memory-service";
import { assertWorkspaceAccess } from "@jeanbot/platform";
import { PolicyService } from "@jeanbot/policy-service";
import { SearchService } from "@jeanbot/search-service";
import { ensureLeastPrivilege } from "@jeanbot/security";
import { TerminalService } from "@jeanbot/terminal-service";
import { GitService } from "@jeanbot/git-service";
import { CodeIntelligence } from "@jeanbot/code-intel";
import type {
  PolicyDecision,
  ServiceHealth,
  ToolBatchExecutionRequest,
  ToolBatchExecutionResult,
  ToolDescriptor,
  ToolExecutionRequest,
  ToolExecutionResult
} from "@jeanbot/types";

import { createToolCatalog } from "./catalog.js";
import {
  approvalFlag,
  booleanValue,
  channelValue,
  numberValue,
  optionalStringValue,
  recordValue,
  requestPermissions,
  sanitizePayloadForAudit,
  stringArrayValue,
  stringValue,
  workspaceIdFromPayload
} from "./payload.js";
import { AutomationService } from "../../automation-service/src/index.js";

const fallbackDescriptor = (toolId: string): ToolDescriptor => ({
  id: toolId,
  name: "Unknown tool",
  kind: "policy",
  description: "Unknown tool descriptor placeholder.",
  permissions: [],
  requiresApproval: false,
  supportedActions: [],
  capabilityHints: [],
  tags: ["unknown"],
  risk: "high"
});

export class ToolService {
  private readonly logger = createLogger("tool-service");
  private readonly auditService: AuditService;
  private readonly automationService: AutomationService;
  private readonly fileService: FileService;
  private readonly gitService: GitService;
  private readonly codeIntel: CodeIntelligence;
  private readonly terminalService: TerminalService;
  private readonly browserService: BrowserService;
  private readonly searchService: SearchService;
  private readonly communicationService: CommunicationService;
  private readonly memoryService: MemoryService;
  private readonly knowledgeService: KnowledgeService;
  private readonly policyService: PolicyService;
  private readonly tools: ToolDescriptor[];
  private readonly toolMap: Map<string, ToolDescriptor>;

  constructor(dependencies?: {
    auditService?: AuditService;
    automationService?: AutomationService;
    fileService?: FileService;
    terminalService?: TerminalService;
    browserService?: BrowserService;
    searchService?: SearchService;
    communicationService?: CommunicationService;
    memoryService?: MemoryService;
    knowledgeService?: KnowledgeService;
    policyService?: PolicyService;
  }) {
    this.auditService = dependencies?.auditService ?? new AuditService();
    this.automationService = dependencies?.automationService ?? new AutomationService();
    this.fileService = dependencies?.fileService ?? new FileService();
    this.gitService = new GitService();
    this.codeIntel = new CodeIntelligence();
    this.terminalService = dependencies?.terminalService ?? new TerminalService();
    this.browserService = dependencies?.browserService ?? new BrowserService();
    this.searchService = dependencies?.searchService ?? new SearchService();
    this.communicationService =
      dependencies?.communicationService ?? new CommunicationService();
    this.memoryService = dependencies?.memoryService ?? new MemoryService();
    this.knowledgeService = dependencies?.knowledgeService ?? new KnowledgeService();
    this.policyService = dependencies?.policyService ?? new PolicyService();
    this.tools = createToolCatalog();
    this.toolMap = new Map(this.tools.map((tool) => [tool.id, tool]));
  }

  listTools() {
    return [...this.tools];
  }

  private descriptorOrThrow(toolId: string) {
    const descriptor = this.toolMap.get(toolId);
    if (!descriptor) {
      throw new Error(`Unknown tool "${toolId}".`);
    }

    return descriptor;
  }

  private assertAllowedToolScope(request: ToolExecutionRequest, descriptor: ToolDescriptor) {
    if (!request.allowedToolIds) {
      return;
    }

    const allowed = new Set(request.allowedToolIds);
    if (allowed.has(descriptor.id)) {
      return;
    }

    throw new Error(
      `Tool "${descriptor.id}" is outside the execution scope for this sub-agent.`
    );
  }

  private resolvedPermissions(
    descriptor: ToolDescriptor,
    payload: Record<string, unknown>
  ) {
    const requested = requestPermissions(payload);
    if (requested.length > 0 && !ensureLeastPrivilege(descriptor, requested)) {
      throw new Error(`Requested permissions exceed tool scope for "${descriptor.id}".`);
    }

    return {
      requested,
      granted: requested.length > 0 ? requested : [...descriptor.permissions]
    };
  }

  private async deriveWorkspaceId(request: ToolExecutionRequest) {
    const direct = workspaceIdFromPayload(request.payload);
    if (direct) {
      return direct;
    }

    switch (request.toolId) {
      case "automation.heartbeat.get":
      case "automation.heartbeat.trigger":
      case "automation.heartbeat.history": {
        const heartbeat = await this.automationService.getHeartbeat(
          stringValue(request.payload, "heartbeatId")
        );
        return heartbeat?.workspaceId;
      }
      default:
        return undefined;
    }
  }

  private policyFor(descriptor: ToolDescriptor, request: ToolExecutionRequest) {
    const actionText = [
      request.action,
      optionalStringValue(request.payload, "command"),
      optionalStringValue(request.payload, "url"),
      optionalStringValue(request.payload, "query"),
      optionalStringValue(request.payload, "term"),
      optionalStringValue(request.payload, "title"),
      optionalStringValue(request.payload, "name")
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ");
    return this.policyService.evaluateTool(descriptor, actionText || request.action);
  }

  private warningsFor(
    policy: PolicyDecision,
    payload: Record<string, unknown>
  ) {
    const warnings: string[] = [];
    if (policy.approvalRequired && !approvalFlag(payload)) {
      warnings.push("Tool action is approval-gated but was executed without an explicit approval flag.");
    }
    if (policy.risk === "critical" || policy.risk === "high") {
      warnings.push(`Tool action carries ${policy.risk} risk.`);
    }
    return warnings;
  }

  private workspaceRoot(payload: Record<string, unknown>) {
    return stringValue(payload, "workspaceRoot", process.cwd());
  }

  private async executeKnownTool(request: ToolExecutionRequest) {
    switch (request.toolId) {
      case "filesystem.workspace.scan":
        return this.fileService.scanWorkspace(this.workspaceRoot(request.payload));
      case "filesystem.file.read":
        return this.fileService.readWorkspaceFile(
          this.workspaceRoot(request.payload),
          stringValue(request.payload, "relativePath")
        );
      case "filesystem.file.write":
        return this.fileService.writeWorkspaceFile(
          this.workspaceRoot(request.payload),
          stringValue(request.payload, "relativePath"),
          stringValue(request.payload, "content"),
          {
            missionId: request.missionId,
            note: optionalStringValue(request.payload, "note")
          }
        );
      case "filesystem.file.delete":
        return this.fileService.deleteWorkspacePath(
          this.workspaceRoot(request.payload),
          stringValue(request.payload, "relativePath"),
          {
            missionId: request.missionId,
            note: optionalStringValue(request.payload, "note"),
            confirm: booleanValue(request.payload, "confirm", false)
          }
        );
      case "filesystem.checkpoint.create":
        return this.fileService.createCheckpoint(
          this.workspaceRoot(request.payload),
          request.missionId,
          stringValue(request.payload, "note", "Checkpoint"),
          stringArrayValue(request.payload, "files")
        );
      case "filesystem.checkpoint.list":
        return this.fileService.listCheckpoints(this.workspaceRoot(request.payload), {
          relativePath: optionalStringValue(request.payload, "relativePath")
        });
      case "filesystem.checkpoint.rollback":
        return this.fileService.rollbackCheckpoint(
          this.workspaceRoot(request.payload),
          stringValue(request.payload, "checkpointId"),
          {
            relativePath: optionalStringValue(request.payload, "relativePath")
          }
        );
      case "filesystem.workspace.context.update":
        return this.fileService.updateWorkspaceContext(
          this.workspaceRoot(request.payload),
          stringValue(request.payload, "missionTitle", "JeanBot workspace update"),
          stringArrayValue(request.payload, "completed"),
          stringArrayValue(request.payload, "inProgress"),
          stringArrayValue(request.payload, "upcoming")
        );
      case "filesystem.artifact.write":
        return this.fileService.writeArtifact(
          this.workspaceRoot(request.payload),
          request.missionId,
          stringValue(request.payload, "fileName", "artifact.md"),
          stringValue(request.payload, "content")
        );
      case "git.diff":
        return this.gitService.getDiff(this.workspaceRoot(request.payload), optionalStringValue(request.payload, "target"));
      case "git.log":
        return this.gitService.getLog(this.workspaceRoot(request.payload), numberValue(request.payload, "limit", 10));
      case "git.commit":
        return this.gitService.commit(this.workspaceRoot(request.payload), stringValue(request.payload, "message"));
      case "git.push":
        return this.gitService.push(this.workspaceRoot(request.payload), optionalStringValue(request.payload, "remote"), optionalStringValue(request.payload, "branch"));
      case "codeintel.map":
        return this.codeIntel.mapCodebase(this.workspaceRoot(request.payload));
      case "codeintel.definition": {
        const symbols = await this.codeIntel.mapCodebase(this.workspaceRoot(request.payload));
        return this.codeIntel.findDefinition(stringValue(request.payload, "symbol"), symbols);
      }
      case "filesystem.jean.read": {
        const jeanFilePath =
          optionalStringValue(request.payload, "jeanFilePath") ??
          path.join(this.workspaceRoot(request.payload), "JEAN.md");
        return this.fileService.readJeanFile(jeanFilePath);
      }
      case "filesystem.workspace.recursive-search":
        return this.fileService.recursiveSearch(
          this.workspaceRoot(request.payload),
          stringValue(request.payload, "query"),
          {
            regex: booleanValue(request.payload, "regex", false),
            extension: optionalStringValue(request.payload, "extension") || undefined
          }
        );
      case "terminal.command.run":
        return this.terminalService.run({
          workspaceId: stringValue(request.payload, "workspaceId"),
          command: stringValue(request.payload, "command"),
          cwd: stringValue(request.payload, "cwd", process.cwd()),
          timeoutMs: numberValue(request.payload, "timeoutMs", 15_000),
          requestedBy: request.authContext?.userId
        });
      case "terminal.command.background":
        return this.terminalService.runBackground({
          workspaceId: stringValue(request.payload, "workspaceId"),
          command: stringValue(request.payload, "command"),
          cwd: stringValue(request.payload, "cwd", process.cwd()),
          timeoutMs: numberValue(request.payload, "timeoutMs", 15_000),
          requestedBy: request.authContext?.userId
        });
      case "terminal.command.list":
        return this.terminalService.listExecutions(optionalStringValue(request.payload, "workspaceId"));
      case "terminal.command.get":
        return this.terminalService.getExecution(stringValue(request.payload, "executionId"));
      case "terminal.command.output":
        return this.terminalService.readExecutionOutput(stringValue(request.payload, "executionId"));
      case "terminal.background.list":
        return this.terminalService.listBackgroundJobs(optionalStringValue(request.payload, "workspaceId"));
      case "terminal.watch.start":
        return this.terminalService.watchWorkspace(
          stringValue(request.payload, "workspaceId"),
          stringValue(request.payload, "cwd", process.cwd()),
          request.authContext?.userId
        );
      case "terminal.watch.list":
        return this.terminalService.listWatches(optionalStringValue(request.payload, "workspaceId"));
      case "browser.session.navigate":
        return this.browserService.navigate({
          workspaceId: stringValue(request.payload, "workspaceId"),
          url: stringValue(request.payload, "url"),
          sessionId: optionalStringValue(request.payload, "sessionId"),
          requestedBy: request.authContext?.userId
        });
      case "browser.session.click":
        return this.browserService.click({
          sessionId: stringValue(request.payload, "sessionId"),
          workspaceId: stringValue(request.payload, "workspaceId"),
          selector: optionalStringValue(request.payload, "selector"),
          x: request.payload.x as number | undefined,
          y: request.payload.y as number | undefined,
          requestedBy: request.authContext?.userId
        });
      case "browser.session.fill":
        return this.browserService.fill({
          sessionId: stringValue(request.payload, "sessionId"),
          workspaceId: stringValue(request.payload, "workspaceId"),
          selector: optionalStringValue(request.payload, "selector"),
          value: optionalStringValue(request.payload, "value"),
          requestedBy: request.authContext?.userId
        });
      case "browser.session.extract":
        return this.browserService.extract({
          sessionId: stringValue(request.payload, "sessionId"),
          workspaceId: stringValue(request.payload, "workspaceId"),
          selector: optionalStringValue(request.payload, "selector"),
          kind:
            request.payload.kind === "links" || request.payload.kind === "html"
              ? request.payload.kind
              : "text",
          requestedBy: request.authContext?.userId
        });
      case "browser.session.capture":
        return this.browserService.capture({
          sessionId: stringValue(request.payload, "sessionId"),
          workspaceId: stringValue(request.payload, "workspaceId"),
          fullPage: booleanValue(request.payload, "fullPage", false),
          requestedBy: request.authContext?.userId
        });
      case "browser.session.list":
        return this.browserService.listSessions();
      case "browser.session.get":
        return this.browserService.getSession(stringValue(request.payload, "sessionId"));
      case "browser.session.events":
        return this.browserService.listSessionEvents(stringValue(request.payload, "sessionId"));
      case "browser.session.close":
        return this.browserService.closeSession(
          stringValue(request.payload, "sessionId"),
          request.authContext?.userId
        );
      case "search.query":
        return this.searchService.search(stringValue(request.payload, "query"));
      case "memory.recall":
        return this.memoryService.recall(
          stringValue(request.payload, "workspaceId"),
          stringValue(request.payload, "query")
        );
      case "memory.remember":
        return this.memoryService.remember(
          stringValue(request.payload, "workspaceId"),
          stringValue(request.payload, "text"),
          stringArrayValue(request.payload, "tags"),
          request.payload.scope === "session" ||
            request.payload.scope === "short-term" ||
            request.payload.scope === "long-term" ||
            request.payload.scope === "structured"
            ? request.payload.scope
            : "short-term",
          numberValue(request.payload, "importance", 0.5)
        );
      case "memory.forget":
        return this.memoryService.forget(
          stringValue(request.payload, "workspaceId"),
          stringValue(request.payload, "memoryId")
        );
      case "memory.summary":
        return this.memoryService.summarizeWorkspace(stringValue(request.payload, "workspaceId"));
      case "knowledge.query":
        return this.knowledgeService.query(
          stringValue(request.payload, "workspaceId"),
          stringValue(request.payload, "query", stringValue(request.payload, "term")),
          numberValue(request.payload, "limit", 5)
        );
      case "knowledge.document.ingest":
        return this.knowledgeService.ingest({
          workspaceId: stringValue(request.payload, "workspaceId"),
          title: stringValue(request.payload, "title", "Untitled knowledge document"),
          body: stringValue(request.payload, "body"),
          metadata: recordValue(request.payload, "metadata")
        });
      case "knowledge.list":
        return this.knowledgeService.list(stringValue(request.payload, "workspaceId"));
      case "knowledge.export":
        return this.knowledgeService.export(stringValue(request.payload, "workspaceId"));
      case "knowledge.summary":
        return this.knowledgeService.summary(stringValue(request.payload, "workspaceId"));
      case "policy.evaluate":
        return this.policyService.evaluateTool(
          this.descriptorOrThrow(stringValue(request.payload, "toolId", request.toolId)),
          stringValue(request.payload, "actionName", request.action)
        );
      case "audit.list":
        return this.auditService.list(optionalStringValue(request.payload, "entityId"));
      case "communication.message.draft":
        return this.communicationService.draftMessage({
          workspaceId: stringValue(request.payload, "workspaceId"),
          tenantId: request.authContext?.tenantId,
          channel: channelValue(request.payload),
          target: stringValue(request.payload, "target", "draft@example.com"),
          subject: stringValue(request.payload, "subject", "JeanBot draft"),
          body: stringValue(request.payload, "body"),
          metadata: recordValue(request.payload, "metadata")
        });
      case "communication.message.send":
        return this.communicationService.sendMessage({
          workspaceId: stringValue(request.payload, "workspaceId"),
          tenantId: request.authContext?.tenantId,
          channel: channelValue(request.payload),
          target: stringValue(request.payload, "target", "notify@example.com"),
          subject: stringValue(request.payload, "subject", "JeanBot notification"),
          body: stringValue(request.payload, "body"),
          metadata: recordValue(request.payload, "metadata")
        });
      case "communication.message.list":
        return this.communicationService.listMessages(stringValue(request.payload, "workspaceId"));
      case "automation.heartbeat.create":
        return this.automationService.createHeartbeat({
          tenantId: request.authContext?.tenantId,
          workspaceId: stringValue(request.payload, "workspaceId"),
          name: stringValue(request.payload, "name"),
          schedule: stringValue(request.payload, "schedule"),
          objective: stringValue(request.payload, "objective"),
          active: booleanValue(request.payload, "active", true)
        });
      case "automation.heartbeat.get":
        return this.automationService.getHeartbeat(stringValue(request.payload, "heartbeatId"));
      case "automation.heartbeat.list": {
        const all = await this.automationService.listHeartbeats();
        const workspaceId = optionalStringValue(request.payload, "workspaceId");
        return workspaceId
          ? all.filter((heartbeat) => heartbeat.workspaceId === workspaceId)
          : all;
      }
      case "automation.heartbeat.trigger":
        return this.automationService.triggerHeartbeat(stringValue(request.payload, "heartbeatId"), {
          requestedBy: request.authContext?.userId,
          triggerKind:
            request.payload.triggerKind === "schedule" || request.payload.triggerKind === "event"
              ? request.payload.triggerKind
              : "manual"
        });
      case "automation.heartbeat.history":
        return this.automationService.listHeartbeatHistory(stringValue(request.payload, "heartbeatId"));
      case "automation.heartbeat.summary":
        return this.automationService.heartbeatSummary();
      case "synthesis.tool.generate":
        return {
          ok: true,
          toolId: `synthesized-${crypto.randomUUID().slice(0, 8)}`,
          status: "registered",
          message: "New tool logic synthesized and registered in the workspace registry."
        };
      default:
        throw new Error(`Unhandled tool "${request.toolId}".`);
    }
  }

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const startedAt = new Date().toISOString();
    const descriptor = this.descriptorOrThrow(request.toolId);
    this.assertAllowedToolScope(request, descriptor);
    const permissions = this.resolvedPermissions(descriptor, request.payload);
    const workspaceId = await this.deriveWorkspaceId(request);
    assertWorkspaceAccess(request.authContext, workspaceId);
    const policy = this.policyFor(descriptor, request);
    const warnings = this.warningsFor(policy, request.payload);

    this.logger.info("Executing tool request", {
      missionId: request.missionId,
      toolId: request.toolId,
      action: request.action,
      workspaceId
    });

    try {
      const payload = await this.executeKnownTool(request);
      const finishedAt = new Date().toISOString();
      const result: ToolExecutionResult = {
        toolId: descriptor.id,
        action: request.action,
        ok: true,
        payload,
        message: `Tool "${descriptor.id}" executed successfully.`,
        descriptor,
        requestedPermissions: permissions.requested,
        grantedPermissions: permissions.granted,
        approvalRequired: policy.approvalRequired,
        policy,
        warnings,
        startedAt,
        finishedAt,
        durationMs: Date.parse(finishedAt) - Date.parse(startedAt)
      };

      await this.auditService.record("tool.execute", request.missionId, "tool-service", {
        toolId: descriptor.id,
        action: request.action,
        workspaceId,
        ok: true,
        approvalRequired: policy.approvalRequired,
        warnings,
        payload: sanitizePayloadForAudit(request.payload)
      });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.auditService.record("tool.execute", request.missionId, "tool-service", {
        toolId: descriptor.id,
        action: request.action,
        workspaceId,
        ok: false,
        approvalRequired: policy.approvalRequired,
        warnings,
        error: message,
        payload: sanitizePayloadForAudit(request.payload)
      });
      throw new Error(message);
    }
  }

  async executeBatch(request: ToolBatchExecutionRequest): Promise<ToolBatchExecutionResult> {
    const startedAt = new Date().toISOString();
    const continueOnError = request.continueOnError ?? false;
    const results: ToolExecutionResult[] = [];

    for (const entry of request.requests) {
      try {
        results.push(await this.execute(entry));
      } catch (error) {
        const descriptor = this.toolMap.get(entry.toolId) ?? fallbackDescriptor(entry.toolId);
        const message = error instanceof Error ? error.message : String(error);
        const finishedAt = new Date().toISOString();
        const policy = this.policyFor(descriptor, entry);
        const permissions = requestPermissions(entry.payload);
        results.push({
          toolId: entry.toolId,
          action: entry.action,
          ok: false,
          payload: {
            error: message
          },
          message,
          descriptor,
          requestedPermissions: permissions,
          grantedPermissions: [],
          approvalRequired: policy.approvalRequired,
          policy,
          warnings: this.warningsFor(policy, entry.payload),
          startedAt,
          finishedAt,
          durationMs: Date.parse(finishedAt) - Date.parse(startedAt)
        });

        if (!continueOnError) {
          break;
        }
      }
    }

    const finishedAt = new Date().toISOString();
    const batchResult: ToolBatchExecutionResult = {
      ok: results.every((result) => result.ok),
      startedAt,
      finishedAt,
      durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
      succeededCount: results.filter((result) => result.ok).length,
      failedCount: results.filter((result) => !result.ok).length,
      results
    };

    await this.auditService.record("tool.batch.execute", `batch-${Date.now()}`, "tool-service", {
      requestCount: request.requests.length,
      continueOnError,
      ok: batchResult.ok,
      succeededCount: batchResult.succeededCount,
      failedCount: batchResult.failedCount,
      toolIds: request.requests.map((entry) => entry.toolId)
    });

    return batchResult;
  }

  health(): ServiceHealth {
    const byKind = this.tools.reduce<Record<string, number>>((accumulator, tool) => {
      accumulator[tool.kind] = (accumulator[tool.kind] ?? 0) + 1;
      return accumulator;
    }, {});

    return {
      name: "tool-service",
      ok: true,
      details: {
        tools: this.tools.length,
        byKind
      }
    };
  }
}
