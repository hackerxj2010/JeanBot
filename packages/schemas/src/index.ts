import { z } from "zod";

import { capabilities, toolKinds } from "@jeanbot/types";

export const riskSchema = z.enum(["low", "medium", "high", "critical"]);
export const capabilitySchema = z.enum(capabilities);
export const toolKindSchema = z.enum(toolKinds);

export const missionRequestSchema = z.object({
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  title: z.string().min(3),
  objective: z.string().min(10),
  context: z.string().default(""),
  constraints: z.array(z.string()).default([]),
  desiredOutcome: z.string().optional(),
  requiredCapabilities: z.array(capabilitySchema).min(1),
  risk: riskSchema.default("medium")
});

export const missionStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  capability: capabilitySchema,
  stage: z
    .enum(["preflight", "analysis", "execution", "verification", "delivery"])
    .optional(),
  toolKind: toolKindSchema.optional(),
  dependsOn: z.array(z.string()),
  verification: z.string(),
  assignee: z.string(),
  status: z.enum(["pending", "ready", "running", "completed", "failed", "skipped"])
});

export const missionPlanSchema = z.object({
  id: z.string(),
  missionId: z.string(),
  version: z.number().int().positive().optional(),
  summary: z.string(),
  steps: z.array(missionStepSchema).min(1),
  estimatedDurationMinutes: z.number().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
  checkpoints: z.array(z.string()),
  alternatives: z.array(z.string()),
  generatedAt: z.string()
});

export const heartbeatSchema = z.object({
  workspaceId: z.string(),
  name: z.string().min(2),
  schedule: z.string().min(2),
  objective: z.string().min(5),
  active: z.boolean().default(true)
});

export const heartbeatUpdateSchema = z.object({
  name: z.string().min(2).optional(),
  schedule: z.string().min(2).optional(),
  objective: z.string().min(5).optional(),
  active: z.boolean().optional()
});

export const semanticSearchSchema = z.object({
  query: z.string().min(2),
  limit: z.number().int().positive().max(20).optional(),
  injectLimit: z.number().int().positive().max(10).optional(),
  tags: z.array(z.string().min(1)).optional(),
  sourceKinds: z.array(z.enum(["memory", "knowledge"])).optional()
});

export const browserStreamDiscoverySchema = z.object({
  workspaceId: z.string().min(1),
  sessionId: z.string().min(1)
});

export const billingUsageQuerySchema = z.object({
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

export const oauthStartSchema = z.object({
  workspaceId: z.string().min(1),
  provider: z.enum(["gmail", "github"]),
  redirectUri: z.string().url()
});

export const oauthCallbackSchema = z.object({
  workspaceId: z.string().min(1),
  provider: z.enum(["gmail", "github"]),
  code: z.string().min(1),
  state: z.string().min(1),
  redirectUri: z.string().url()
});

export const oauthDisconnectSchema = z.object({
  workspaceId: z.string().min(1),
  provider: z.enum(["gmail", "github"])
});

export const runtimeProviderSchema = z.enum([
  "openai",
  "anthropic",
  "github",
  "playwright",
  "ollama"
]);

export const runtimeModeSchema = z.enum(["live", "synthetic"]);

export const runtimeSandboxSchema = z.object({
  workspaceId: z.string().min(1),
  workspaceRoot: z.string().min(1).optional(),
  title: z.string().min(3),
  objective: z.string().min(10),
  context: z.string().optional(),
  constraints: z.array(z.string()).optional(),
  capability: capabilitySchema,
  provider: runtimeProviderSchema.optional(),
  model: z.string().min(1).optional(),
  mode: runtimeModeSchema.optional(),
  toolIds: z.array(z.string().min(1)).optional(),
  additionalInstructions: z.string().optional(),
  maxIterations: z.number().int().positive().max(10).optional()
});
