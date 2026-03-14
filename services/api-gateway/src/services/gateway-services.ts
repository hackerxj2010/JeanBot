import crypto from "node:crypto";
import path from "node:path";

import type { AgentRuntimeService } from "@jeanbot/agent-runtime";
import { AdminService } from "@jeanbot/admin-service";
import { MissionOrchestrator } from "@jeanbot/agent-orchestrator";
import { AuthService } from "@jeanbot/auth-service";
import { AutomationService } from "@jeanbot/automation-service";
import { BillingService } from "@jeanbot/billing-service";
import { BrowserService } from "@jeanbot/browser-service";
import { CommunicationService } from "@jeanbot/communication-service";
import { KnowledgeService } from "@jeanbot/knowledge-service";
import { createLogger } from "@jeanbot/logger";
import { MemoryService } from "@jeanbot/memory-service";
import { NotificationService } from "@jeanbot/notification-service";
import {
  JeanbotError,
  assertPermission,
  assertWorkspaceAccess,
  buildServiceHeaders,
  fetchServiceJson,
  loadPlatformConfig,
  serviceUrl
} from "@jeanbot/platform";
import type {
  AdminTenantSummary,
  ApiKeyRecord,
  AuditEvent,
  BillingPlanRecord,
  BrowserActionRequest,
  BrowserCaptureRecord,
  BrowserCaptureRequest,
  BrowserEventRecord,
  BrowserExtractRequest,
  BrowserNavigateRequest,
  BrowserSessionSummary,
  BrowserStreamInfo,
  CommunicationMessageRecord,
  ConnectedIntegrationRecord,
  HeartbeatDefinition,
  HeartbeatExecutionRecord,
  IntegrationProvider,
  NotificationRecord,
  KnowledgeDocumentRecord,
  MissionExecutionTelemetry,
  MissionRecord,
  OAuthStartResponse,
  ProviderExecutionRequest,
  RoleRecord,
  SemanticSearchResponse,
  RuntimeExecutionRequest,
  RuntimeExecutionResult,
  RuntimeProviderStatus,
  RuntimeSandboxRequest,
  RuntimeSessionRecord,
  ServiceAuthContext,
  ServiceHealth,
  ToolDescriptor,
  ToolBatchExecutionInput,
  ToolBatchExecutionResult,
  ToolExecutionInput,
  ToolExecutionResult,
  TerminalBackgroundJobRecord,
  TerminalExecutionRecord,
  TerminalRunRequest,
  TerminalWatchRecord,
  UsageEventRecord,
  WorkspaceQuotaStatus,
  WorkspaceMembership,
  WorkspaceQuotaOverrideRecord,
  WorkspaceRecord
} from "@jeanbot/types";
import { UserService } from "@jeanbot/user-service";
import { TerminalService } from "@jeanbot/terminal-service";

export interface BootstrapRequest {
  tenantName: string;
  tenantSlug: string;
  email: string;
  displayName: string;
  workspaceName: string;
  workspaceSlug: string;
  apiKeyLabel: string;
}

interface VerifiedApiKey {
  apiKey: ApiKeyRecord;
  authContext: ServiceAuthContext;
}

interface VerifiedSession {
  authContext: ServiceAuthContext;
}

export class GatewayServices {
  private readonly logger = createLogger("api-gateway.services");
  private readonly config = loadPlatformConfig();
  private readonly orchestrator = new MissionOrchestrator();
  private readonly automation = new AutomationService();
  private readonly auth = new AuthService();
  private readonly user = new UserService();
  private readonly knowledge = new KnowledgeService();
  private readonly memory = new MemoryService();
  private readonly communication = new CommunicationService();
  private readonly billing = new BillingService();
  private readonly browser = new BrowserService();
  private readonly terminal = new TerminalService();
  private readonly notifications = new NotificationService();
  private readonly admin = new AdminService();

  private isHttpMode() {
    return this.config.serviceMode === "http";
  }

