export const capabilities = [
  "reasoning",
  "planning",
  "terminal",
  "browser",
  "filesystem",
  "memory",
  "research",
  "subagents",
  "communication",
  "skills",
  "software-development",
  "data-analysis",
  "writing",
  "automation",
  "project-management",
  "heartbeat",
  "security",
  "learning",
  "multimodality",
  "finance",
  "orchestration"
] as const;

export type Capability = (typeof capabilities)[number];

export const toolKinds = [
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
] as const;

export type ToolKind = (typeof toolKinds)[number];
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type MissionStatus =
  | "draft"
  | "queued_for_planning"
  | "planned"
  | "awaiting_approval"
  | "queued_for_execution"
  | "running"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";
export type StepStatus =
  | "pending"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "skipped";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type RepositoryMode = "local" | "postgres";
export type ProviderMode = "live" | "synthetic";
export type ServiceName =
  | "api-gateway"
  | "auth-service"
  | "user-service"
  | "agent-orchestrator"
  | "agent-runtime"
  | "tool-service"
  | "memory-service"
  | "policy-service"
  | "audit-service"
  | "automation-service"
  | "communication-service"
  | "knowledge-service"
  | "billing-service"
  | "browser-service"
  | "terminal-service"
  | "notification-service"
  | "admin-service";
export type QueueJobKind =
  | "mission.plan"
  | "mission.execute"
  | "mission.step.execute"
  | "heartbeat.trigger"
  | "audit.flush"
  | "memory.refresh";

export interface MissionObjective {
  id: string;
  tenantId?: string | undefined;
  workspaceId: string;
  userId: string;
  title: string;
  objective: string;
  context: string;
  constraints: string[];
  desiredOutcome?: string | undefined;
  requiredCapabilities: Capability[];
  risk: RiskLevel;
  createdAt: string;
}

export interface MissionStep {
  id: string;
  title: string;
  description: string;
  capability: Capability;
  stage?: "preflight" | "analysis" | "execution" | "verification" | "delivery" | undefined;
  toolKind?: ToolKind | undefined;
  dependsOn: string[];
  verification: string;
  assignee: string;
  status: StepStatus;
}

export interface MissionPlan {
  id: string;
  missionId: string;
  version?: number | undefined;
  summary: string;
  steps: MissionStep[];
  estimatedDurationMinutes: number;
  estimatedCostUsd: number;
  checkpoints: string[];
  alternatives: string[];
  generatedAt: string;
}

export interface MissionRunResult {
  missionId: string;
  status: MissionStatus;
  executionMode?: "local" | "distributed" | undefined;
  verificationSummary: string;
  outputs: Record<string, unknown>;
  memoryUpdates: string[];
  stepReports?: StepExecutionRecord[] | undefined;
  artifacts?: MissionArtifact[] | undefined;
  metrics?: MissionExecutionMetrics | undefined;
  gaps?: string[] | undefined;
  decisionLog?: MissionDecisionLogEntry[] | undefined;
  startedAt: string;
  finishedAt: string;
}

export interface MissionRecord {
  objective: MissionObjective;
  plan?: MissionPlan | undefined;
  result?: MissionRunResult | undefined;
  activeExecution?: MissionExecutionState | undefined;
  status: MissionStatus;
  artifacts?: MissionArtifact[] | undefined;
  approvals?: ApprovalRecord[] | undefined;
  planVersion?: number | undefined;
  replanCount?: number | undefined;
  decisionLog?: MissionDecisionLogEntry[] | undefined;
  replanHistory?: MissionReplanPatch[] | undefined;
  transitions?: MissionStateTransition[] | undefined;
  lastUpdatedAt: string;
}

export interface ToolDescriptor {
  id: string;
  name: string;
  kind: ToolKind;
  description: string;
  permissions: string[];
  requiresApproval: boolean;
  supportedActions?: string[] | undefined;
  capabilityHints?: Capability[] | undefined;
  tags?: string[] | undefined;
  risk?: RiskLevel | undefined;
}

export interface ToolExecutionRequest {
  missionId: string;
  toolId: string;
  action: string;
  payload: Record<string, unknown>;
  allowedToolIds?: string[] | undefined;
  authContext?: ServiceAuthContext | undefined;
}

