import { TRPCError, initTRPC } from "@trpc/server";
import { z } from "zod";

import {
  heartbeatSchema,
  missionRequestSchema,
  oauthCallbackSchema,
  oauthStartSchema,
  runtimeSandboxSchema
} from "@jeanbot/schemas";
import type { ServiceAuthContext } from "@jeanbot/types";

import type { GatewayServices } from "../services/gateway-services.js";

const bootstrapSchema = z.object({
  tenantName: z.string().min(2),
  tenantSlug: z.string().min(2),
  email: z.string().email(),
  displayName: z.string().min(2),
  workspaceName: z.string().min(2),
  workspaceSlug: z.string().min(2),
  apiKeyLabel: z.string().min(2)
});

const runMissionSchema = z.object({
  missionId: z.string(),
  workspaceRoot: z.string().min(1)
});

const approvalSchema = z.object({
  missionId: z.string(),
  approvalId: z.string()
});

const knowledgeDocumentSchema = z.object({
  workspaceId: z.string(),
  title: z.string().min(1),
  body: z.string().min(1),
  metadata: z.record(z.unknown()).optional()
});

const knowledgeQuerySchema = z.object({
  workspaceId: z.string(),
  term: z.string().min(1),
  limit: z.number().int().positive().max(20).optional()
});

const communicationSchema = z.object({
  workspaceId: z.string(),
  channel: z.enum(["email", "slack", "push"]),
  target: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  metadata: z.record(z.unknown()).optional()
});

const billingUpdateSchema = z.object({
  workspaceId: z.string(),
  planId: z.string().min(1),
  stripeCustomerId: z.string().optional()
});

const billingUsageSchema = z.object({
  workspaceId: z.string(),
  metric: z
    .enum([
      "missions",
      "memories",
      "knowledgeDocuments",
      "automations",
      "browserMinutes",
      "terminalSeconds"
    ])
    .optional(),
  limit: z.number().int().positive().max(100).optional()
});

const sessionExchangeSchema = z.object({
  apiKey: z.string().min(1)
});

const sessionRefreshSchema = z.object({
  refreshToken: z.string().min(1)
});

const roleSchema = z.object({
  name: z.string().min(2),
  permissions: z.array(z.string().min(1)).min(1)
});

const workspaceSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2),
  roleIds: z.array(z.string()).optional()
});

const membershipSchema = z.object({
  workspaceId: z.string(),
  userId: z.string(),
  roleIds: z.array(z.string()).min(1)
});

const membershipRoleUpdateSchema = z.object({
  workspaceId: z.string(),
  membershipId: z.string(),
  roleIds: z.array(z.string()).min(1)
});

const browserNavigateSchema = z.object({
  workspaceId: z.string(),
  url: z.string().url(),
  sessionId: z.string().optional()
});

const browserActionSchema = z.object({
  sessionId: z.string(),
  workspaceId: z.string(),
  selector: z.string().optional(),
  value: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional()
});

const browserExtractSchema = z.object({
  sessionId: z.string(),
  workspaceId: z.string(),
  selector: z.string().optional(),
  kind: z.enum(["text", "links", "html"]).optional()
});

const browserCaptureSchema = z.object({
  sessionId: z.string(),
  workspaceId: z.string(),
  fullPage: z.boolean().optional()
});

const terminalRunSchema = z.object({
  workspaceId: z.string(),
  command: z.string().min(1),
  cwd: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().max(60_000).optional()
});

const terminalWatchSchema = z.object({
  workspaceId: z.string(),
  cwd: z.string().min(1)
});

const toolExecutionSchema = z.object({
  missionId: z.string().optional(),
  toolId: z.string().min(1),
  action: z.string().min(1),
  payload: z.record(z.unknown())
});

const toolBatchSchema = z.object({
  missionId: z.string().optional(),
  continueOnError: z.boolean().optional(),
  requests: z.array(
    z.object({
      toolId: z.string().min(1),
      action: z.string().min(1),
      payload: z.record(z.unknown())
    })
  ).min(1)
});