  private async recordUsageEvent(
    workspaceId: string,
    input: {
      metric: UsageEventRecord["metric"];
      quantity: number;
      sourceService: string;
      sourceEntityId: string;
      billable?: boolean | undefined;
      timestamp?: string | undefined;
    },
    authContext?: ServiceAuthContext
  ) {
    if (input.quantity <= 0) {
      return undefined;
    }

    const payload = {
      tenantId: authContext?.tenantId,
      metric: input.metric,
      quantity: input.quantity,
      sourceService: input.sourceService,
      sourceEntityId: input.sourceEntityId,
      timestamp: input.timestamp ?? new Date().toISOString(),
      billable: input.billable ?? true,
      metadata: {}
    };

    return this.isHttpMode()
      ? fetchServiceJson<UsageEventRecord>(
          `${serviceUrl("billing-service", this.config)}/internal/billing/workspaces/${workspaceId}/usage`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify(payload)
          }
        )
      : this.billing.recordUsage({
          ...payload,
          workspaceId
        });
  }

  private resolveRuntimeWorkspaceRoot(
    input: RuntimeSandboxRequest,
    authContext?: ServiceAuthContext
  ) {
    if (input.workspaceRoot) {
      return path.resolve(input.workspaceRoot);
    }

    return path.resolve(
      "workspace",
      "users",
      authContext?.userId ?? "{userId}"
    );
  }

  private riskForCapability(capability: RuntimeSandboxRequest["capability"]) {
    switch (capability) {
      case "browser":
      case "terminal":
      case "communication":
      case "finance":
      case "security":
        return "medium" as const;
      default:
        return "low" as const;
    }
  }

  private defaultToolIdsForCapability(
    tools: ToolDescriptor[],
    capability: RuntimeSandboxRequest["capability"]
  ) {
    const kindsByCapability: Record<RuntimeSandboxRequest["capability"], ToolDescriptor["kind"][]> = {
      reasoning: ["memory", "filesystem", "knowledge"],
      planning: ["filesystem", "memory", "knowledge"],
      terminal: ["terminal", "filesystem"],
      browser: ["browser"],
      filesystem: ["filesystem"],
      memory: ["memory"],
      research: ["browser", "knowledge", "search"],
      subagents: ["filesystem", "memory", "terminal", "browser"],
      communication: ["communication"],
      skills: ["filesystem", "knowledge"],
      "software-development": ["filesystem", "terminal", "memory"],
      "data-analysis": ["filesystem", "terminal", "memory"],
      writing: ["filesystem", "knowledge", "memory"],
      automation: ["automation", "communication"],
      "project-management": ["memory", "knowledge", "communication"],
      heartbeat: ["automation", "communication"],
      security: ["terminal", "filesystem", "audit", "policy"],
      learning: ["knowledge", "memory", "browser"],
      multimodality: ["filesystem", "browser"],
      finance: ["communication", "audit", "policy"],
      orchestration: ["filesystem", "memory", "browser", "terminal", "knowledge"],
      synthesis: ["terminal", "filesystem", "policy"],
      verification: ["terminal", "filesystem", "browser", "search", "knowledge"]
    };

    const allowedKinds = new Set(kindsByCapability[capability] ?? ["filesystem", "memory"]);
    const matching = tools
      .filter((tool) => allowedKinds.has(tool.kind))
      .map((tool) => tool.id);
    return matching.length > 0 ? matching : tools.map((tool) => tool.id);
  }

  private async notifyMissionCompletion(
    record: MissionRecord,
    authContext?: ServiceAuthContext
  ) {
    const status = record.status;
    if (status !== "completed" && status !== "failed") {
      return [];
    }

    const eventType = status === "completed" ? "mission.completed" : "mission.failed";
    const subject = `JeanBot mission ${status}: ${record.objective.title}`;
    const body = [
      `Mission: ${record.objective.title}`,
      `Status: ${status}`,
      `Workspace: ${record.objective.workspaceId}`,
      record.result?.verificationSummary ? `Summary: ${record.result.verificationSummary}` : undefined
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");

    try {
      return this.isHttpMode()
        ? await fetchServiceJson<NotificationRecord[]>(
            `${serviceUrl("notification-service", this.config)}/internal/notifications/task-completed`,
            {
              method: "POST",
              headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
              body: JSON.stringify({
                workspaceId: record.objective.workspaceId,
                userId: record.objective.userId,
                eventType,
                subject,
                body,
                metadata: {
                  missionId: record.objective.id,
                  status
                }
              })
            }
          )
        : await this.notifications.notifyUserTaskCompletion({
            workspaceId: record.objective.workspaceId,
            userId: record.objective.userId,
            eventType,
            subject,
            body,
            metadata: {
              missionId: record.objective.id,
              status
            }
          });
    } catch (error) {
      this.logger.warn("Mission completion notification failed", {
        missionId: record.objective.id,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  private resolveProviderRecord(
    status: RuntimeProviderStatus,
    provider?: ProviderExecutionRequest["provider"]
  ) {
    if (provider) {
      return status.providers.find((candidate) => candidate.provider === provider);
    }

    if (process.env.JEANBOT_MODEL_PROVIDER) {
      const preferred = status.providers.find(
        (candidate) => candidate.provider === process.env.JEANBOT_MODEL_PROVIDER
      );
      if (preferred) {
        return preferred;
      }
    }

    const preferred =
      status.providers.find((candidate) => candidate.provider === "anthropic" && candidate.liveAvailable) ??
      status.providers.find((candidate) => candidate.provider === "openai" && candidate.liveAvailable) ??
      status.providers.find((candidate) => candidate.provider === "ollama" && candidate.liveAvailable) ??
      status.providers.find((candidate) => candidate.provider === "anthropic") ??
      status.providers.find((candidate) => candidate.provider === "ollama") ??
      status.providers[0];
    return preferred;
  }

  private async createRuntimeExecutionRequest(
    input: RuntimeSandboxRequest,
    authContext?: ServiceAuthContext
  ): Promise<RuntimeExecutionRequest> {
    const workspaceRoot = this.resolveRuntimeWorkspaceRoot(input, authContext);
    const providerStatus = await this.runtimeProviderStatus(authContext);
    const providerRecord = this.resolveProviderRecord(providerStatus, input.provider);
    if (!providerRecord) {
      throw new JeanbotError({
        message: "No runtime providers are registered.",
        statusCode: 500,
        code: "runtime_provider_missing"
      });
    }

    if (input.mode === "live" && !providerRecord.liveAvailable) {
      throw new JeanbotError({
        message: providerRecord.message,
        statusCode: 409,
        code: "runtime_provider_unavailable",
        details: {
          provider: providerRecord.provider
        }
      });
    }

    const tools = await this.listTools(authContext);
    const toolIds =
      input.toolIds && input.toolIds.length > 0
        ? input.toolIds
        : this.defaultToolIdsForCapability(tools, input.capability);
    const missionId = `runtime-${crypto.randomUUID()}`;
    const stepId = `${missionId}-step-1`;
    const createdAt = new Date().toISOString();
    const provider = providerRecord.provider;
    const model = input.model ?? providerRecord.defaultModel;

    const objective = {
      id: missionId,
      tenantId: authContext?.tenantId,
      workspaceId: input.workspaceId,
      userId: authContext?.userId ?? "runtime-sandbox-user",
      title: input.title,
      objective: input.objective,
      context: input.context ?? "Gateway runtime sandbox execution.",
      constraints: input.constraints ?? [],
      requiredCapabilities: [input.capability],
      risk: this.riskForCapability(input.capability),
      createdAt
    };

    const step = {
      id: stepId,
      title: input.title,
      description: input.objective,
      capability: input.capability,
      stage: "execution" as const,
      dependsOn: [],
      verification: "Return a concrete operator update and preserve any tool outputs.",
      assignee: "runtime-sandbox",
      status: "ready" as const
    };

    const plan = {
      id: `plan-${missionId}`,
      missionId,
      version: 1,
      summary: `Runtime sandbox execution for ${input.title}.`,
      steps: [step],
      estimatedDurationMinutes: 5,
      estimatedCostUsd: 0.02,
      checkpoints: [],
      alternatives: [],
      generatedAt: createdAt
    };

    const context = {
      sessionId: crypto.randomUUID(),
      tenantId: authContext?.tenantId,
      authContext,
      workspaceRoot,
      jeanFilePath: path.join(workspaceRoot, "JEAN.md"),
      contextFilePath: path.join(workspaceRoot, ".jeanbot", "context.md"),
      artifactRoot: path.join(workspaceRoot, ".jeanbot", "artifacts"),
      planMode: input.mode !== "live",
      maxParallelism: 1
    };

    return {
      objective,
      step,
      plan,
      template: {
        id: `runtime-template-${provider}`,
        role: "runtime-sandbox",
        specialization: input.capability,
        instructions:
          "Execute the user request directly, use tools only when required, and return a concrete backend operator update.",
        maxParallelTasks: 1,
        provider,
        model,
        toolIds
      },
      context,
      authContext,
      providerMode: input.mode,
      maxIterations: input.maxIterations,
      additionalInstructions: input.additionalInstructions
    };
  }

  private filterMission(record: MissionRecord, authContext?: ServiceAuthContext) {
    assertWorkspaceAccess(authContext, record.objective.workspaceId);
    return record;
  }

  private filterHeartbeats(
    heartbeats: HeartbeatDefinition[],
    authContext?: ServiceAuthContext
  ) {
    if (!authContext) {
      return heartbeats;
    }

    return heartbeats.filter((heartbeat) =>
      authContext.workspaceIds.includes(heartbeat.workspaceId)
    );
  }

  private async findHeartbeat(
    heartbeatId: string,
    authContext?: ServiceAuthContext
  ) {
    const heartbeat = (await this.listHeartbeats(authContext)).find(
      (candidate) => candidate.id === heartbeatId
    );

    if (!heartbeat) {
      throw new JeanbotError({
        message: `Heartbeat "${heartbeatId}" was not found in the caller scope.`,
        statusCode: 404,
        code: "heartbeat_not_found",
        details: {
          heartbeatId
        }
      });
    }

    return heartbeat;
  }

  private async quotaStatusForWorkspace(
    workspaceId: string,
    authContext?: ServiceAuthContext
  ) {
    return this.isHttpMode()
      ? fetchServiceJson<WorkspaceQuotaStatus>(
          `${serviceUrl("billing-service", this.config)}/internal/billing/workspaces/${workspaceId}/quota`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.billing.getWorkspaceQuotaStatus(workspaceId, authContext?.tenantId);
  }

  private async assertWorkspaceQuota(
    workspaceId: string,
    resource:
      | "missions"
      | "knowledgeDocuments"
      | "automations"
      | "browserMinutes"
      | "terminalSeconds",
    authContext?: ServiceAuthContext,
    increment = 1
  ) {
    const quota = await this.quotaStatusForWorkspace(workspaceId, authContext);
    const projectedUsage = quota.usage[resource] + increment;
    const limit = quota.limits[resource];
    if (projectedUsage <= limit) {
      return quota;
    }

    throw new JeanbotError({
      message: `Workspace "${workspaceId}" exceeded the ${resource} quota for plan "${quota.planId}".`,
      statusCode: 409,
      code: "quota_exceeded",
      details: {
        workspaceId,
        resource,
        planId: quota.planId,
        current: quota.usage[resource],
        requested: increment,
        limit
      }
    });
  }

  async bootstrap(input: BootstrapRequest) {
    const bootstrapped = this.isHttpMode()
      ? await fetchServiceJson<Awaited<ReturnType<UserService["bootstrap"]>>>(
          `${serviceUrl("user-service", this.config)}/internal/users/bootstrap`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", undefined, this.config.internalServiceToken),
            body: JSON.stringify(input)
          }
        )
      : await this.user.bootstrap(input);

    const apiKey = this.isHttpMode()
      ? await fetchServiceJson<Awaited<ReturnType<AuthService["createApiKey"]>>>(
          `${serviceUrl("auth-service", this.config)}/internal/auth/api-keys`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", undefined, this.config.internalServiceToken),
            body: JSON.stringify({
              tenantId: bootstrapped.tenant.id,
              userId: bootstrapped.user.id,
              workspaceIds: [bootstrapped.workspace.id],
              label: input.apiKeyLabel
            })
          }
        )
      : await this.auth.createApiKey({
          tenantId: bootstrapped.tenant.id,
          userId: bootstrapped.user.id,
          workspaceIds: [bootstrapped.workspace.id],
          label: input.apiKeyLabel
        });

    return {
      ...bootstrapped,
      apiKey: apiKey.record,
      rawApiKey: apiKey.rawKey
    };
  }

  async verifyApiKey(rawKey: string): Promise<VerifiedApiKey | undefined> {
    const verified: {
      ok: boolean;
      apiKey?: ApiKeyRecord;
      authContext?: ServiceAuthContext;
    } = this.isHttpMode()
      ? await fetchServiceJson<{ ok: boolean; apiKey?: ApiKeyRecord; authContext?: ServiceAuthContext }>(
          `${serviceUrl("auth-service", this.config)}/internal/auth/verify-key`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", undefined, this.config.internalServiceToken),
            body: JSON.stringify({
              apiKey: rawKey
            })
          }
        )
      : await this.auth.verifyApiKey(rawKey).then((result) =>
          result
            ? {
                ok: true,
                ...result
              }
            : {
                ok: false
              }
        );

    if (!verified.ok || !verified.apiKey || !verified.authContext) {
      return undefined;
    }

    return {
      apiKey: verified.apiKey,
      authContext: verified.authContext
    };
  }

  async exchangeApiKeyForSession(rawKey: string) {
    return this.isHttpMode()
      ? fetchServiceJson<{
          ok: boolean;
          accessToken?: string;
          refreshToken?: string;
          authContext?: ServiceAuthContext;
        }>(
          `${serviceUrl("auth-service", this.config)}/internal/auth/sessions/exchange-key`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", undefined, this.config.internalServiceToken),
            body: JSON.stringify({
              apiKey: rawKey
            })
          }
        )
      : this.auth.exchangeApiKey(rawKey).then((result) =>
          result
            ? {
                ok: true,
                accessToken: result.accessToken,
                refreshToken: result.refreshToken,
                authContext: result.authContext
              }
            : {
                ok: false
              }
        );
  }

  async verifySession(accessToken: string): Promise<VerifiedSession | undefined> {
    const verified = this.isHttpMode()
      ? await fetchServiceJson<{ ok: boolean; authContext?: ServiceAuthContext }>(
          `${serviceUrl("auth-service", this.config)}/internal/auth/sessions/verify`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", undefined, this.config.internalServiceToken),
            body: JSON.stringify({
              accessToken
            })
          }
        )
      : await this.auth.verifyAccessToken(accessToken).then((result) =>
          result
            ? {
                ok: true,
                authContext: result.authContext
              }
            : {
                ok: false
              }
        );

    if (!verified.ok || !verified.authContext) {
      return undefined;
    }

    return {
      authContext: verified.authContext
    };
  }

  async refreshSession(refreshToken: string) {
    return this.isHttpMode()
      ? fetchServiceJson<{
          ok: boolean;
          accessToken?: string;
          refreshToken?: string;
          authContext?: ServiceAuthContext;
        }>(
          `${serviceUrl("auth-service", this.config)}/internal/auth/sessions/refresh`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", undefined, this.config.internalServiceToken),
            body: JSON.stringify({
              refreshToken
            })
          }
        )
      : this.auth.refreshSession(refreshToken).then((result) =>
          result
            ? {
                ok: true,
                accessToken: result.accessToken,
                refreshToken: result.refreshToken,
                authContext: result.authContext
              }
            : {
                ok: false
              }
        );
  }

  async listApiKeys(authContext: ServiceAuthContext) {
    assertPermission(authContext, "apikeys:manage");
    return this.isHttpMode()
      ? fetchServiceJson<ApiKeyRecord[]>(
          `${serviceUrl("auth-service", this.config)}/internal/auth/api-keys/${authContext.tenantId}`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.auth.listApiKeys(authContext.tenantId);
  }

  async listRoles(authContext: ServiceAuthContext) {
    assertPermission(authContext, "workspaces:manage");
    return this.isHttpMode()
      ? fetchServiceJson<RoleRecord[]>(
          `${serviceUrl("auth-service", this.config)}/internal/auth/roles/${authContext.tenantId}`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.auth.listRoles(authContext.tenantId);
  }

  async createRole(
    input: { name: string; permissions: string[] },
    authContext: ServiceAuthContext
  ) {
    assertPermission(authContext, "workspaces:manage");
    return this.isHttpMode()
      ? fetchServiceJson<RoleRecord>(
          `${serviceUrl("auth-service", this.config)}/internal/auth/roles`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify({
              tenantId: authContext.tenantId,
              name: input.name,
              permissions: input.permissions
            })
          }
        )
      : this.auth.createRole({
          tenantId: authContext.tenantId,
          name: input.name,
          permissions: input.permissions
        });
  }

  async listWorkspaceIntegrations(workspaceId: string, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "tools:use");
    assertWorkspaceAccess(authContext, workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<ConnectedIntegrationRecord[]>(
          `${serviceUrl("auth-service", this.config)}/internal/auth/workspaces/${workspaceId}/integrations`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.auth.listIntegrations(workspaceId);
  }

  async startWorkspaceIntegration(
    workspaceId: string,
    provider: IntegrationProvider,
    input: { redirectUri: string },
    authContext?: ServiceAuthContext
  ) {
    assertPermission(authContext, "tools:use");
    assertWorkspaceAccess(authContext, workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<OAuthStartResponse>(
          `${serviceUrl("auth-service", this.config)}/internal/auth/workspaces/${workspaceId}/integrations/${provider}/connect`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify(input)
          }
        )
      : this.auth.startOAuth(
          {
            workspaceId,
            provider,
            redirectUri: input.redirectUri
          },
          authContext
        );
  }

  async completeWorkspaceIntegration(
    workspaceId: string,
    provider: IntegrationProvider,
    input: {
      code: string;
      state: string;
      redirectUri: string;
    },
    authContext?: ServiceAuthContext
  ) {
    assertPermission(authContext, "tools:use");
    assertWorkspaceAccess(authContext, workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<ConnectedIntegrationRecord>(
          `${serviceUrl("auth-service", this.config)}/internal/auth/workspaces/${workspaceId}/integrations/${provider}/callback`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify(input)
          }
        )
      : this.auth.completeOAuth(
          {
            workspaceId,
            provider,
            code: input.code,
            state: input.state,
            redirectUri: input.redirectUri
          },
          authContext
        );
  }

  async disconnectWorkspaceIntegration(
    workspaceId: string,
    provider: IntegrationProvider,
    authContext?: ServiceAuthContext
  ) {
    assertPermission(authContext, "tools:use");
    assertWorkspaceAccess(authContext, workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<{ ok: boolean }>(
          `${serviceUrl("auth-service", this.config)}/internal/auth/workspaces/${workspaceId}/integrations/${provider}`,
          {
            method: "DELETE",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : {
          ok: await this.auth.disconnectIntegration(workspaceId, provider, authContext)
        };
  }

  async listWorkspaces(authContext: ServiceAuthContext) {
    assertPermission(authContext, "missions:read");
    return this.isHttpMode()
      ? fetchServiceJson<WorkspaceRecord[]>(
          `${serviceUrl("user-service", this.config)}/internal/users/${authContext.tenantId}/${authContext.userId}/workspaces`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.user.listWorkspaces(authContext.tenantId, authContext.userId);
  }

  async createWorkspace(
    input: { name: string; slug: string; roleIds?: string[] | undefined },
    authContext: ServiceAuthContext
  ) {
    assertPermission(authContext, "workspaces:manage");
    return this.isHttpMode()
      ? fetchServiceJson<{
          workspace: WorkspaceRecord;
          membership: WorkspaceMembership;
        }>(
          `${serviceUrl("user-service", this.config)}/internal/workspaces`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify({
              tenantId: authContext.tenantId,
              userId: authContext.userId,
              name: input.name,
              slug: input.slug,
              roleIds: input.roleIds
            })
          }
        )
      : this.user.createWorkspace({
          tenantId: authContext.tenantId,
          userId: authContext.userId,
          name: input.name,
          slug: input.slug,
          roleIds: input.roleIds
        });
  }

  async listWorkspaceMemberships(workspaceId: string, authContext: ServiceAuthContext) {
    assertPermission(authContext, "workspaces:manage");
    assertWorkspaceAccess(authContext, workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<WorkspaceMembership[]>(
          `${serviceUrl("user-service", this.config)}/internal/workspaces/${workspaceId}/memberships`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.user.listMemberships(workspaceId);
  }

  async addWorkspaceMembership(
    workspaceId: string,
    input: { userId: string; roleIds: string[] },
    authContext: ServiceAuthContext
  ) {
    assertPermission(authContext, "workspaces:manage");
    assertWorkspaceAccess(authContext, workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<WorkspaceMembership>(
          `${serviceUrl("user-service", this.config)}/internal/workspaces/${workspaceId}/memberships`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify({
              tenantId: authContext.tenantId,
              userId: input.userId,
              roleIds: input.roleIds
            })
          }
        )
      : this.user.addMembership({
          tenantId: authContext.tenantId,
          workspaceId,
          userId: input.userId,
          roleIds: input.roleIds
        });
  }

  async updateWorkspaceMembershipRoles(
    workspaceId: string,
    membershipId: string,
    roleIds: string[],
    authContext: ServiceAuthContext
  ) {
    assertPermission(authContext, "workspaces:manage");
    assertWorkspaceAccess(authContext, workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<WorkspaceMembership | undefined>(
          `${serviceUrl("user-service", this.config)}/internal/memberships/${membershipId}/roles`,
          {
            method: "PUT",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify({
              roleIds
            })
          }
        )
      : this.user.updateMembershipRoles(membershipId, roleIds);
  }

  async createMission(body: unknown, authContext?: ServiceAuthContext) {
    const workspaceId =
      body &&
      typeof body === "object" &&
      "workspaceId" in body &&
      typeof body.workspaceId === "string"
        ? body.workspaceId
        : undefined;
    if (workspaceId) {
      assertWorkspaceAccess(authContext, workspaceId);
      await this.assertWorkspaceQuota(workspaceId, "missions", authContext);
    }

    const record = this.isHttpMode()
      ? await fetchServiceJson<MissionRecord>(
          `${serviceUrl("agent-orchestrator", this.config)}/internal/missions`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify(body)
          }
        )
      : await this.orchestrator.createMission(body, authContext);
    if (workspaceId) {
      await this.recordUsageEvent(
        workspaceId,
        {
          metric: "missions",
          quantity: 1,
          sourceService: "api-gateway",
          sourceEntityId: record.objective.id
        },
        authContext
      );
    }
    return this.filterMission(record, authContext);
  }

  async planMission(missionId: string, authContext?: ServiceAuthContext) {
    const record = this.isHttpMode()
      ? await fetchServiceJson<MissionRecord>(
          `${serviceUrl("agent-orchestrator", this.config)}/internal/missions/${missionId}/plan`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : await this.orchestrator.planMission(missionId);
    return this.filterMission(record, authContext);
  }

  async runMission(
    missionId: string,
    workspaceRoot: string,
    authContext?: ServiceAuthContext
    ) {
      const record = this.isHttpMode()
        ? await fetchServiceJson<MissionRecord>(
            `${serviceUrl("agent-orchestrator", this.config)}/internal/missions/${missionId}/run`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify({
              workspaceRoot
              })
            }
          )
        : await this.orchestrator.runMission(missionId, workspaceRoot, authContext);
      await this.notifyMissionCompletion(record, authContext);
      return this.filterMission(record, authContext);
    }

  async approveMission(
    missionId: string,
    approvalId: string,
    authContext: ServiceAuthContext
  ) {
    assertPermission(authContext, "missions:approve");
    const record = this.isHttpMode()
      ? await fetchServiceJson<MissionRecord>(
          `${serviceUrl("agent-orchestrator", this.config)}/internal/missions/${missionId}/approvals/${approvalId}/approve`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify({
              approverId: authContext.userId
            })
          }
        )
      : await this.orchestrator.approveMission(missionId, approvalId, authContext.userId);
    return this.filterMission(record, authContext);
  }

  async getMission(missionId: string, authContext?: ServiceAuthContext) {
    const record = this.isHttpMode()
      ? await fetchServiceJson<MissionRecord>(
          `${serviceUrl("agent-orchestrator", this.config)}/internal/missions/${missionId}`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : await this.orchestrator.getMission(missionId);
    return this.filterMission(record, authContext);
  }

  async missionExecutionTelemetry(missionId: string, authContext?: ServiceAuthContext) {
    const mission = await this.getMission(missionId, authContext);
    return this.isHttpMode()
      ? fetchServiceJson<MissionExecutionTelemetry>(
          `${serviceUrl("agent-orchestrator", this.config)}/internal/missions/${mission.objective.id}/execution`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.orchestrator.getMissionExecutionTelemetry(mission.objective.id);
  }

  async listMissions(authContext?: ServiceAuthContext) {
    const missions = this.isHttpMode()
      ? await fetchServiceJson<MissionRecord[]>(
          `${serviceUrl("agent-orchestrator", this.config)}/internal/missions`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : await this.orchestrator.listMissions();

    if (!authContext) {
      return missions;
    }

    return missions.filter((mission) =>
      authContext.workspaceIds.includes(mission.objective.workspaceId)
    );
  }

  async listCapabilities(authContext?: ServiceAuthContext) {
    return this.isHttpMode()
      ? fetchServiceJson<Record<string, unknown>>(
          `${serviceUrl("agent-orchestrator", this.config)}/internal/capabilities`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.orchestrator.listCapabilities();
  }

  async listTools(authContext?: ServiceAuthContext) {
    return this.isHttpMode()
      ? fetchServiceJson<ToolDescriptor[]>(
          `${serviceUrl("agent-orchestrator", this.config)}/internal/tools`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.orchestrator.listTools();
  }

  async executeTool(input: ToolExecutionInput, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "tools:use");
    return this.isHttpMode()
      ? fetchServiceJson<ToolExecutionResult>(
          `${serviceUrl("agent-orchestrator", this.config)}/internal/tools/execute`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify(input)
          }
        )
      : this.orchestrator.executeTool(input, authContext);
  }

  async executeToolBatch(input: ToolBatchExecutionInput, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "tools:use");
    return this.isHttpMode()
      ? fetchServiceJson<ToolBatchExecutionResult>(
          `${serviceUrl("agent-orchestrator", this.config)}/internal/tools/batch`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify(input)
          }
        )
      : this.orchestrator.executeToolBatch(input, authContext);
  }

  async runtimeProviderStatus(authContext?: ServiceAuthContext) {
    assertPermission(authContext, "tools:use");
    return this.isHttpMode()
      ? fetchServiceJson<RuntimeProviderStatus>(
          `${serviceUrl("agent-runtime", this.config)}/internal/runtime/providers`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.orchestrator.runtimeService.providerStatus();
  }

  async executeRuntime(input: RuntimeSandboxRequest, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "tools:use");
    assertWorkspaceAccess(authContext, input.workspaceId);
    const request = await this.createRuntimeExecutionRequest(input, authContext);
    return this.isHttpMode()
      ? fetchServiceJson<RuntimeExecutionResult>(
          `${serviceUrl("agent-runtime", this.config)}/internal/runtime/execute`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify(request)
          }
        )
      : this.orchestrator.runtimeService.executeTask(request);
  }

  async listRuntimeSessions(workspaceId?: string, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "tools:use");
    if (workspaceId) {
      assertWorkspaceAccess(authContext, workspaceId);
    }

    const sessions = this.isHttpMode()
      ? await fetchServiceJson<RuntimeSessionRecord[]>(
          `${serviceUrl("agent-runtime", this.config)}/internal/runtime/sessions${
            workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""
          }`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.orchestrator.runtimeService.listSessions(workspaceId);

    if (!authContext) {
      return sessions;
    }

    return sessions.filter((session) => authContext.workspaceIds.includes(session.workspaceId));
  }

  async getRuntimeSession(sessionId: string, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "tools:use");
    const session = this.isHttpMode()
      ? await fetchServiceJson<RuntimeSessionRecord | undefined>(
          `${serviceUrl("agent-runtime", this.config)}/internal/runtime/sessions/${sessionId}`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.orchestrator.runtimeService.getSession(sessionId);
    if (!session) {
      throw new JeanbotError({
        message: `Runtime session "${sessionId}" was not found.`,
        statusCode: 404,
        code: "runtime_session_not_found",
        details: {
          sessionId
        }
      });
    }

    assertWorkspaceAccess(authContext, session.workspaceId);
    return session;
  }

  async workspaceMemory(workspaceId: string, authContext?: ServiceAuthContext) {
    assertWorkspaceAccess(authContext, workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson(
          `${serviceUrl("agent-orchestrator", this.config)}/internal/workspaces/${workspaceId}/memory`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.orchestrator.workspaceMemory(workspaceId);
  }

  async searchWorkspaceMemory(
    workspaceId: string,
    input: {
      query: string;
      limit?: number | undefined;
      injectLimit?: number | undefined;
      sourceKinds?: Array<"memory" | "knowledge"> | undefined;
    },
    authContext?: ServiceAuthContext
  ) {
    assertPermission(authContext, "missions:read");
    assertWorkspaceAccess(authContext, workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<SemanticSearchResponse>(
          `${serviceUrl("memory-service", this.config)}/internal/memory/workspaces/${workspaceId}/search`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify(input)
          }
        )
      : this.memory.semanticSearch(workspaceId, input.query, {
          limit: input.limit,
          injectLimit: input.injectLimit,
          sourceKinds: input.sourceKinds
        });
  }

  async listAuditEvents(entityId: string | undefined, authContext?: ServiceAuthContext) {
    const events = this.isHttpMode()
      ? await fetchServiceJson<AuditEvent[]>(
          `${serviceUrl("agent-orchestrator", this.config)}/internal/audit${
            entityId ? `?entityId=${encodeURIComponent(entityId)}` : ""
          }`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : await this.orchestrator.listAuditEvents(entityId);

    if (!authContext) {
      return events;
    }

    const allowedMissionIds = new Set(
      (await this.listMissions(authContext)).map((mission) => mission.objective.id)
    );
    return events.filter((event) => allowedMissionIds.has(event.entityId));
  }

  async createHeartbeat(
    input: Omit<HeartbeatDefinition, "id" | "tenantId">,
    authContext?: ServiceAuthContext
  ) {
    assertWorkspaceAccess(authContext, input.workspaceId);
    if (input.active) {
      await this.assertWorkspaceQuota(input.workspaceId, "automations", authContext);
    }
    const heartbeat = this.isHttpMode()
      ? await fetchServiceJson<HeartbeatDefinition>(
          `${serviceUrl("automation-service", this.config)}/internal/heartbeats`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify({
              ...input,
              tenantId: authContext?.tenantId
            })
          }
        )
      : await this.automation.createHeartbeat({
          ...input,
          tenantId: authContext?.tenantId
        });
    if (heartbeat.active) {
      await this.recordUsageEvent(
        heartbeat.workspaceId,
        {
          metric: "automations",
          quantity: 1,
          sourceService: "api-gateway",
          sourceEntityId: heartbeat.id
        },
        authContext
      );
    }
    return heartbeat;
  }

  async listHeartbeats(authContext?: ServiceAuthContext) {
    const heartbeats = this.isHttpMode()
      ? await fetchServiceJson<HeartbeatDefinition[]>(
          `${serviceUrl("automation-service", this.config)}/internal/heartbeats`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : await this.automation.listHeartbeats();
    return this.filterHeartbeats(heartbeats, authContext);
  }

  async updateHeartbeat(
    heartbeatId: string,
    input: {
      name?: string | undefined;
      schedule?: string | undefined;
      objective?: string | undefined;
      active?: boolean | undefined;
    },
    authContext?: ServiceAuthContext
  ) {
    const heartbeat = await this.findHeartbeat(heartbeatId, authContext);
    assertWorkspaceAccess(authContext, heartbeat.workspaceId);
    const update = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined)
    ) as Partial<Pick<HeartbeatDefinition, "schedule" | "active" | "name" | "objective">>;
    return this.isHttpMode()
      ? fetchServiceJson<HeartbeatDefinition | undefined>(
          `${serviceUrl("automation-service", this.config)}/internal/heartbeats/${heartbeatId}`,
          {
            method: "PUT",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify(update)
          }
        )
      : this.automation.updateHeartbeat(heartbeatId, update);
  }

  async pauseHeartbeat(heartbeatId: string, authContext?: ServiceAuthContext) {
    const heartbeat = await this.findHeartbeat(heartbeatId, authContext);
    assertWorkspaceAccess(authContext, heartbeat.workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<HeartbeatDefinition | undefined>(
          `${serviceUrl("automation-service", this.config)}/internal/heartbeats/${heartbeatId}/pause`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.automation.pauseHeartbeat(heartbeatId);
  }

  async resumeHeartbeat(heartbeatId: string, authContext?: ServiceAuthContext) {
    const heartbeat = await this.findHeartbeat(heartbeatId, authContext);
    assertWorkspaceAccess(authContext, heartbeat.workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<HeartbeatDefinition | undefined>(
          `${serviceUrl("automation-service", this.config)}/internal/heartbeats/${heartbeatId}/resume`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.automation.resumeHeartbeat(heartbeatId);
  }

  async triggerHeartbeat(heartbeatId: string, authContext?: ServiceAuthContext) {
    await this.findHeartbeat(heartbeatId, authContext);
    const heartbeat = this.isHttpMode()
      ? await fetchServiceJson<HeartbeatDefinition | undefined>(
          `${serviceUrl("automation-service", this.config)}/internal/heartbeats/${heartbeatId}/trigger`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : await this.automation.triggerHeartbeat(heartbeatId);

    if (!heartbeat) {
      return undefined;
    }

    return heartbeat;
  }

  async listHeartbeatHistory(heartbeatId: string, authContext?: ServiceAuthContext) {
    const heartbeat = await this.findHeartbeat(heartbeatId, authContext);
    const executions = this.isHttpMode()
      ? await fetchServiceJson<HeartbeatExecutionRecord[]>(
          `${serviceUrl("automation-service", this.config)}/internal/heartbeats/${heartbeatId}/history`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : await this.automation.listHeartbeatHistory(heartbeatId);

    assertWorkspaceAccess(authContext, heartbeat.workspaceId);
    return executions;
  }

  async browserNavigate(input: BrowserNavigateRequest, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "tools:use");
    assertWorkspaceAccess(authContext, input.workspaceId);
    if (!input.sessionId) {
      await this.assertWorkspaceQuota(input.workspaceId, "browserMinutes", authContext);
    }

    return this.isHttpMode()
      ? fetchServiceJson<BrowserSessionSummary>(
          `${serviceUrl("browser-service", this.config)}/internal/browser/navigate`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify(input)
          }
        )
      : this.browser.navigate({
          ...input,
          requestedBy: input.requestedBy ?? authContext?.userId
        });
  }

  async browserClick(input: BrowserActionRequest, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "tools:use");
    assertWorkspaceAccess(authContext, input.workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<{ session: BrowserSessionSummary; event: BrowserEventRecord }>(
          `${serviceUrl("browser-service", this.config)}/internal/browser/actions/click`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify(input)
          }
        )
      : this.browser.click({
          ...input,
          requestedBy: input.requestedBy ?? authContext?.userId
        });
  }

  async browserFill(input: BrowserActionRequest, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "tools:use");
    assertWorkspaceAccess(authContext, input.workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<{ session: BrowserSessionSummary; event: BrowserEventRecord }>(
          `${serviceUrl("browser-service", this.config)}/internal/browser/actions/fill`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify(input)
          }
        )
      : this.browser.fill({
          ...input,
          requestedBy: input.requestedBy ?? authContext?.userId
        });
  }

  async browserExtract(input: BrowserExtractRequest, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "tools:use");
    assertWorkspaceAccess(authContext, input.workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson(
          `${serviceUrl("browser-service", this.config)}/internal/browser/actions/extract`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify(input)
          }
        )
      : this.browser.extract({
          ...input,
          requestedBy: input.requestedBy ?? authContext?.userId
        });
  }

  async browserCapture(input: BrowserCaptureRequest, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "tools:use");
    assertWorkspaceAccess(authContext, input.workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<BrowserCaptureRecord>(
          `${serviceUrl("browser-service", this.config)}/internal/browser/capture`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify(input)
          }
        )
      : this.browser.capture({
          ...input,
          requestedBy: input.requestedBy ?? authContext?.userId
        });
  }

  async listBrowserSessions(authContext?: ServiceAuthContext) {
    assertPermission(authContext, "tools:use");
    const sessions = this.isHttpMode()
      ? await fetchServiceJson<BrowserSessionSummary[]>(
          `${serviceUrl("browser-service", this.config)}/internal/browser/sessions`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : await this.browser.listSessions();

    return authContext
      ? sessions.filter((session) => authContext.workspaceIds.includes(session.workspaceId))
      : sessions;
  }

  async getBrowserSession(sessionId: string, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "tools:use");
    const session = this.isHttpMode()
      ? await fetchServiceJson<
          | (BrowserSessionSummary & {
              events: BrowserEventRecord[];
              captures: BrowserCaptureRecord[];
            })
          | undefined
        >(`${serviceUrl("browser-service", this.config)}/internal/browser/sessions/${sessionId}`, {
          method: "GET",
          headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
        })
      : await this.browser.getSession(sessionId);

    if (session) {
      assertWorkspaceAccess(authContext, session.workspaceId);
    }

    return session;
  }

  async listBrowserSessionEvents(sessionId: string, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "tools:use");
    const session = await this.getBrowserSession(sessionId, authContext);
    if (!session) {
      return [];
    }

    return this.isHttpMode()
      ? fetchServiceJson<BrowserEventRecord[]>(
          `${serviceUrl("browser-service", this.config)}/internal/browser/sessions/${sessionId}/events`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.browser.listSessionEvents(sessionId);
  }

  async browserStreamInfo(sessionId: string, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "tools:use");
    const session = await this.getBrowserSession(sessionId, authContext);
    if (!session) {
      throw new JeanbotError({
        message: `Browser session "${sessionId}" was not found.`,
        statusCode: 404,
        code: "browser_session_not_found"
      });
    }

    return this.isHttpMode()
      ? fetchServiceJson<BrowserStreamInfo>(
          `${serviceUrl("browser-service", this.config)}/internal/browser/sessions/${sessionId}/stream-info?workspaceId=${encodeURIComponent(session.workspaceId)}`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.browser.getStreamInfo(sessionId, session.workspaceId);
  }

  async closeBrowserSession(sessionId: string, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "tools:use");
    const session = await this.getBrowserSession(sessionId, authContext);
    if (!session) {
      return {
        ok: false
      };
    }

    const result = this.isHttpMode()
      ? await fetchServiceJson<{ ok: boolean }>(
          `${serviceUrl("browser-service", this.config)}/internal/browser/sessions/${sessionId}`,
          {
            method: "DELETE",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : {
          ok: await this.browser.closeSession(sessionId, authContext?.userId)
        };

    if (result.ok) {
      const startedAt = new Date(session.createdAt).getTime();
      const endedAt = new Date(session.lastActiveAt ?? new Date().toISOString()).getTime();
      const minutes = Math.max(1, Math.ceil((Math.max(endedAt, startedAt) - startedAt) / 60_000));
      await this.recordUsageEvent(
        session.workspaceId,
        {
          metric: "browserMinutes",
          quantity: minutes,
          sourceService: "browser-service",
          sourceEntityId: session.id,
          timestamp: session.lastActiveAt ?? new Date().toISOString()
        },
        authContext
      );
    }

    return result;
  }

  async terminalRun(input: TerminalRunRequest, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "tools:use");
    assertWorkspaceAccess(authContext, input.workspaceId);
    const requestedSeconds = Math.max(1, Math.ceil((input.timeoutMs ?? 10_000) / 1_000));
    await this.assertWorkspaceQuota(input.workspaceId, "terminalSeconds", authContext, requestedSeconds);

    const result = await (this.isHttpMode()
      ? await fetchServiceJson<{ record: TerminalExecutionRecord; stdout: string; stderr: string }>(
          `${serviceUrl("terminal-service", this.config)}/internal/terminal/run`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify(input)
          }
        )
      : this.terminal.run({
          ...input,
          requestedBy: input.requestedBy ?? authContext?.userId
        }));

    const startedAt = new Date(result.record.startedAt ?? result.record.createdAt).getTime();
    const finishedAt = new Date(result.record.finishedAt ?? result.record.createdAt).getTime();
    const terminalSeconds = Math.max(1, Math.ceil((Math.max(finishedAt, startedAt) - startedAt) / 1_000));
    await this.recordUsageEvent(
      input.workspaceId,
      {
        metric: "terminalSeconds",
        quantity: terminalSeconds,
        sourceService: "terminal-service",
        sourceEntityId: result.record.id,
        timestamp: result.record.finishedAt ?? result.record.createdAt
      },
      authContext
    );

    return result;
  }

  async terminalRunBackground(input: TerminalRunRequest, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "tools:use");
    assertWorkspaceAccess(authContext, input.workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<TerminalBackgroundJobRecord>(
          `${serviceUrl("terminal-service", this.config)}/internal/terminal/background`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify(input)
          }
        )
      : this.terminal.runBackground({
          ...input,
          requestedBy: input.requestedBy ?? authContext?.userId
        });
  }

  async listTerminalExecutions(workspaceId: string | undefined, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "tools:use");
    if (workspaceId) {
      assertWorkspaceAccess(authContext, workspaceId);
    }

    const executions = this.isHttpMode()
      ? await fetchServiceJson<TerminalExecutionRecord[]>(
          `${serviceUrl("terminal-service", this.config)}/internal/terminal/executions${
            workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""
          }`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : await this.terminal.listExecutions(workspaceId);

    return authContext
      ? executions.filter((execution) => authContext.workspaceIds.includes(execution.workspaceId))
      : executions;
  }

  async getTerminalExecution(executionId: string, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "tools:use");
    const execution = this.isHttpMode()
      ? await fetchServiceJson<TerminalExecutionRecord | undefined>(
          `${serviceUrl("terminal-service", this.config)}/internal/terminal/executions/${executionId}`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : await this.terminal.getExecution(executionId);

    if (execution) {
      assertWorkspaceAccess(authContext, execution.workspaceId);
    }

    return execution;
  }

  async getTerminalExecutionOutput(executionId: string, authContext?: ServiceAuthContext) {
    const execution = await this.getTerminalExecution(executionId, authContext);
    if (!execution) {
      return undefined;
    }

    return this.isHttpMode()
      ? fetchServiceJson<{ executionId: string; stdout: string; stderr: string }>(
          `${serviceUrl("terminal-service", this.config)}/internal/terminal/executions/${executionId}/output`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.terminal.readExecutionOutput(executionId);
  }

  async listTerminalBackgroundJobs(workspaceId: string | undefined, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "tools:use");
    if (workspaceId) {
      assertWorkspaceAccess(authContext, workspaceId);
    }

    const jobs = this.isHttpMode()
      ? await fetchServiceJson<TerminalBackgroundJobRecord[]>(
          `${serviceUrl("terminal-service", this.config)}/internal/terminal/background${
            workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""
          }`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : await this.terminal.listBackgroundJobs(workspaceId);

    return authContext
      ? jobs.filter((job) => authContext.workspaceIds.includes(job.workspaceId))
      : jobs;
  }

  async watchTerminalWorkspace(
    input: { workspaceId: string; cwd: string },
    authContext?: ServiceAuthContext
  ) {
    assertPermission(authContext, "tools:use");
    assertWorkspaceAccess(authContext, input.workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<{ cwd: string; active: boolean }>(
          `${serviceUrl("terminal-service", this.config)}/internal/terminal/watch`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify(input)
          }
        )
      : this.terminal.watchWorkspace(input.workspaceId, input.cwd, authContext?.userId);
  }

  async listTerminalWatches(workspaceId: string | undefined, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "tools:use");
    if (workspaceId) {
      assertWorkspaceAccess(authContext, workspaceId);
    }

    const watches = this.isHttpMode()
      ? await fetchServiceJson<TerminalWatchRecord[]>(
          `${serviceUrl("terminal-service", this.config)}/internal/terminal/watches${
            workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""
          }`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : await this.terminal.listWatches(workspaceId);

    return authContext
      ? watches.filter((watch) => authContext.workspaceIds.includes(watch.workspaceId))
      : watches;
  }

  async listKnowledgeDocuments(workspaceId: string, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "knowledge:read");
    assertWorkspaceAccess(authContext, workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<KnowledgeDocumentRecord[]>(
          `${serviceUrl("knowledge-service", this.config)}/internal/knowledge/workspaces/${workspaceId}/documents`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.knowledge.list(workspaceId);
  }

  async ingestKnowledge(
    workspaceId: string,
    input: {
      title: string;
      body: string;
      metadata?: Record<string, unknown> | undefined;
    },
    authContext?: ServiceAuthContext
  ) {
    assertPermission(authContext, "knowledge:write");
    assertWorkspaceAccess(authContext, workspaceId);
    await this.assertWorkspaceQuota(workspaceId, "knowledgeDocuments", authContext);
    const document = await (this.isHttpMode()
      ? await fetchServiceJson<KnowledgeDocumentRecord>(
          `${serviceUrl("knowledge-service", this.config)}/internal/knowledge/workspaces/${workspaceId}/documents`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify(input)
          }
        )
      : this.knowledge.ingest({
          workspaceId,
          title: input.title,
          body: input.body,
          metadata: input.metadata
        }));

    await this.recordUsageEvent(
      workspaceId,
      {
        metric: "knowledgeDocuments",
        quantity: 1,
        sourceService: "knowledge-service",
        sourceEntityId: document.id,
        timestamp: document.createdAt
      },
      authContext
    );

    return document;
  }

  async queryKnowledge(
    workspaceId: string,
    term: string,
    limit: number | undefined,
    authContext?: ServiceAuthContext
  ) {
    assertPermission(authContext, "knowledge:read");
    assertWorkspaceAccess(authContext, workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<KnowledgeDocumentRecord[]>(
          `${serviceUrl("knowledge-service", this.config)}/internal/knowledge/workspaces/${workspaceId}/query`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify({
              term,
              limit
            })
          }
        )
      : this.knowledge.query(workspaceId, term, limit ?? 5);
  }

  async searchKnowledge(
    workspaceId: string,
    input: {
      query: string;
      limit?: number | undefined;
      injectLimit?: number | undefined;
    },
    authContext?: ServiceAuthContext
  ) {
    assertPermission(authContext, "knowledge:read");
    assertWorkspaceAccess(authContext, workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<SemanticSearchResponse>(
          `${serviceUrl("knowledge-service", this.config)}/internal/knowledge/workspaces/${workspaceId}/search`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify(input)
          }
        )
      : this.knowledge.semanticSearch(workspaceId, input.query, {
          limit: input.limit,
          injectLimit: input.injectLimit
        });
  }

  async exportKnowledge(workspaceId: string, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "knowledge:read");
    assertWorkspaceAccess(authContext, workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<{ workspaceId: string; exportedAt: string; documents: KnowledgeDocumentRecord[] }>(
          `${serviceUrl("knowledge-service", this.config)}/internal/knowledge/workspaces/${workspaceId}/export`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.knowledge.export(workspaceId);
  }

  async listCommunicationMessages(workspaceId: string, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "communication:read");
    assertWorkspaceAccess(authContext, workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<CommunicationMessageRecord[]>(
          `${serviceUrl("communication-service", this.config)}/internal/communication/workspaces/${workspaceId}/messages`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.communication.listMessages(workspaceId);
  }

  async draftCommunicationMessage(
    workspaceId: string,
    input: Omit<CommunicationMessageRecord, "id" | "workspaceId" | "tenantId" | "status" | "mode" | "createdAt">,
    authContext?: ServiceAuthContext
  ) {
    assertPermission(authContext, "communication:send");
    assertWorkspaceAccess(authContext, workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<CommunicationMessageRecord>(
          `${serviceUrl("communication-service", this.config)}/internal/communication/messages/draft`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify({
              workspaceId,
              tenantId: authContext?.tenantId,
              channel: input.channel,
              target: input.target,
              subject: input.subject,
              body: input.body,
              metadata: input.metadata
            })
          }
        )
      : this.communication.draftMessage({
          workspaceId,
          tenantId: authContext?.tenantId,
          channel: input.channel,
          target: input.target,
          subject: input.subject,
          body: input.body,
          metadata: input.metadata
        });
  }

  async sendCommunicationMessage(
    workspaceId: string,
    input: Omit<CommunicationMessageRecord, "id" | "workspaceId" | "tenantId" | "status" | "mode" | "createdAt">,
    authContext?: ServiceAuthContext
  ) {
    assertPermission(authContext, "communication:send");
    assertWorkspaceAccess(authContext, workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<CommunicationMessageRecord>(
          `${serviceUrl("communication-service", this.config)}/internal/communication/messages/send`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify({
              workspaceId,
              tenantId: authContext?.tenantId,
              channel: input.channel,
              target: input.target,
              subject: input.subject,
              body: input.body,
              metadata: input.metadata
            })
          }
        )
      : this.communication.sendMessage({
          workspaceId,
          tenantId: authContext?.tenantId,
          channel: input.channel,
          target: input.target,
          subject: input.subject,
          body: input.body,
          metadata: input.metadata
        });
  }

  async listBillingPlans(authContext?: ServiceAuthContext) {
    assertPermission(authContext, "billing:read");
    return this.isHttpMode()
      ? fetchServiceJson<BillingPlanRecord[]>(
          `${serviceUrl("billing-service", this.config)}/internal/billing/plans`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.billing.listPlans();
  }

  async workspaceBilling(workspaceId: string, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "billing:read");
    assertWorkspaceAccess(authContext, workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<Awaited<ReturnType<BillingService["getWorkspaceSummary"]>>>(
          `${serviceUrl("billing-service", this.config)}/internal/billing/workspaces/${workspaceId}/summary`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.billing.getWorkspaceSummary(workspaceId, authContext?.tenantId);
  }

  async workspaceQuota(workspaceId: string, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "billing:read");
    assertWorkspaceAccess(authContext, workspaceId);
    return this.quotaStatusForWorkspace(workspaceId, authContext);
  }

  async workspaceUsage(
    workspaceId: string,
    input: {
      metric?: UsageEventRecord["metric"] | undefined;
      limit?: number | undefined;
    } = {},
    authContext?: ServiceAuthContext
  ) {
    assertPermission(authContext, "billing:read");
    assertWorkspaceAccess(authContext, workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<UsageEventRecord[]>(
          `${serviceUrl("billing-service", this.config)}/internal/billing/workspaces/${workspaceId}/usage?${
            input.metric ? `metric=${encodeURIComponent(input.metric)}&` : ""
          }limit=${input.limit ?? 50}`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.billing.listUsageEvents(workspaceId, input.metric, input.limit ?? 50);
  }

  async updateWorkspaceBilling(
    workspaceId: string,
    input: {
      planId: string;
      stripeCustomerId?: string | undefined;
    },
    authContext?: ServiceAuthContext
  ) {
    assertPermission(authContext, "billing:read");
    assertWorkspaceAccess(authContext, workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<Awaited<ReturnType<BillingService["updateWorkspacePlan"]>>>(
          `${serviceUrl("billing-service", this.config)}/internal/billing/workspaces/${workspaceId}/subscription`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify(input)
          }
        )
      : this.billing.updateWorkspacePlan({
          workspaceId,
          tenantId: authContext?.tenantId,
          planId: input.planId,
          stripeCustomerId: input.stripeCustomerId
        });
  }

  async createBillingPortal(workspaceId: string, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "billing:read");
    assertWorkspaceAccess(authContext, workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<{ workspaceId: string; mode: string; portalUrl: string }>(
          `${serviceUrl("billing-service", this.config)}/internal/billing/workspaces/${workspaceId}/portal`,
          {
            method: "POST",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.billing.createBillingPortal(workspaceId, authContext?.tenantId);
  }

  async listNotifications(workspaceId: string, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "missions:read");
    assertWorkspaceAccess(authContext, workspaceId);
    return this.isHttpMode()
      ? fetchServiceJson<NotificationRecord[]>(
          `${serviceUrl("notification-service", this.config)}/internal/notifications/workspaces/${workspaceId}?userId=${encodeURIComponent(authContext?.userId ?? "")}`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.notifications.listNotifications(workspaceId, authContext?.userId);
  }

  async listAdminTenants(authContext?: ServiceAuthContext) {
    assertPermission(authContext, "admin:manage");
    return this.isHttpMode()
      ? fetchServiceJson<AdminTenantSummary[]>(
          `${serviceUrl("admin-service", this.config)}/internal/admin/tenants`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.admin.listTenants();
  }

  async getWorkspaceQuotaOverride(workspaceId: string, authContext?: ServiceAuthContext) {
    assertPermission(authContext, "admin:manage");
    return this.isHttpMode()
      ? fetchServiceJson<WorkspaceQuotaOverrideRecord | undefined>(
          `${serviceUrl("admin-service", this.config)}/internal/admin/workspaces/${workspaceId}/quota-override`,
          {
            method: "GET",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken)
          }
        )
      : this.admin.getWorkspaceQuotaOverride(workspaceId);
  }

  async updateWorkspaceQuotaOverride(
    workspaceId: string,
    input: {
      limits: Partial<Record<UsageEventRecord["metric"], number>>;
      reason?: string | undefined;
    },
    authContext?: ServiceAuthContext
  ) {
    assertPermission(authContext, "admin:manage");
    return this.isHttpMode()
      ? fetchServiceJson<{
          override: WorkspaceQuotaOverrideRecord;
          quota: WorkspaceQuotaStatus;
        }>(
          `${serviceUrl("admin-service", this.config)}/internal/admin/workspaces/${workspaceId}/quota-override`,
          {
            method: "PUT",
            headers: buildServiceHeaders("api-gateway", authContext, this.config.internalServiceToken),
            body: JSON.stringify({
              tenantId: authContext?.tenantId,
              limits: input.limits,
              reason: input.reason,
              updatedBy: authContext?.userId
            })
          }
        )
      : this.admin.updateWorkspaceQuotaOverride({
          workspaceId,
          tenantId: authContext?.tenantId,
          limits: input.limits,
          reason: input.reason,
          updatedBy: authContext?.userId
        });
  }

  async health() {
    if (!this.isHttpMode()) {
      return {
        services: [
          ...this.orchestrator.health(),
          this.automation.health(),
          this.auth.health(),
          this.user.health(),
          this.knowledge.health(),
          this.communication.health(),
          this.billing.health(),
          this.browser.health(),
          this.terminal.health(),
          this.notifications.health(),
          this.admin.health()
        ]
      };
    }

    const healthChecks = await Promise.all([
      fetchServiceJson<{ services?: ServiceHealth[]; service?: ServiceHealth }>(
        `${serviceUrl("agent-orchestrator", this.config)}/health`,
        {
          method: "GET",
          headers: buildServiceHeaders("api-gateway", undefined, this.config.internalServiceToken)
        }
      ),
      fetchServiceJson<{ service: ServiceHealth }>(
        `${serviceUrl("automation-service", this.config)}/health`,
        {
          method: "GET",
          headers: buildServiceHeaders("api-gateway", undefined, this.config.internalServiceToken)
        }
      ),
      fetchServiceJson<{ service: ServiceHealth }>(
        `${serviceUrl("auth-service", this.config)}/health`,
        {
          method: "GET",
          headers: buildServiceHeaders("api-gateway", undefined, this.config.internalServiceToken)
        }
      ),
      fetchServiceJson<{ service: ServiceHealth }>(
        `${serviceUrl("user-service", this.config)}/health`,
        {
          method: "GET",
          headers: buildServiceHeaders("api-gateway", undefined, this.config.internalServiceToken)
        }
      ),
      fetchServiceJson<{ service: ServiceHealth }>(
        `${serviceUrl("knowledge-service", this.config)}/health`,
        {
          method: "GET",
          headers: buildServiceHeaders("api-gateway", undefined, this.config.internalServiceToken)
        }
      ),
      fetchServiceJson<{ service: ServiceHealth }>(
        `${serviceUrl("communication-service", this.config)}/health`,
        {
          method: "GET",
          headers: buildServiceHeaders("api-gateway", undefined, this.config.internalServiceToken)
        }
      ),
      fetchServiceJson<{ service: ServiceHealth }>(
        `${serviceUrl("billing-service", this.config)}/health`,
        {
          method: "GET",
          headers: buildServiceHeaders("api-gateway", undefined, this.config.internalServiceToken)
        }
      ),
      fetchServiceJson<{ service: ServiceHealth }>(
        `${serviceUrl("browser-service", this.config)}/health`,
        {
          method: "GET",
          headers: buildServiceHeaders("api-gateway", undefined, this.config.internalServiceToken)
        }
      ),
      fetchServiceJson<{ service: ServiceHealth }>(
        `${serviceUrl("terminal-service", this.config)}/health`,
        {
          method: "GET",
          headers: buildServiceHeaders("api-gateway", undefined, this.config.internalServiceToken)
        }
      ),
      fetchServiceJson<{ service: ServiceHealth }>(
        `${serviceUrl("notification-service", this.config)}/health`,
        {
          method: "GET",
          headers: buildServiceHeaders("api-gateway", undefined, this.config.internalServiceToken)
        }
      ),
      fetchServiceJson<{ service: ServiceHealth }>(
        `${serviceUrl("admin-service", this.config)}/health`,
        {
          method: "GET",
          headers: buildServiceHeaders("api-gateway", undefined, this.config.internalServiceToken)
        }
      )
    ]);

    return {
      services: healthChecks
        .flatMap((check) => ("services" in check ? (check.services ?? []) : [check.service]))
        .filter((service): service is ServiceHealth => Boolean(service))
    };
  }

  async summary(authContext?: ServiceAuthContext) {
    const [missions, heartbeats, tools] = await Promise.all([
      this.listMissions(authContext),
      this.listHeartbeats(authContext),
      this.listTools(authContext)
    ]);

    const workspaceId = authContext?.workspaceIds[0];
    const [knowledgeDocuments, communicationMessages, browserSessions, terminalExecutions] = workspaceId
      ? await Promise.all([
          this.listKnowledgeDocuments(workspaceId, authContext),
          this.listCommunicationMessages(workspaceId, authContext),
          this.listBrowserSessions(authContext),
          this.listTerminalExecutions(workspaceId, authContext)
        ])
      : [[], [], [], []];

    return {
      missions: missions.length,
      tools: tools.length,
      heartbeats: heartbeats.length,
      knowledgeDocuments: knowledgeDocuments.length,
      communicationMessages: communicationMessages.length,
      browserSessions: browserSessions.length,
      terminalExecutions: terminalExecutions.length
    };
  }

  logContextReady() {
    this.automation.onHeartbeat(async (heartbeat) => {
      this.logger.info("Heartbeat event received", {
        heartbeatId: heartbeat.id,
        name: heartbeat.name
      });
    });
  }

  async close() {
    await Promise.all([
      this.automation.close(),
      this.browser.close()
    ]);
  }
}

export const buildGatewayServices = () => {
  const services = new GatewayServices();
  services.logContextReady();
  return services;
};