export interface ToolExecutionInput {
  missionId?: string | undefined;
  toolId: string;
  action: string;
  payload: Record<string, unknown>;
}

export interface ToolExecutionResult {
  toolId: string;
  action: string;
  ok: boolean;
  payload: unknown;
  message: string;
  descriptor: ToolDescriptor;
  requestedPermissions: string[];
  grantedPermissions: string[];
  approvalRequired: boolean;
  policy: PolicyDecision;
  warnings: string[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export interface ToolBatchExecutionRequest {
  requests: ToolExecutionRequest[];
  continueOnError?: boolean | undefined;
}

export interface ToolBatchExecutionInput {
  missionId?: string | undefined;
  continueOnError?: boolean | undefined;
  requests: Omit<ToolExecutionInput, "missionId">[];
}

export interface ToolBatchExecutionResult {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  succeededCount: number;
  failedCount: number;
  results: ToolExecutionResult[];
}

export interface ExecutionContext {
  sessionId: string;
  tenantId?: string | undefined;
  authContext?: ServiceAuthContext | undefined;
  workspaceRoot: string;
  jeanFilePath: string;
  contextFilePath?: string | undefined;
  artifactRoot?: string | undefined;
  planMode: boolean;
  maxParallelism: number;
}

export type EmbeddingProvider = "openai" | "synthetic";
export type RetrievalSourceKind = "memory" | "knowledge";

export interface EmbeddingVectorRecord {
  values: number[];
  dimensions: number;
  provider: EmbeddingProvider;
  model: string;
  generatedAt: string;
  contentHash: string;
}

export interface MemoryRecord {
  id: string;
  workspaceId: string;
  scope: "session" | "short-term" | "long-term" | "structured";
  text: string;
  tags: string[];
  importance?: number | undefined;
  contentHash: string;
  embedding?: number[] | undefined;
  embeddingModel?: string | undefined;
  embeddingUpdatedAt?: string | undefined;
  createdAt: string;
}

export interface KnowledgeDocumentRecord {
  id: string;
  workspaceId: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  contentHash: string;
  excerpt: string;
  embedding?: number[] | undefined;
  embeddingModel?: string | undefined;
  embeddingUpdatedAt?: string | undefined;
  createdAt: string;
}

export interface RetrievalScoreBreakdown {
  similarity: number;
  recency: number;
  importance: number;
  score: number;
}

export interface SemanticSearchResult {
  id: string;
  workspaceId: string;
  sourceKind: RetrievalSourceKind;
  title?: string | undefined;
  text: string;
  excerpt: string;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  importance: number;
  similarity: number;
  embeddingModel?: string | undefined;
  contentHash: string;
  score: RetrievalScoreBreakdown;
}

export interface SemanticSearchResponse {
  workspaceId: string;
  query: string;
  generatedAt: string;
  results: SemanticSearchResult[];
  injectedResults: SemanticSearchResult[];
}

export interface SubAgentTemplate {
  id: string;
  role: string;
  specialization: Capability;
  instructions: string;
  maxParallelTasks: number;
  timeoutMs?: number | undefined;
  provider?: ProviderExecutionRequest["provider"] | undefined;
  model?: string | undefined;
  toolIds?: string[] | undefined;
  escalationThreshold?: RiskLevel | undefined;
}

export type SubAgentRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "timed_out"
  | "cancelled";

export interface SubAgentToolCallRecord {
  id: string;
  toolId: string;
  action: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  message: string;
  payloadPreview: string;
}

export interface RuntimeIterationRecord {
  index: number;
  provider: string;
  model: string;
  startedAt: string;
  finishedAt: string;
  promptSummary: string;
  responseSummary: string;
  toolCalls: SubAgentToolCallRecord[];
}

export interface RuntimeExecutionRequest {
  objective: MissionObjective;
  step: MissionStep;
  plan: MissionPlan;
  template: SubAgentTemplate;
  context: ExecutionContext;
  authContext?: ServiceAuthContext | undefined;
  providerMode?: ProviderMode | undefined;
  maxIterations?: number | undefined;
  additionalInstructions?: string | undefined;
}

export interface RuntimeExecutionResult {
  finalText: string;
  provider: string;
  model: string;
  mode: ProviderMode;
  promptDigest: string;
  workspaceSummary: string;
  memorySummary: string;
  policyPosture: string;
  toolCalls: SubAgentToolCallRecord[];
  iterations: RuntimeIterationRecord[];
  providerResponses: ProviderExecutionResult[];
  verification: {
    ok: boolean;
    sanitized: string;
    reason: string;
  };
}

export interface RuntimeSandboxRequest {
  workspaceId: string;
  workspaceRoot?: string | undefined;
  title: string;
  objective: string;
  context?: string | undefined;
  constraints?: string[] | undefined;
  capability: Capability;
  provider?: ProviderExecutionRequest["provider"] | undefined;
  model?: string | undefined;
  mode?: ProviderMode | undefined;
  toolIds?: string[] | undefined;
  additionalInstructions?: string | undefined;
  maxIterations?: number | undefined;
}

export interface ProviderStatusRecord {
  provider: ProviderExecutionRequest["provider"];
  configured: boolean;
  liveAvailable: boolean;
  defaultModel: string;
  supportedModels: string[];
  message: string;
}

export interface RuntimeProviderStatus {
  providers: ProviderStatusRecord[];
  liveProviders: ProviderExecutionRequest["provider"][];
  syntheticProviders: ProviderExecutionRequest["provider"][];
}

export interface RuntimeSessionMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface RuntimeModelSelection {
  provider: string;
  model: string;
  reason: string;
}

export interface RuntimeSessionRecord {
  id: string;
  workspaceId: string;
  missionId: string;
  stepId: string;
  capability: Capability;
  createdAt: string;
  updatedAt: string;
  model: RuntimeModelSelection;
  toolIds: string[];
  messages: RuntimeSessionMessage[];
  iterations: RuntimeIterationRecord[];
  providerResponses: ProviderExecutionResult[];
  finalText?: string | undefined;
}

export interface SubAgentExecutionRequest {
  missionId: string;
  objective: MissionObjective;
  plan: MissionPlan;
  step: MissionStep;
  template: SubAgentTemplate;
  context: ExecutionContext;
  authContext?: ServiceAuthContext | undefined;
  attempt?: number | undefined;
}

export interface SubAgentRunRecord {
  id: string;
  missionId: string;
  planId: string;
  stepId: string;
  workspaceId: string;
  capability: Capability;
  templateId: string;
  templateRole: string;
  status: SubAgentRunStatus;
  createdAt: string;
  startedAt?: string | undefined;
  finishedAt?: string | undefined;
  requestedBy?: string | undefined;
  timeoutMs: number;
  attempt: number;
  provider: string;
  model: string;
  toolIds: string[];
  iterationCount: number;
  outputSummary: string;
  error?: string | undefined;
  result?: RuntimeExecutionResult | undefined;
}

export interface SubAgentExecutionResult {
  run: SubAgentRunRecord;
  output: RuntimeExecutionResult;
  memoryText: string;
  stepReport: StepExecutionRecord;
}

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  approvalRequired: boolean;
  risk: RiskLevel;
  ruleHits?: PolicyRuleHit[];
  blockedActions?: string[];
}

export interface HeartbeatDefinition {
  id: string;
  tenantId?: string | undefined;
  workspaceId: string;
  name: string;
  schedule: string;
  objective: string;
  active: boolean;
  lastRunAt?: string | undefined;
  nextRunAt?: string | undefined;
  lastScheduledAt?: string | undefined;
  schedulerStatus?: "idle" | "scheduled" | "paused" | "error" | undefined;
  lastSchedulerError?: string | undefined;
}

export type HeartbeatExecutionStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type HeartbeatTriggerKind = "manual" | "schedule" | "event";

export interface HeartbeatExecutionRecord {
  id: string;
  heartbeatId: string;
  tenantId?: string | undefined;
  workspaceId: string;
  status: HeartbeatExecutionStatus;
  triggerKind: HeartbeatTriggerKind;
  requestedBy?: string | undefined;
  summary: string;
  result: Record<string, unknown>;
  createdAt: string;
  startedAt?: string | undefined;
  finishedAt?: string | undefined;
  error?: string | undefined;
}

export interface AuditEvent {
  id: string;
  kind: string;
  entityId: string;
  actor: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface ServiceHealth {
  name: string;
  ok: boolean;
  details: Record<string, unknown>;
  readiness?: Record<
    string,
    {
      ok: boolean;
      status: "ready" | "degraded" | "unavailable";
      message: string;
      meta?: Record<string, unknown> | undefined;
    }
  >;
  metricsPath?: string | undefined;
}

export interface ModelSelection {
  provider: string;
  model: string;
  reason: string;
}

export interface ResearchCitation {
  title: string;
  url: string;
  snippet: string;
}

export interface PolicyRuleHit {
  id: string;
  severity: RiskLevel;
  message: string;
  matchedText: string;
}

export interface MissionArtifact {
  id: string;
  kind: "report" | "checkpoint" | "log" | "data" | "plan";
  title: string;
  path: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface StepExecutionRecord {
  stepId: string;
  assignee: string;
  status: StepStatus;
  startedAt: string;
  finishedAt: string;
  summary: string;
  verification: string;
  toolId?: string | undefined;
  subAgentRunId?: string | undefined;
  attempts?: number | undefined;
  toolCalls?: number | undefined;
  diagnostics?: StepExecutionDiagnostics | undefined;
}

export interface StepExecutionDiagnostics {
  failureClass: "none" | "tooling" | "verification" | "coverage" | "policy" | "runtime";
  evidenceScore: number;
  coverageScore: number;
  verificationScore: number;
  overallScore: number;
  retryable: boolean;
  escalationRequired: boolean;
  missingSignals: string[];
  strengths: string[];
  recommendedActions: string[];
}

export interface MissionExecutionMetrics {
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  retriedSteps: number;
  replannedSteps: number;
  qualityGateFailures: number;
  escalations: number;
  totalToolCalls: number;
  totalArtifacts: number;
  averageStepScore: number;
  weakestStepId?: string | undefined;
  strongestStepId?: string | undefined;
}

export interface MissionExecutionFailureRecord {
  stepId: string;
  attempts: number;
  errorMessage: string;
  diagnostics?: StepExecutionDiagnostics | undefined;
  createdAt: string;
}

export interface MissionExecutionState {
  sessionId: string;
  workspaceRoot: string;
  executionMode: "local" | "distributed";
  startedAt: string;
  outputs: Record<string, unknown>;
  memoryUpdates: string[];
  stepReports: StepExecutionRecord[];
  artifacts: MissionArtifact[];
  queuedStepIds: string[];
  completedStepIds: string[];
  failedSteps: MissionExecutionFailureRecord[];
  stepLeases: StepExecutionLeaseRecord[];
  workerEvents: MissionWorkerEvent[];
}

export interface MissionExecutionStepTelemetry {
  id: string;
  title: string;
  status: StepStatus;
  capability: Capability;
  assignee: string;
  dependsOn: string[];
  hasLease: boolean;
  latestWorkerEventKind?: MissionWorkerEvent["kind"] | undefined;
}

export interface MissionExecutionTelemetry {
  missionId: string;
  workspaceId: string;
  status: MissionStatus;
  planVersion: number;
  executionMode: "local" | "distributed";
  active: boolean;
  summary: {
    totalSteps: number;
    queuedSteps: number;
    completedSteps: number;
    failedSteps: number;
    artifacts: number;
    workerEvents: number;
    outstandingSteps: string[];
  };
  steps: MissionExecutionStepTelemetry[];
  stepLeases: StepExecutionLeaseRecord[];
  recentWorkerEvents: MissionWorkerEvent[];
  failedSteps: MissionExecutionFailureRecord[];
  latestArtifacts: MissionArtifact[];
  decisionLog: MissionDecisionLogEntry[];
  updatedAt: string;
}

export interface StepExecutionLeaseRecord {
  id: string;
  missionId: string;
  stepId: string;
  jobId: string;
  queueKind: QueueJobKind;
  status: "queued" | "active" | "completed" | "failed";
  attempt: number;
  queuedAt: string;
  startedAt?: string | undefined;
  finishedAt?: string | undefined;
  workerId?: string | undefined;
  error?: string | undefined;
}

export interface MissionWorkerEvent {
  id: string;
  missionId: string;
  stepId?: string | undefined;
  jobId?: string | undefined;
  kind:
    | "mission-enqueued"
    | "step-enqueued"
    | "step-started"
    | "step-requeued"
    | "step-ignored"
    | "step-completed"
    | "step-failed"
    | "batch-replanned"
    | "execution-finalized";
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface MissionDecisionLogEntry {
  id: string;
  missionId: string;
  planVersion: number;
  scope: "mission" | "step" | "plan" | "policy" | "recovery";
  category:
    | "assessment"
    | "retry"
    | "replan"
    | "escalation"
    | "checkpoint"
    | "approval"
    | "completion"
    | "failure";
  severity: "info" | "warning" | "critical";
  stepId?: string | undefined;
  summary: string;
  reasoning: string;
  recommendedActions: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface MissionReplanPatch {
  id: string;
  missionId: string;
  planVersion: number;
  triggeredByStepId: string;
  summary: string;
  reason: string;
  insertedStepIds: string[];
  deferredStepIds: string[];
  createdAt: string;
}

export interface PermissionRecord {
  id: string;
  code: string;
  description: string;
}

export interface RoleRecord {
  id: string;
  tenantId: string;
  name: string;
  permissions: string[];
  system?: boolean | undefined;
  createdAt?: string | undefined;
}

export interface TenantRecord {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface UserRecord {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export interface WorkspaceRecord {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface WorkspaceMembership {
  id: string;
  tenantId: string;
  workspaceId: string;
  userId: string;
  roleIds: string[];
  createdAt: string;
}

export interface ApiKeyRecord {
  id: string;
  tenantId: string;
  userId: string;
  workspaceIds: string[];
  label: string;
  hashedKey: string;
  preview: string;
  active: boolean;
  createdAt: string;
  lastUsedAt?: string | undefined;
}

export interface AuthSessionRecord {
  id: string;
  tenantId: string;
  userId: string;
  workspaceIds: string[];
  roleIds: string[];
  permissions: string[];
  subjectType: "user" | "service";
  accessTokenHash: string;
  refreshTokenHash: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  createdAt: string;
  lastUsedAt?: string | undefined;
  revokedAt?: string | undefined;
}

export interface ApprovalRecord {
  id: string;
  missionId: string;
  tenantId?: string | undefined;
  workspaceId: string;
  status: ApprovalStatus;
  reason: string;
  requiredActions: string[];
  createdAt: string;
  updatedAt: string;
  approvedBy?: string | undefined;
}

export interface MissionStateTransition {
  id: string;
  missionId: string;
  from: MissionStatus;
  to: MissionStatus;
  reason: string;
  actor: string;
  createdAt: string;
}

export interface ServiceAuthContext {
  tenantId: string;
  userId: string;
  workspaceIds: string[];
  roleIds: string[];
  permissions: string[];
  apiKeyId?: string | undefined;
  subjectType: "user" | "service";
}

export interface QueueJob<TPayload = Record<string, unknown>> {
  id: string;
  kind: QueueJobKind;
  tenantId?: string | undefined;
  workspaceId?: string | undefined;
  missionId?: string | undefined;
  payload: TPayload;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
}

export interface ProviderExecutionRequest {
  provider: "openai" | "anthropic" | "github" | "playwright" | "ollama";
  model?: string | undefined;
  mode?: ProviderMode | undefined;
  prompt?: string | undefined;
  input?: Record<string, unknown> | undefined;
}

export interface ProviderExecutionResult {
  provider: ProviderExecutionRequest["provider"];
  mode: ProviderMode;
  ok: boolean;
  output: Record<string, unknown>;
  message: string;
}

export interface CommunicationMessageRecord {
  id: string;
  workspaceId: string;
  tenantId?: string | undefined;
  channel: "email" | "slack" | "push";
  target: string;
  subject: string;
  body: string;
  status: "draft" | "queued" | "sent" | "failed";
  mode: ProviderMode;
  metadata: Record<string, unknown>;
  createdAt: string;
  sentAt?: string | undefined;
  error?: string | undefined;
}

export interface BillingPlanRecord {
  id: string;
  name: string;
  monthlyUsd: number;
  missionRuns: number;
  memoryRecords: number;
  knowledgeDocuments: number;
  activeAutomations: number;
  browserLiveMinutes: number;
  terminalExecutionSeconds: number;
  features: string[];
}

export type BillingQuotaResource =
  | "missions"
  | "memories"
  | "knowledgeDocuments"
  | "automations"
  | "browserMinutes"
  | "terminalSeconds";

export type StripeSyncStatus = "pending" | "synced" | "failed" | "skipped";

export interface UsageEventRecord {
  id: string;
  workspaceId: string;
  tenantId?: string | undefined;
  metric: BillingQuotaResource;
  quantity: number;
  sourceService: ServiceName | string;
  sourceEntityId: string;
  timestamp: string;
  stripeSyncStatus: StripeSyncStatus;
  stripeError?: string | undefined;
  billable: boolean;
  meteredAt: string;
  metadata: Record<string, unknown>;
}

export interface WorkspaceBillingSubscriptionRecord {
  workspaceId: string;
  tenantId?: string | undefined;
  planId: string;
  stripeCustomerId?: string | undefined;
  stripeSubscriptionId?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceQuotaOverrideRecord {
  workspaceId: string;
  tenantId?: string | undefined;
  limits: Partial<Record<BillingQuotaResource, number>>;
  reason?: string | undefined;
  updatedBy?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceBillingSnapshot {
  workspaceId: string;
  tenantId?: string | undefined;
  planId: string;
  mode: ProviderMode;
  customerId?: string | undefined;
  subscriptionId?: string | undefined;
  portalUrl: string;
  usage: {
    missions: number;
    memories: number;
    knowledgeDocuments: number;
    automations: number;
    browserMinutes: number;
    terminalSeconds: number;
  };
  limits: {
    missions: number;
    memories: number;
    knowledgeDocuments: number;
    automations: number;
    browserMinutes: number;
    terminalSeconds: number;
  };
  recentUsageEvents: UsageEventRecord[];
  quotaOverride?: WorkspaceQuotaOverrideRecord | undefined;
  stripeSync: {
    pending: number;
    synced: number;
    failed: number;
    skipped: number;
  };
  updatedAt: string;
}

export interface WorkspaceQuotaStatus {
  workspaceId: string;
  tenantId?: string | undefined;
  planId: string;
  usage: WorkspaceBillingSnapshot["usage"];
  limits: WorkspaceBillingSnapshot["limits"];
  remaining: WorkspaceBillingSnapshot["limits"];
  exceeded: BillingQuotaResource[];
  nearLimit: BillingQuotaResource[];
  overrideApplied: boolean;
  updatedAt: string;
}

export type NotificationChannel = "email" | "push";
export type NotificationStatus = "queued" | "sent" | "failed" | "skipped";
export type NotificationEventType =
  | "mission.completed"
  | "mission.failed"
  | "heartbeat.completed"
  | "heartbeat.failed";

export interface NotificationRecord {
  id: string;
  tenantId?: string | undefined;
  workspaceId: string;
  userId: string;
  channel: NotificationChannel;
  eventType: NotificationEventType;
  target: string;
  subject: string;
  body: string;
  status: NotificationStatus;
  mode: ProviderMode;
  metadata: Record<string, unknown>;
  createdAt: string;
  sentAt?: string | undefined;
  error?: string | undefined;
}

export interface TaskNotificationRequest {
  workspaceId: string;
  userId: string;
  eventType: NotificationEventType;
  subject: string;
  body: string;
  metadata?: Record<string, unknown> | undefined;
  channels?: NotificationChannel[] | undefined;
}

export interface AdminTenantSummary {
  tenant: TenantRecord;
  userCount: number;
  workspaceCount: number;
  apiKeyCount: number;
  createdAt: string;
}

export type BrowserSessionMode = "live" | "synthetic";
export type BrowserActionKind =
  | "navigate"
  | "click"
  | "fill"
  | "extract"
  | "capture"
  | "close";

export interface BrowserSessionSummary {
  id: string;
  workspaceId: string;
  tenantId?: string | undefined;
  currentUrl: string;
  title: string;
  mode: BrowserSessionMode;
  createdAt: string;
  lastActiveAt: string;
  requestedBy?: string | undefined;
  captureCount: number;
  lastFrameAt?: string | undefined;
  frameSequence: number;
  poolMode: "warm-pool" | "synthetic";
}

export interface BrowserEventRecord {
  id: string;
  sessionId: string;
  workspaceId: string;
  kind: BrowserActionKind;
  createdAt: string;
  actor: string;
  status: "ok" | "failed";
  detail: Record<string, unknown>;
}

export interface BrowserCaptureRecord {
  id: string;
  sessionId: string;
  workspaceId: string;
  path: string;
  url: string;
  mode: BrowserSessionMode;
  createdAt: string;
  bytes?: number | undefined;
}

export interface BrowserStreamInfo {
  sessionId: string;
  workspaceId: string;
  mode: BrowserSessionMode;
  poolMode: BrowserSessionSummary["poolMode"];
  token: string;
  streamUrl: string;
  frameRate: number;
  frameSequence: number;
  lastFrameAt?: string | undefined;
}

export interface BrowserStreamEvent {
  type: "connected" | "frame" | "session-closed" | "error";
  sessionId: string;
  workspaceId: string;
  createdAt: string;
  sequence: number;
  mimeType?: string | undefined;
  data?: string | undefined;
  detail?: Record<string, unknown> | undefined;
}

export interface BrowserNavigateRequest {
  workspaceId: string;
  url: string;
  sessionId?: string | undefined;
  requestedBy?: string | undefined;
}

export interface BrowserActionRequest {
  sessionId: string;
  workspaceId: string;
  selector?: string | undefined;
  value?: string | undefined;
  x?: number | undefined;
  y?: number | undefined;
  requestedBy?: string | undefined;
}

export interface BrowserExtractRequest {
  sessionId: string;
  workspaceId: string;
  selector?: string | undefined;
  kind?: "text" | "links" | "html" | undefined;
  requestedBy?: string | undefined;
}

export interface BrowserCaptureRequest {
  sessionId: string;
  workspaceId: string;
  fullPage?: boolean | undefined;
  requestedBy?: string | undefined;
}

export interface TerminalExecutionRecord {
  id: string;
  workspaceId: string;
  tenantId?: string | undefined;
  command: string;
  cwd: string;
  status: "running" | "completed" | "failed" | "timed_out";
  mode: "pty" | "spawn";
  createdAt: string;
  startedAt: string;
  finishedAt?: string | undefined;
  exitCode?: number | null | undefined;
  approvalRequired: boolean;
  requestedBy?: string | undefined;
  stdoutPath?: string | undefined;
  stderrPath?: string | undefined;
  outputPreview: string;
  error?: string | undefined;
}

export interface TerminalRunRequest {
  workspaceId: string;
  command: string;
  cwd?: string | undefined;
  timeoutMs?: number | undefined;
  requestedBy?: string | undefined;
}

export interface TerminalBackgroundJobRecord {
  id: string;
  workspaceId: string;
  tenantId?: string | undefined;
  command: string;
  cwd: string;
  createdAt: string;
  requestedBy?: string | undefined;
  stdoutPath: string;
  stderrPath: string;
  pid?: number | undefined;
  status: "running" | "completed" | "failed";
}

export interface TerminalWatchRecord {
  id: string;
  workspaceId: string;
  cwd: string;
  createdAt: string;
  requestedBy?: string | undefined;
}

export type IntegrationProvider = "gmail" | "github";

export interface ConnectedIntegrationRecord {
  id: string;
  tenantId?: string | undefined;
  workspaceId: string;
  provider: IntegrationProvider;
  status: "pending" | "connected" | "expired" | "error" | "disconnected";
  scopes: string[];
  providerAccountId?: string | undefined;
  encryptedAccessToken?: string | undefined;
  encryptedRefreshToken?: string | undefined;
  accessTokenExpiresAt?: string | undefined;
  lastError?: string | undefined;
  metadata: Record<string, unknown>;
  connectedAt: string;
  updatedAt: string;
}

export interface OAuthStartRequest {
  workspaceId: string;
  provider: IntegrationProvider;
  redirectUri: string;
}

export interface OAuthStartResponse {
  provider: IntegrationProvider;
  authorizationUrl: string;
  state: string;
}

export interface OAuthCallbackRequest {
  workspaceId: string;
  provider: IntegrationProvider;
  code: string;
  state: string;
  redirectUri: string;
}