export interface TrpcContext {
  authContext?: ServiceAuthContext;
  correlationId: string;
  services: GatewayServices;
}

const t = initTRPC.context<TrpcContext>().create();

const requirePermission = (permission: string) =>
  t.middleware(({ ctx, next }) => {
    if (!ctx.authContext || !ctx.authContext.permissions.includes(permission)) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: `Missing permission "${permission}".`
      });
    }

    return next();
  });

const protectedProcedure = (permission: string) => t.procedure.use(requirePermission(permission));

const requireAuthContext = (authContext?: ServiceAuthContext) => {
  if (!authContext) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Missing auth context."
    });
  }

  return authContext;
};

export const appRouter = t.router({
  health: t.procedure.query(({ ctx }) => ctx.services.health()),
  summary: t.procedure.query(({ ctx }) => ctx.services.summary(ctx.authContext)),
  bootstrap: t.procedure.input(bootstrapSchema).mutation(({ ctx, input }) => ctx.services.bootstrap(input)),
  exchangeSession: t.procedure
    .input(sessionExchangeSchema)
    .mutation(({ ctx, input }) => ctx.services.exchangeApiKeyForSession(input.apiKey)),
  refreshSession: t.procedure
    .input(sessionRefreshSchema)
    .mutation(({ ctx, input }) => ctx.services.refreshSession(input.refreshToken)),
  createMission: protectedProcedure("missions:write")
    .input(missionRequestSchema)
    .mutation(({ ctx, input }) => ctx.services.createMission(input, ctx.authContext)),
  listMissions: protectedProcedure("missions:read").query(({ ctx }) => ctx.services.listMissions(ctx.authContext)),
  getMission: protectedProcedure("missions:read")
    .input(z.object({ missionId: z.string() }))
    .query(({ ctx, input }) => ctx.services.getMission(input.missionId, ctx.authContext)),
  missionExecution: protectedProcedure("missions:read")
    .input(z.object({ missionId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.services.missionExecutionTelemetry(input.missionId, ctx.authContext)
    ),
  planMission: protectedProcedure("missions:write")
    .input(z.object({ missionId: z.string() }))
    .mutation(({ ctx, input }) => ctx.services.planMission(input.missionId, ctx.authContext)),
  runMission: protectedProcedure("missions:execute")
    .input(runMissionSchema)
    .mutation(({ ctx, input }) =>
      ctx.services.runMission(input.missionId, input.workspaceRoot, ctx.authContext)
    ),
  approveMission: protectedProcedure("missions:approve")
    .input(approvalSchema)
    .mutation(({ ctx, input }) =>
      ctx.services.approveMission(
        input.missionId,
        input.approvalId,
        requireAuthContext(ctx.authContext)
      )
    ),
  tools: protectedProcedure("tools:use").query(({ ctx }) => ctx.services.listTools(ctx.authContext)),
  executeTool: protectedProcedure("tools:use")
    .input(toolExecutionSchema)
    .mutation(({ ctx, input }) => ctx.services.executeTool(input, ctx.authContext)),
  executeToolBatch: protectedProcedure("tools:use")
    .input(toolBatchSchema)
    .mutation(({ ctx, input }) => ctx.services.executeToolBatch(input, ctx.authContext)),
  runtimeProviders: protectedProcedure("tools:use").query(({ ctx }) =>
    ctx.services.runtimeProviderStatus(ctx.authContext)
  ),
  runtimeExecute: protectedProcedure("tools:use")
    .input(runtimeSandboxSchema)
    .mutation(({ ctx, input }) => ctx.services.executeRuntime(input, ctx.authContext)),
  runtimeSessions: protectedProcedure("tools:use")
    .input(z.object({ workspaceId: z.string().optional() }).optional())
    .query(({ ctx, input }) =>
      ctx.services.listRuntimeSessions(input?.workspaceId, ctx.authContext)
    ),
  runtimeSession: protectedProcedure("tools:use")
    .input(z.object({ sessionId: z.string() }))
    .query(({ ctx, input }) => ctx.services.getRuntimeSession(input.sessionId, ctx.authContext)),
  browserNavigate: protectedProcedure("tools:use")
    .input(browserNavigateSchema)
    .mutation(({ ctx, input }) => ctx.services.browserNavigate(input, ctx.authContext)),
  browserClick: protectedProcedure("tools:use")
    .input(browserActionSchema)
    .mutation(({ ctx, input }) => ctx.services.browserClick(input, ctx.authContext)),
  browserFill: protectedProcedure("tools:use")
    .input(browserActionSchema)
    .mutation(({ ctx, input }) => ctx.services.browserFill(input, ctx.authContext)),
  browserExtract: protectedProcedure("tools:use")
    .input(browserExtractSchema)
    .query(({ ctx, input }) => ctx.services.browserExtract(input, ctx.authContext)),
  browserCapture: protectedProcedure("tools:use")
    .input(browserCaptureSchema)
    .mutation(({ ctx, input }) => ctx.services.browserCapture(input, ctx.authContext)),
  browserSessions: protectedProcedure("tools:use").query(({ ctx }) =>
    ctx.services.listBrowserSessions(ctx.authContext)
  ),
  browserSession: protectedProcedure("tools:use")
    .input(z.object({ sessionId: z.string() }))
    .query(({ ctx, input }) => ctx.services.getBrowserSession(input.sessionId, ctx.authContext)),
  browserSessionEvents: protectedProcedure("tools:use")
    .input(z.object({ sessionId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.services.listBrowserSessionEvents(input.sessionId, ctx.authContext)
    ),
  closeBrowserSession: protectedProcedure("tools:use")
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.services.closeBrowserSession(input.sessionId, ctx.authContext)
    ),
  terminalRun: protectedProcedure("tools:use")
    .input(terminalRunSchema)
    .mutation(({ ctx, input }) => ctx.services.terminalRun(input, ctx.authContext)),
  terminalRunBackground: protectedProcedure("tools:use")
    .input(terminalRunSchema)
    .mutation(({ ctx, input }) => ctx.services.terminalRunBackground(input, ctx.authContext)),
  terminalExecutions: protectedProcedure("tools:use")
    .input(z.object({ workspaceId: z.string().optional() }).optional())
    .query(({ ctx, input }) =>
      ctx.services.listTerminalExecutions(input?.workspaceId, ctx.authContext)
    ),
  terminalExecution: protectedProcedure("tools:use")
    .input(z.object({ executionId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.services.getTerminalExecution(input.executionId, ctx.authContext)
    ),
  terminalExecutionOutput: protectedProcedure("tools:use")
    .input(z.object({ executionId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.services.getTerminalExecutionOutput(input.executionId, ctx.authContext)
    ),
  terminalBackgroundJobs: protectedProcedure("tools:use")
    .input(z.object({ workspaceId: z.string().optional() }).optional())
    .query(({ ctx, input }) =>
      ctx.services.listTerminalBackgroundJobs(input?.workspaceId, ctx.authContext)
    ),
  terminalWatch: protectedProcedure("tools:use")
    .input(terminalWatchSchema)
    .mutation(({ ctx, input }) =>
      ctx.services.watchTerminalWorkspace(input, ctx.authContext)
    ),
  terminalWatches: protectedProcedure("tools:use")
    .input(z.object({ workspaceId: z.string().optional() }).optional())
    .query(({ ctx, input }) =>
      ctx.services.listTerminalWatches(input?.workspaceId, ctx.authContext)
    ),
  capabilities: protectedProcedure("missions:read").query(({ ctx }) =>
    ctx.services.listCapabilities(ctx.authContext)
  ),
  workspaceMemory: protectedProcedure("missions:read")
    .input(z.object({ workspaceId: z.string() }))
    .query(({ ctx, input }) => ctx.services.workspaceMemory(input.workspaceId, ctx.authContext)),
  audit: protectedProcedure("audit:read")
    .input(z.object({ entityId: z.string().optional() }).optional())
    .query(({ ctx, input }) => ctx.services.listAuditEvents(input?.entityId, ctx.authContext)),
  createHeartbeat: protectedProcedure("heartbeats:manage")
    .input(heartbeatSchema)
    .mutation(({ ctx, input }) => ctx.services.createHeartbeat(input, ctx.authContext)),
  listHeartbeats: protectedProcedure("heartbeats:manage").query(({ ctx }) =>
    ctx.services.listHeartbeats(ctx.authContext)
  ),
  triggerHeartbeat: protectedProcedure("heartbeats:manage")
    .input(z.object({ heartbeatId: z.string() }))
    .mutation(({ ctx, input }) => ctx.services.triggerHeartbeat(input.heartbeatId, ctx.authContext)),
  heartbeatHistory: protectedProcedure("heartbeats:manage")
    .input(z.object({ heartbeatId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.services.listHeartbeatHistory(input.heartbeatId, ctx.authContext)
    ),
  listKnowledgeDocuments: protectedProcedure("knowledge:read")
    .input(z.object({ workspaceId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.services.listKnowledgeDocuments(input.workspaceId, ctx.authContext)
    ),
  ingestKnowledge: protectedProcedure("knowledge:write")
    .input(knowledgeDocumentSchema)
    .mutation(({ ctx, input }) =>
      ctx.services.ingestKnowledge(
        input.workspaceId,
        {
          title: input.title,
          body: input.body,
          metadata: input.metadata
        },
        ctx.authContext
      )
    ),
  queryKnowledge: protectedProcedure("knowledge:read")
    .input(knowledgeQuerySchema)
    .query(({ ctx, input }) =>
      ctx.services.queryKnowledge(input.workspaceId, input.term, input.limit, ctx.authContext)
    ),
  exportKnowledge: protectedProcedure("knowledge:read")
    .input(z.object({ workspaceId: z.string() }))
    .query(({ ctx, input }) => ctx.services.exportKnowledge(input.workspaceId, ctx.authContext)),
  listCommunicationMessages: protectedProcedure("communication:read")
    .input(z.object({ workspaceId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.services.listCommunicationMessages(input.workspaceId, ctx.authContext)
    ),
  draftCommunicationMessage: protectedProcedure("communication:send")
    .input(communicationSchema)
    .mutation(({ ctx, input }) =>
      ctx.services.draftCommunicationMessage(
        input.workspaceId,
        {
          channel: input.channel,
          target: input.target,
          subject: input.subject,
          body: input.body,
          metadata: input.metadata ?? {}
        },
        ctx.authContext
      )
    ),
  sendCommunicationMessage: protectedProcedure("communication:send")
    .input(communicationSchema)
    .mutation(({ ctx, input }) =>
      ctx.services.sendCommunicationMessage(
        input.workspaceId,
        {
          channel: input.channel,
          target: input.target,
          subject: input.subject,
          body: input.body,
          metadata: input.metadata ?? {}
        },
        ctx.authContext
      )
    ),
  workspaceIntegrations: protectedProcedure("tools:use")
    .input(z.object({ workspaceId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.services.listWorkspaceIntegrations(input.workspaceId, ctx.authContext)
    ),
  startWorkspaceIntegration: protectedProcedure("tools:use")
    .input(oauthStartSchema)
    .mutation(({ ctx, input }) =>
      ctx.services.startWorkspaceIntegration(
        input.workspaceId,
        input.provider,
        {
          redirectUri: input.redirectUri
        },
        ctx.authContext
      )
    ),
  completeWorkspaceIntegration: protectedProcedure("tools:use")
    .input(oauthCallbackSchema)
    .mutation(({ ctx, input }) =>
      ctx.services.completeWorkspaceIntegration(
        input.workspaceId,
        input.provider,
        {
          code: input.code,
          state: input.state,
          redirectUri: input.redirectUri
        },
        ctx.authContext
      )
    ),
  disconnectWorkspaceIntegration: protectedProcedure("tools:use")
    .input(z.object({ workspaceId: z.string(), provider: z.enum(["gmail", "github"]) }))
    .mutation(({ ctx, input }) =>
      ctx.services.disconnectWorkspaceIntegration(
        input.workspaceId,
        input.provider,
        ctx.authContext
      )
    ),
  billingPlans: protectedProcedure("billing:read").query(({ ctx }) =>
    ctx.services.listBillingPlans(ctx.authContext)
  ),
  workspaceBilling: protectedProcedure("billing:read")
    .input(z.object({ workspaceId: z.string() }))
    .query(({ ctx, input }) => ctx.services.workspaceBilling(input.workspaceId, ctx.authContext)),
  workspaceQuota: protectedProcedure("billing:read")
    .input(z.object({ workspaceId: z.string() }))
    .query(({ ctx, input }) => ctx.services.workspaceQuota(input.workspaceId, ctx.authContext)),
  workspaceUsage: protectedProcedure("billing:read")
    .input(billingUsageSchema)
    .query(({ ctx, input }) =>
      ctx.services.workspaceUsage(
        input.workspaceId,
        {
          metric: input.metric,
          limit: input.limit
        },
        ctx.authContext
      )
    ),
  updateWorkspaceBilling: protectedProcedure("billing:read")
    .input(billingUpdateSchema)
    .mutation(({ ctx, input }) =>
      ctx.services.updateWorkspaceBilling(
        input.workspaceId,
        {
          planId: input.planId,
          stripeCustomerId: input.stripeCustomerId
        },
        ctx.authContext
      )
    ),
  createBillingPortal: protectedProcedure("billing:read")
    .input(z.object({ workspaceId: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.services.createBillingPortal(input.workspaceId, ctx.authContext)
    ),
  roles: protectedProcedure("workspaces:manage").query(({ ctx }) =>
    ctx.services.listRoles(requireAuthContext(ctx.authContext))
  ),
  createRole: protectedProcedure("workspaces:manage")
    .input(roleSchema)
    .mutation(({ ctx, input }) =>
      ctx.services.createRole(input, requireAuthContext(ctx.authContext))
    ),
  workspaces: protectedProcedure("missions:read").query(({ ctx }) =>
    ctx.services.listWorkspaces(requireAuthContext(ctx.authContext))
  ),
  createWorkspace: protectedProcedure("workspaces:manage")
    .input(workspaceSchema)
    .mutation(({ ctx, input }) =>
      ctx.services.createWorkspace(input, requireAuthContext(ctx.authContext))
    ),
  workspaceMemberships: protectedProcedure("workspaces:manage")
    .input(z.object({ workspaceId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.services.listWorkspaceMemberships(
        input.workspaceId,
        requireAuthContext(ctx.authContext)
      )
    ),
  addWorkspaceMembership: protectedProcedure("workspaces:manage")
    .input(membershipSchema)
    .mutation(({ ctx, input }) =>
      ctx.services.addWorkspaceMembership(
        input.workspaceId,
        {
          userId: input.userId,
          roleIds: input.roleIds
        },
        requireAuthContext(ctx.authContext)
      )
    ),
  updateWorkspaceMembershipRoles: protectedProcedure("workspaces:manage")
    .input(membershipRoleUpdateSchema)
    .mutation(({ ctx, input }) =>
      ctx.services.updateWorkspaceMembershipRoles(
        input.workspaceId,
        input.membershipId,
        input.roleIds,
        requireAuthContext(ctx.authContext)
      )
    ),
  listApiKeys: protectedProcedure("apikeys:manage").query(({ ctx }) =>
    ctx.services.listApiKeys(requireAuthContext(ctx.authContext))
  )
});

export type AppRouter = typeof appRouter;
