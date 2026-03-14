import { AgentRuntimeService } from "@jeanbot/agent-runtime";
import { AuditService } from "@jeanbot/audit-service";
import { FileService } from "@jeanbot/file-service";
import { createLogger } from "@jeanbot/logger";
import { MemoryService } from "@jeanbot/memory-service";
import { loadPlatformConfig } from "@jeanbot/platform";
import { PolicyService } from "@jeanbot/policy-service";
import { type JobQueueAdapter, LocalJobQueue, RedisJobQueue } from "@jeanbot/queue";
import { SubAgentService } from "@jeanbot/subagent-service";
import { ToolService } from "@jeanbot/tool-service";
import type {
  ApprovalRecord,
  ExecutionContext,
  MissionExecutionState,
  MissionExecutionTelemetry,
  MissionExecutionFailureRecord,
  MissionRecord,
  MissionWorkerEvent,
  MissionStep,
  MissionStatus,
  MissionStateTransition,
  QueueJob,
  ServiceAuthContext,
  ServiceHealth,
  StepExecutionLeaseRecord,
  ToolBatchExecutionInput,
  ToolBatchExecutionResult,
  ToolExecutionInput,
  ToolExecutionResult
} from "@jeanbot/types";
import { validateMissionInput, validateMissionPlan } from "@jeanbot/validators";

import { CheckpointManager } from "./checkpoints/checkpoint-manager.js";
import { MissionDispatcher } from "./dispatcher/mission-dispatcher.js";
import { MissionExecutor, StepExecutionFailure } from "./executor/mission-executor.js";
import { MissionStateStore } from "./mission-state/store.js";
import { MissionPlanner } from "./planner/mission-planner.js";
import { RecoveryEngine } from "./recovery/recovery-engine.js";
import { MissionValidator } from "./validator/mission-validator.js";

interface ExecutionJobPayload {
  missionId: string;
  workspaceRoot: string;
  authContext?: ServiceAuthContext | undefined;
}

interface StepExecutionJobPayload {
  missionId: string;
  stepId: string;
  workspaceRoot: string;
  leaseId?: string | undefined;
  attempt?: number | undefined;
  authContext?: ServiceAuthContext | undefined;
}

const sleep = (milliseconds: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const DISTRIBUTED_STEP_MAX_ATTEMPTS = 3;
const DISTRIBUTED_STEP_QUEUE_TIMEOUT_MS = 15_000;
const DISTRIBUTED_STEP_ACTIVE_TIMEOUT_MS = 120_000;

export class MissionOrchestrator {
  private readonly logger = createLogger("agent-orchestrator");
  private readonly config = loadPlatformConfig();
  private readonly stateStore = new MissionStateStore();
  private readonly jobQueue: JobQueueAdapter;
  readonly fileService: FileService;
  readonly memoryService: MemoryService;
  readonly auditService: AuditService;
  readonly policyService: PolicyService;
  readonly subAgentService: SubAgentService;
  readonly toolService: ToolService;
  readonly runtimeService: AgentRuntimeService;
  private readonly planner = new MissionPlanner();
  private readonly validator = new MissionValidator();
  private readonly recovery = new RecoveryEngine();
  private readonly dispatcher: MissionDispatcher;
  private readonly checkpointManager: CheckpointManager;
  private readonly executor: MissionExecutor;

  constructor() {
    this.fileService = new FileService();
    this.memoryService = new MemoryService();
    this.auditService = new AuditService();
    this.policyService = new PolicyService();
    this.toolService = new ToolService({
      auditService: this.auditService,
      fileService: this.fileService,
      memoryService: this.memoryService,
      policyService: this.policyService
    });
    this.runtimeService = new AgentRuntimeService(
      this.fileService,
      this.memoryService,
      this.toolService,
      this.policyService
    );
    this.subAgentService = new SubAgentService({
      runtimeService: this.runtimeService,
      auditService: this.auditService
    });
    this.dispatcher = new MissionDispatcher(this.subAgentService);
    this.checkpointManager = new CheckpointManager(this.fileService);
    this.executor = new MissionExecutor(
      this.runtimeService,
      this.memoryService,
      this.auditService,
      this.subAgentService,
      this.fileService,
      this.policyService
    );
    this.jobQueue =
      this.config.queueMode === "redis" && this.config.redisUrl
        ? new RedisJobQueue(this.config.redisUrl)
        : new LocalJobQueue();
  }

  private createTransition(
    missionId: string,
    from: MissionStatus,
    to: MissionStatus,
    reason: string,
    actor: string
  ): MissionStateTransition {
    return {
      id: crypto.randomUUID(),
      missionId,
      from,
      to,
      reason,
      actor,
      createdAt: new Date().toISOString()
    };
  }

  private async transitionMission(
    missionId: string,
    to: MissionStatus,
    reason: string,
    actor: string
  ) {
    const record = await this.getMission(missionId);
    const transition = this.createTransition(missionId, record.status, to, reason, actor);
    const updated: MissionRecord = {
      ...record,
      status: to,
      lastUpdatedAt: new Date().toISOString(),
      transitions: [...(record.transitions ?? []), transition]
    };

    await this.stateStore.save(updated);
    await this.stateStore.appendTransition(transition);
    await this.auditService.record("mission.transition", missionId, actor, {
      from: record.status,
      to,
      reason
    });
    return updated;
  }

  private async createApproval(record: MissionRecord, reason: string, requiredActions: string[]) {
    const approval: ApprovalRecord = {
      id: crypto.randomUUID(),
      missionId: record.objective.id,
      tenantId: record.objective.tenantId,
      workspaceId: record.objective.workspaceId,
      status: "pending",
      reason,
      requiredActions,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await this.stateStore.saveApproval(approval);
    return approval;
  }

  private createPlanJob(missionId: string) {
    return {
      id: crypto.randomUUID(),
      kind: "mission.plan",
      missionId,
      payload: { missionId },
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date().toISOString()
    } satisfies QueueJob<{ missionId: string }>;
  }

  private createExecutionJob(
    missionId: string,
    workspaceRoot: string,
    authContext?: ServiceAuthContext
  ) {
    return {
      id: crypto.randomUUID(),
      kind: "mission.execute",
      missionId,
      workspaceId: authContext?.workspaceIds[0],
      tenantId: authContext?.tenantId,
      payload: {
        missionId,
        workspaceRoot,
        authContext
      },
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date().toISOString()
    } satisfies QueueJob<ExecutionJobPayload>;
  }

  private createStepExecutionJob(
    missionId: string,
    stepId: string,
    workspaceRoot: string,
    authContext?: ServiceAuthContext,
    options: {
      attempt?: number | undefined;
      leaseId?: string | undefined;
    } = {}
  ) {
    const attempt = Math.max(1, options.attempt ?? 1);
    const leaseId: string = options.leaseId ?? crypto.randomUUID();

    return {
      id: crypto.randomUUID(),
      kind: "mission.step.execute",
      missionId,
      workspaceId: authContext?.workspaceIds[0],
      tenantId: authContext?.tenantId,
      payload: {
        missionId,
        stepId,
        workspaceRoot,
        leaseId,
        attempt,
        authContext
      },
      attempts: attempt - 1,
      maxAttempts: DISTRIBUTED_STEP_MAX_ATTEMPTS,
      createdAt: new Date().toISOString()
    } satisfies QueueJob<StepExecutionJobPayload>;
  }

  private isReady(record: MissionRecord, stepId: string) {
    const step = record.plan?.steps.find((candidate) => candidate.id === stepId);
    if (!step || step.status === "completed" || step.status === "running" || step.status === "skipped") {
      return false;
    }

    return step.dependsOn.every((dependencyId) => {
      const dependency = record.plan?.steps.find((candidate) => candidate.id === dependencyId);
      return dependency?.status === "completed";
    });
  }

  private promoteReadySteps(record: MissionRecord) {
    for (const step of record.plan?.steps ?? []) {
      if (this.isReady(record, step.id)) {
        step.status = "ready";
      } else if (step.status === "ready") {
        step.status = "pending";
      }
    }
  }

  private selectBatch(record: MissionRecord, maxParallelism: number) {
    if (!record.plan) {
      return [] as MissionStep[];
    }

    const templates = new Map(
      this.subAgentService
        .spawnForPlan(record.plan)
        .map((template) => [template.specialization, template] as const)
    );
    const readySteps = record.plan.steps.filter((step) => step.status === "ready");
    const batch: MissionStep[] = [];
    const perCapability = new Map<string, number>();

    for (const step of readySteps) {
      if (batch.length >= Math.max(1, maxParallelism)) {
        break;
      }

      const template = templates.get(step.capability);
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

  async createMission(input: unknown, authContext?: ServiceAuthContext) {
    const objective = validateMissionInput(input);
    const record: MissionRecord = {
      objective: {
        ...objective,
        tenantId: authContext?.tenantId ?? objective.tenantId
      },
      status: "draft",
      planVersion: 0,
      replanCount: 0,
      transitions: [],
      lastUpdatedAt: new Date().toISOString()
    };

    await this.stateStore.save(record);
    await this.auditService.record("mission.created", objective.id, authContext?.userId ?? objective.userId, {
      title: objective.title,
      tenantId: authContext?.tenantId ?? objective.tenantId
    });

    return record;
  }

  async planMission(missionId: string) {
    await this.transitionMission(
      missionId,
      "queued_for_planning",
      "Mission queued for planning.",
      "agent-orchestrator"
    );

    const job = this.createPlanJob(missionId);
    await this.jobQueue.enqueue(job);

    if (this.config.queueMode === "local") {
      await this.processPlanningJob(job);
    }

    return this.getMission(missionId);
  }

  async processPlanningJob(job: QueueJob<{ missionId: string }>) {
    const record = await this.getMission(job.payload.missionId);
    const policyDecision = this.policyService.evaluateMission(record.objective);
    const nextPlanVersion = (record.planVersion ?? 0) + 1;
    const plan = validateMissionPlan(
      this.planner.createPlan(record.objective, policyDecision)
    );
    plan.version = nextPlanVersion;

    const assigned = this.dispatcher.assign(plan);
    const artifacts = [
      ...(record.artifacts ?? []),
      {
        id: crypto.randomUUID(),
        kind: "plan" as const,
        title: `Mission plan v${nextPlanVersion}`,
        path: `memory://plans/${plan.id}/v${nextPlanVersion}`,
        createdAt: new Date().toISOString(),
        metadata: {
          steps: assigned.plan.steps.length,
          risk: policyDecision.risk
        }
      }
    ];

    let approvals = [...(record.approvals ?? [])];
    let status: MissionStatus = "planned";
    if (policyDecision.approvalRequired) {
      const approval = await this.createApproval(
        record,
        policyDecision.reason,
        policyDecision.blockedActions ?? []
      );
      approvals = [...approvals, approval];
      status = "awaiting_approval";
    }

    const updated: MissionRecord = {
      ...record,
      plan: assigned.plan,
      approvals,
      artifacts,
      status,
      planVersion: nextPlanVersion,
      replanCount: Math.max(0, nextPlanVersion - 1),
      lastUpdatedAt: new Date().toISOString()
    };

    await this.stateStore.save(updated);
    const transition = this.createTransition(
      updated.objective.id,
      "queued_for_planning",
      status,
      status === "awaiting_approval"
        ? "Plan created and approval is required."
        : "Plan created successfully.",
      "agent-orchestrator"
    );
    updated.transitions = [...(updated.transitions ?? []), transition];
    await this.stateStore.save(updated);
    await this.stateStore.appendTransition(transition);
    await this.auditService.record("mission.planned", updated.objective.id, "agent-orchestrator", {
      steps: assigned.plan.steps.length,
      risk: policyDecision.risk,
      approvalRequired: policyDecision.approvalRequired
    });

    return {
      record: updated,
      policyDecision,
      templates: assigned.templates
    };
  }

  async approveMission(missionId: string, approvalId: string, approverId: string) {
    const approval = await this.stateStore.approve(missionId, approvalId, approverId, "approved");
    if (!approval) {
      throw new Error(`Approval "${approvalId}" not found for mission "${missionId}".`);
    }

    const record = await this.getMission(missionId);
    const hasPendingApprovals = (record.approvals ?? []).some(
      (candidate) => candidate.status === "pending"
    );

    if (!hasPendingApprovals && record.status === "awaiting_approval") {
      await this.transitionMission(
        missionId,
        "planned",
        "All required approvals have been granted.",
        approverId
      );
    }

    return this.getMission(missionId);
  }

  private buildExecutionContext(
    record: MissionRecord,
    workspaceRoot: string,
    authContext?: ServiceAuthContext
  ): ExecutionContext {
    return {
      sessionId: crypto.randomUUID(),
      tenantId: record.objective.tenantId,
      authContext,
      workspaceRoot,
      jeanFilePath: `${workspaceRoot}/JEAN.md`,
      planMode: true,
      maxParallelism: 4
    };
  }

  private createActiveExecution(context: ExecutionContext): MissionExecutionState {
    return {
      sessionId: context.sessionId,
      workspaceRoot: context.workspaceRoot,
      executionMode: this.config.queueMode === "redis" ? "distributed" : "local",
      startedAt: new Date().toISOString(),
      outputs: {},
      memoryUpdates: [],
      stepReports: [],
      artifacts: [],
      queuedStepIds: [],
      completedStepIds: [],
      failedSteps: [],
      stepLeases: [],
      workerEvents: []
    };
  }

  private createWorkerEvent(
    missionId: string,
    kind: MissionWorkerEvent["kind"],
    message: string,
    metadata: Record<string, unknown>,
    options: {
      stepId?: string | undefined;
      jobId?: string | undefined;
    } = {}
  ): MissionWorkerEvent {
    return {
      id: crypto.randomUUID(),
      missionId,
      stepId: options.stepId,
      jobId: options.jobId,
      kind,
      message,
      metadata,
      createdAt: new Date().toISOString()
    };
  }

  private createLease(
    missionId: string,
    stepId: string,
    jobId: string,
    attempt = 1,
    leaseId: string = crypto.randomUUID()
  ): StepExecutionLeaseRecord {
    return {
      id: leaseId,
      missionId,
      stepId,
      jobId,
      queueKind: "mission.step.execute",
      status: "queued",
      attempt,
      queuedAt: new Date().toISOString()
    };
  }

  private ensureStepLease(
    activeExecution: MissionExecutionState,
    missionId: string,
    stepId: string,
    options: {
      jobId?: string | undefined;
      attempt?: number | undefined;
      leaseId?: string | undefined;
    } = {}
  ) {
    const existing = activeExecution.stepLeases.find((lease) => lease.stepId === stepId);
    if (existing) {
      return existing;
    }

    const lease = this.createLease(
      missionId,
      stepId,
      options.jobId ?? `synthetic:${stepId}:${crypto.randomUUID()}`,
      Math.max(1, options.attempt ?? 1),
      options.leaseId
    );
    activeExecution.stepLeases = [...activeExecution.stepLeases, lease];
    return lease;
  }

  private async persistDistributedExecutionArtifact(
    record: MissionRecord,
    context: ExecutionContext
  ) {
    const activeExecution = record.activeExecution;
    if (!activeExecution) {
      return undefined;
    }

    const content = [
      `# Distributed Execution Log: ${record.objective.title}`,
      "",
      `Mission ID: ${record.objective.id}`,
      `Session ID: ${activeExecution.sessionId}`,
      `Execution mode: ${activeExecution.executionMode}`,
      `Workspace root: ${activeExecution.workspaceRoot}`,
      "",
      "## Step Leases",
      ...(activeExecution.stepLeases.length > 0
        ? activeExecution.stepLeases.flatMap((lease) => [
            `### ${lease.stepId}`,
            `- Job ID: ${lease.jobId}`,
            `- Status: ${lease.status}`,
            `- Attempt: ${lease.attempt}`,
            `- Worker: ${lease.workerId ?? "unknown"}`,
            `- Queued at: ${lease.queuedAt}`,
            `- Started at: ${lease.startedAt ?? "n/a"}`,
            `- Finished at: ${lease.finishedAt ?? "n/a"}`,
            `- Error: ${lease.error ?? "none"}`,
            ""
          ])
        : ["No step leases recorded.", ""]),
      "## Worker Events",
      ...(activeExecution.workerEvents.length > 0
        ? activeExecution.workerEvents.flatMap((event) => [
            `### ${event.createdAt} :: ${event.kind}`,
            `- Message: ${event.message}`,
            event.stepId ? `- Step ID: ${event.stepId}` : "",
            event.jobId ? `- Job ID: ${event.jobId}` : "",
            `- Metadata: ${JSON.stringify(event.metadata)}`,
            ""
          ])
        : ["No worker events recorded.", ""])
    ]
      .filter(Boolean)
      .join("\n");

    const artifactPath = await this.fileService.writeArtifact(
      context.workspaceRoot,
      record.objective.id,
      "distributed-execution-log.md",
      content
    );

    return {
      id: crypto.randomUUID(),
      kind: "log" as const,
      title: "Distributed execution log",
      path: artifactPath,
      createdAt: new Date().toISOString(),
      metadata: {
        missionId: record.objective.id,
        stepLeases: activeExecution.stepLeases.length,
        workerEvents: activeExecution.workerEvents.length
      }
    };
  }

  private async startDistributedExecution(
    missionId: string,
    context: ExecutionContext
  ) {
    return this.stateStore.patch(missionId, (record) => {
      record.activeExecution = this.createActiveExecution(context);
      record.activeExecution.workerEvents.push(
        this.createWorkerEvent(
          missionId,
          "mission-enqueued",
          "Mission execution entered distributed worker mode.",
          {
            workspaceRoot: context.workspaceRoot,
            sessionId: context.sessionId
          }
        )
      );
      return record;
    });
  }

  private async queueDistributedBatch(
    missionId: string,
    batch: MissionStep[],
    workspaceRoot: string,
    authContext?: ServiceAuthContext
  ) {
    const queuedBatch = batch.map((step) => {
      const job = this.createStepExecutionJob(missionId, step.id, workspaceRoot, authContext);
      const lease = this.createLease(
        missionId,
        step.id,
        job.id,
        job.payload.attempt ?? 1,
        job.payload.leaseId
      );

      return {
        step,
        job,
        lease
      };
    });

    await this.stateStore.patch(missionId, (record) => {
      const activeExecution = record.activeExecution ?? this.createActiveExecution(
        this.buildExecutionContext(record, workspaceRoot, authContext)
      );
      const queued = new Set(activeExecution.queuedStepIds);
      for (const item of queuedBatch) {
        const { step, job, lease } = item;
        const current = record.plan?.steps.find((candidate) => candidate.id === step.id);
        if (current) {
          current.status = "running";
        }
        queued.add(step.id);
        activeExecution.stepLeases = [
          ...activeExecution.stepLeases.filter((lease) => lease.stepId !== step.id),
          lease
        ];
        activeExecution.workerEvents.push(
          this.createWorkerEvent(
            missionId,
            "step-enqueued",
            `Queued distributed execution for step "${step.title}".`,
            {
              stepTitle: step.title,
              capability: step.capability
            },
            {
              stepId: step.id,
              jobId: job.id
            }
          )
        );
      }
      activeExecution.queuedStepIds = [...queued];
      record.activeExecution = activeExecution;
      return record;
    });

    for (const item of queuedBatch) {
      await this.jobQueue.enqueue(item.job);
      if (this.config.queueMode === "local") {
        await this.processStepExecutionJob(item.job);
      }
    }
  }

  private async awaitDistributedBatch(
    missionId: string,
    stepIds: string[],
    workspaceRoot: string,
    authContext?: ServiceAuthContext,
    timeoutMs = 120_000,
    pollIntervalMs = 100
  ) {
    const expected = new Set(stepIds);
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeoutMs) {
      await this.reconcileDistributedBatchLeases(
        missionId,
        stepIds,
        workspaceRoot,
        authContext
      );
      const record = await this.getMission(missionId);
      const activeExecution = record.activeExecution;
      if (!activeExecution) {
        throw new Error(`Mission "${missionId}" lost its active execution state.`);
      }

      const completed = activeExecution.completedStepIds.filter((stepId) => expected.has(stepId));
      const failed = activeExecution.failedSteps.filter((failure) => expected.has(failure.stepId));

      if (completed.length + failed.length === expected.size) {
        return {
          record,
          completed,
          failed
        };
      }

      await sleep(pollIntervalMs);
    }

    throw new Error(
      `Mission "${missionId}" step batch did not complete within ${timeoutMs}ms.`
    );
  }

  private isLeaseStale(lease: StepExecutionLeaseRecord, now: number) {
    const referenceTime =
      lease.status === "active" ? lease.startedAt ?? lease.queuedAt : lease.queuedAt;
    const age = now - new Date(referenceTime).getTime();
    const threshold =
      lease.status === "active"
        ? DISTRIBUTED_STEP_ACTIVE_TIMEOUT_MS
        : DISTRIBUTED_STEP_QUEUE_TIMEOUT_MS;

    return age >= threshold;
  }

  private async reconcileDistributedBatchLeases(
    missionId: string,
    stepIds: string[],
    workspaceRoot: string,
    authContext?: ServiceAuthContext
  ) {
    const requeuedJobs: QueueJob<StepExecutionJobPayload>[] = [];
    let stateChanged = false;

    await this.stateStore.patch(missionId, (record) => {
      const activeExecution = record.activeExecution;
      if (!activeExecution || !record.plan) {
        return record;
      }

      const now = Date.now();
      const nowIso = new Date().toISOString();
      const queued = new Set(activeExecution.queuedStepIds);
      const completed = new Set(activeExecution.completedStepIds);
      const failed = new Set(activeExecution.failedSteps.map((failure) => failure.stepId));

      for (const stepId of stepIds) {
        if (completed.has(stepId) || failed.has(stepId)) {
          continue;
        }

        const step = record.plan.steps.find((candidate) => candidate.id === stepId);
        if (!step) {
          continue;
        }

        const existingLease = activeExecution.stepLeases.find((lease) => lease.stepId === stepId);
        if (!existingLease) {
          const job = this.createStepExecutionJob(missionId, stepId, workspaceRoot, authContext, {
            attempt: 1
          });
          const replacementLease = this.createLease(
            missionId,
            stepId,
            job.id,
            job.payload.attempt ?? 1,
            job.payload.leaseId
          );
          step.status = "running";
          queued.add(stepId);
          activeExecution.stepLeases = [
            ...activeExecution.stepLeases.filter((lease) => lease.stepId !== stepId),
            replacementLease
          ];
          activeExecution.workerEvents.push(
            this.createWorkerEvent(
              missionId,
              "step-requeued",
              `Requeued distributed step "${step.title}" because its lease was missing.`,
              {
                reason: "lease-missing",
                nextAttempt: replacementLease.attempt
              },
              {
                stepId,
                jobId: job.id
              }
            )
          );
          requeuedJobs.push(job);
          stateChanged = true;
          continue;
        }

        if (!this.isLeaseStale(existingLease, now)) {
          continue;
        }

        const timeoutReason =
          existingLease.status === "active" ? "active-timeout" : "queue-timeout";
        if (existingLease.attempt >= DISTRIBUTED_STEP_MAX_ATTEMPTS) {
          const errorMessage = `Distributed step lease expired after ${existingLease.attempt} attempts (${timeoutReason}).`;
          step.status = "failed";
          queued.delete(stepId);
          activeExecution.failedSteps = [
            ...activeExecution.failedSteps.filter((failure) => failure.stepId !== stepId),
            {
              stepId,
              attempts: existingLease.attempt,
              errorMessage,
              createdAt: nowIso
            }
          ];
          activeExecution.stepLeases = activeExecution.stepLeases.map((lease) =>
            lease.stepId === stepId
              ? {
                  ...lease,
                  status: "failed",
                  finishedAt: nowIso,
                  error: errorMessage
                }
              : lease
          );
          activeExecution.workerEvents.push(
            this.createWorkerEvent(
              missionId,
              "step-failed",
              `Distributed step "${step.title}" exhausted lease retries.`,
              {
                reason: timeoutReason,
                attempts: existingLease.attempt
              },
              {
                stepId,
                jobId: existingLease.jobId
              }
            )
          );
          stateChanged = true;
          continue;
        }

        const nextAttempt = existingLease.attempt + 1;
        const job = this.createStepExecutionJob(missionId, stepId, workspaceRoot, authContext, {
          attempt: nextAttempt
        });
        const replacementLease = this.createLease(
          missionId,
          stepId,
          job.id,
          nextAttempt,
          job.payload.leaseId
        );
        step.status = "running";
        queued.add(stepId);
        activeExecution.failedSteps = activeExecution.failedSteps.filter(
          (failure) => failure.stepId !== stepId
        );
        activeExecution.stepLeases = [
          ...activeExecution.stepLeases.filter((lease) => lease.stepId !== stepId),
          replacementLease
        ];
        activeExecution.workerEvents.push(
          this.createWorkerEvent(
            missionId,
            "step-requeued",
            `Requeued distributed step "${step.title}" after stale lease detection.`,
            {
              reason: timeoutReason,
              previousLeaseId: existingLease.id,
              previousStatus: existingLease.status,
              previousAttempt: existingLease.attempt,
              nextAttempt
            },
            {
              stepId,
              jobId: job.id
            }
          )
        );
        requeuedJobs.push(job);
        stateChanged = true;
      }

      activeExecution.queuedStepIds = [...queued];
      record.activeExecution = activeExecution;
      return record;
    });

    for (const job of requeuedJobs) {
      await this.jobQueue.enqueue(job);
      if (this.config.queueMode === "local") {
        await this.processStepExecutionJob(job);
      }
    }

    return stateChanged;
  }

  private async finalizeStepSuccess(
    missionId: string,
    stepId: string,
    context: ExecutionContext,
    workerId: string
  ) {
    await this.stateStore.patch(missionId, (record) => {
      const activeExecution = record.activeExecution ?? this.createActiveExecution(context);
      const queued = new Set(activeExecution.queuedStepIds);
      const completed = new Set(activeExecution.completedStepIds);
      queued.delete(stepId);
      completed.add(stepId);
      activeExecution.queuedStepIds = [...queued];
      activeExecution.completedStepIds = [...completed];
      activeExecution.failedSteps = activeExecution.failedSteps.filter(
        (failure) => failure.stepId !== stepId
      );
      activeExecution.stepLeases = activeExecution.stepLeases.map((lease) =>
        lease.stepId === stepId
          ? {
              ...lease,
              status: "completed",
              workerId,
              finishedAt: new Date().toISOString()
            }
          : lease
      );
      activeExecution.workerEvents.push(
        this.createWorkerEvent(
          missionId,
          "step-completed",
          `Step "${stepId}" completed on a distributed worker.`,
          {},
          {
            stepId,
            jobId: activeExecution.stepLeases.find((lease) => lease.stepId === stepId)?.jobId
          }
        )
      );
      record.activeExecution = activeExecution;
      return record;
    });
  }

  private async finalizeStepFailure(
    missionId: string,
    failure: MissionExecutionFailureRecord,
    context: ExecutionContext,
    workerId: string
  ) {
    await this.stateStore.patch(missionId, (record) => {
      const activeExecution = record.activeExecution ?? this.createActiveExecution(context);
      const queued = new Set(activeExecution.queuedStepIds);
      queued.delete(failure.stepId);
      activeExecution.queuedStepIds = [...queued];
      activeExecution.failedSteps = [
        ...activeExecution.failedSteps.filter((candidate) => candidate.stepId !== failure.stepId),
        failure
      ];

      const step = record.plan?.steps.find((candidate) => candidate.id === failure.stepId);
      if (step) {
        step.status = "failed";
      }

      activeExecution.stepLeases = activeExecution.stepLeases.map((lease) =>
        lease.stepId === failure.stepId
          ? {
              ...lease,
              status: "failed",
              workerId,
              finishedAt: new Date().toISOString(),
              error: failure.errorMessage
            }
          : lease
      );
      activeExecution.workerEvents.push(
        this.createWorkerEvent(
          missionId,
          "step-failed",
          `Step "${failure.stepId}" failed on a distributed worker.`,
          {
            error: failure.errorMessage
          },
          {
            stepId: failure.stepId,
            jobId: activeExecution.stepLeases.find((lease) => lease.stepId === failure.stepId)?.jobId
          }
        )
      );
      record.activeExecution = activeExecution;
      return record;
    });
  }

  private async commitStepOutcome(
    missionId: string,
    stepId: string,
    workspaceRoot: string,
    authContext: ServiceAuthContext | undefined,
    job: {
      id?: string | undefined;
      payload?: Pick<StepExecutionJobPayload, "leaseId" | "attempt"> | undefined;
    } = {}
  ) {
    const record = await this.getMission(missionId);
    const context = this.buildExecutionContext(record, workspaceRoot, authContext);
    const workerId = `worker:${process.pid}`;

    await this.stateStore.patch(missionId, (updatedRecord) => {
      const activeExecution = updatedRecord.activeExecution ?? this.createActiveExecution(context);
      const lease = this.ensureStepLease(activeExecution, missionId, stepId, {
        jobId: job.id,
        attempt: job.payload?.attempt,
        leaseId: job.payload?.leaseId
      });
      activeExecution.stepLeases = activeExecution.stepLeases.map((lease) =>
        lease.stepId === stepId
          ? {
              ...lease,
              status: "active",
              startedAt: new Date().toISOString(),
              workerId
            }
          : lease
      );
      activeExecution.workerEvents.push(
        this.createWorkerEvent(
          missionId,
          "step-started",
          `Distributed worker started step "${stepId}".`,
          {
            workerId
          },
          {
            stepId,
            jobId: lease.jobId
          }
        )
      );
      updatedRecord.activeExecution = activeExecution;
      return updatedRecord;
    });

    try {
      const outcome = await this.executor.executeQueuedStep(record, stepId, context);
      await this.stateStore.patch(missionId, (updatedRecord) => {
        const activeExecution = updatedRecord.activeExecution ?? this.createActiveExecution(context);
        const currentStep = updatedRecord.plan?.steps.find((candidate) => candidate.id === outcome.step.id);
        if (currentStep) {
          currentStep.status = outcome.step.status;
        }
        activeExecution.outputs[outcome.step.id] = {
          assignee: outcome.step.assignee,
          runId: outcome.runId,
          result: outcome.output
        };
        activeExecution.memoryUpdates.push(outcome.memoryText);
        activeExecution.stepReports = [
          ...activeExecution.stepReports.filter((report) => report.stepId !== outcome.step.id),
          outcome.report
        ];
        activeExecution.artifacts = [
          ...activeExecution.artifacts.filter((artifact) => artifact.id !== outcome.artifact.id),
          outcome.artifact
        ];
        updatedRecord.activeExecution = activeExecution;
        return updatedRecord;
      });
      await this.finalizeStepSuccess(missionId, stepId, context, workerId);
    } catch (error) {
      const failure: MissionExecutionFailureRecord = {
        stepId,
        attempts: error instanceof StepExecutionFailure ? error.attempts : 1,
        errorMessage: error instanceof Error ? error.message : String(error),
        diagnostics: error instanceof StepExecutionFailure ? error.diagnostics : undefined,
        createdAt: new Date().toISOString()
      };
      await this.finalizeStepFailure(missionId, failure, context, workerId);
      throw error;
    }
  }

  private async processDistributedExecutionJob(job: QueueJob<ExecutionJobPayload>) {
    const freshRecord = await this.getMission(job.payload.missionId);
    const context = this.buildExecutionContext(
      freshRecord,
      job.payload.workspaceRoot,
      job.payload.authContext
    );

    await this.startDistributedExecution(freshRecord.objective.id, context);

    while (true) {
      const record = await this.getMission(freshRecord.objective.id);
      if (!record.plan) {
        throw new Error(`Mission "${record.objective.id}" has no plan for distributed execution.`);
      }

      this.promoteReadySteps(record);
      await this.stateStore.save(record);

      const incomplete = record.plan.steps.filter(
        (step) => step.status !== "completed" && step.status !== "skipped"
      );
      if (incomplete.length === 0) {
        break;
      }

      const batch = this.selectBatch(record, context.maxParallelism);
      if (batch.length === 0) {
        throw new Error(
          `Mission "${record.objective.id}" cannot make progress in distributed execution because no steps are ready.`
        );
      }

      await this.auditService.record("mission.batch.started", record.objective.id, "agent-orchestrator", {
        batchSize: batch.length,
        stepIds: batch.map((step) => step.id),
        mode: "distributed"
      });

      await this.queueDistributedBatch(
        record.objective.id,
        batch,
        job.payload.workspaceRoot,
        job.payload.authContext
      );

      const settled = await this.awaitDistributedBatch(
        record.objective.id,
        batch.map((step) => step.id),
        job.payload.workspaceRoot,
        job.payload.authContext
      );

      if (settled.failed.length > 0) {
        let replanApplied = false;
        for (const failedStep of settled.failed) {
          const latest = await this.getMission(record.objective.id);
          const step = latest.plan?.steps.find((candidate) => candidate.id === failedStep.stepId);
          if (!step) {
            throw new Error(`Failed step "${failedStep.stepId}" no longer exists in the active plan.`);
          }

          const patched = await this.executor.recoverFailedStep(
            latest,
            new StepExecutionFailure(
              step,
              failedStep.attempts,
              failedStep.errorMessage,
              failedStep.diagnostics
            ),
            context
          );

          if (patched) {
            await this.stateStore.save(latest);
          }

          await this.stateStore.patch(latest.objective.id, (patchedRecord) => {
            const activeExecution =
              patchedRecord.activeExecution ?? this.createActiveExecution(context);
            activeExecution.failedSteps = activeExecution.failedSteps.filter(
              (candidate) => candidate.stepId !== failedStep.stepId
            );
            patchedRecord.activeExecution = activeExecution;
            return patchedRecord;
          });

          if (!patched) {
            throw new Error(failedStep.errorMessage);
          }

          replanApplied = true;
        }

        if (replanApplied) {
          await this.stateStore.patch(record.objective.id, (patchedRecord) => {
            const activeExecution =
              patchedRecord.activeExecution ?? this.createActiveExecution(context);
            activeExecution.workerEvents.push(
              this.createWorkerEvent(
                record.objective.id,
                "batch-replanned",
                "Distributed batch triggered adaptive replanning.",
                {
                  failedSteps: settled.failed.map((failure) => failure.stepId)
                }
              )
            );
            patchedRecord.activeExecution = activeExecution;
            return patchedRecord;
          });
          await this.auditService.record("mission.batch.replanned", record.objective.id, "agent-orchestrator", {
            mode: "distributed",
            failedSteps: settled.failed.map((failure) => failure.stepId)
          });
          continue;
        }
      }

      const latest = await this.getMission(record.objective.id);
      if (!latest.plan) {
        throw new Error(`Mission "${latest.objective.id}" lost its plan during distributed execution.`);
      }
      await this.fileService.updateWorkspaceContext(
        context.workspaceRoot,
        latest.objective.title,
        latest.plan.steps.filter((step) => step.status === "completed").map((step) => step.title),
        latest.plan.steps.filter((step) => step.status === "running").map((step) => step.title),
        latest.plan.steps
          .filter((step) => step.status === "pending" || step.status === "ready")
          .map((step) => step.title)
      );
      await this.auditService.record("mission.batch.completed", latest.objective.id, "agent-orchestrator", {
        completedSteps: settled.completed,
        remainingSteps: latest.plan.steps.filter((step) => step.status !== "completed" && step.status !== "skipped").length,
        mode: "distributed"
      });
    }

    const completedRecord = await this.getMission(freshRecord.objective.id);
    await this.stateStore.patch(completedRecord.objective.id, (record) => {
      const activeExecution = record.activeExecution ?? this.createActiveExecution(context);
      activeExecution.workerEvents.push(
        this.createWorkerEvent(
          record.objective.id,
          "execution-finalized",
          "Distributed execution reached finalization.",
          {
            completedSteps: activeExecution.completedStepIds.length,
            failedSteps: activeExecution.failedSteps.length
          }
        )
      );
      record.activeExecution = activeExecution;
      return record;
    });
    const distributedArtifact = await this.persistDistributedExecutionArtifact(completedRecord, context);
    if (distributedArtifact) {
      await this.stateStore.patch(completedRecord.objective.id, (record) => {
        const activeExecution = record.activeExecution ?? this.createActiveExecution(context);
        activeExecution.artifacts = [...activeExecution.artifacts, distributedArtifact];
        record.activeExecution = activeExecution;
        return record;
      });
    }
    const finalizedRecord = await this.getMission(freshRecord.objective.id);
    const result = await this.executor.finalizeDistributedExecution(finalizedRecord, context);
    this.validator.validate(finalizedRecord, result);
    const updated = await this.stateStore.updateResult(finalizedRecord.objective.id, result);
    updated.activeExecution = undefined;
    updated.artifacts = [...(finalizedRecord.artifacts ?? []), ...(result.artifacts ?? [])];
    await this.stateStore.save(updated);
    await this.memoryService.remember(
      updated.objective.workspaceId,
      `Mission completed: ${updated.objective.title}`,
      ["mission", "completed", "distributed-execution"],
      "long-term",
      1
    );
    await this.transitionMission(
      updated.objective.id,
      "completed",
      "Mission execution finished successfully.",
      "agent-orchestrator"
    );
    return this.getMission(updated.objective.id);
  }

  async runMission(
    missionId: string,
    workspaceRoot: string,
    authContext?: ServiceAuthContext
  ) {
    let record = await this.getMission(missionId);
    if (!record.plan || record.status === "draft" || record.status === "queued_for_planning") {
      await this.planMission(missionId);
      record = await this.getMission(missionId);
    }

    if (record.status === "awaiting_approval") {
      return record;
    }

    await this.transitionMission(
      missionId,
      "queued_for_execution",
      "Mission queued for execution.",
      authContext?.userId ?? "agent-orchestrator"
    );

    const job = this.createExecutionJob(missionId, workspaceRoot, authContext);
    await this.jobQueue.enqueue(job);

    if (this.config.queueMode === "local") {
      await this.processExecutionJob(job);
    }

    return this.getMission(missionId);
  }

  async processExecutionJob(job: QueueJob<ExecutionJobPayload>) {
    const freshRecord = await this.getMission(job.payload.missionId);
    const pendingApprovals = (freshRecord.approvals ?? []).filter(
      (approval) => approval.status === "pending"
    );

    if (pendingApprovals.length > 0) {
      return this.transitionMission(
        freshRecord.objective.id,
        "blocked",
        "Execution is blocked while approvals remain pending.",
        "agent-orchestrator"
      );
    }

    await this.transitionMission(
      freshRecord.objective.id,
      "running",
      "Mission execution started.",
      job.payload.authContext?.userId ?? "agent-orchestrator"
    );

    await this.fileService.ensureWorkspace(job.payload.workspaceRoot);
    await this.checkpointManager.prepare(freshRecord, job.payload.workspaceRoot);
    const context = this.buildExecutionContext(
      freshRecord,
      job.payload.workspaceRoot,
      job.payload.authContext
    );

    try {
      if (this.config.queueMode === "redis") {
        return this.processDistributedExecutionJob(job);
      }

      const result = await this.executor.execute(freshRecord, context);
      this.validator.validate(freshRecord, result);
      const updated = await this.stateStore.updateResult(freshRecord.objective.id, result);
      updated.artifacts = [...(freshRecord.artifacts ?? []), ...(result.artifacts ?? [])];
      await this.stateStore.save(updated);
      await this.memoryService.remember(
        updated.objective.workspaceId,
        `Mission completed: ${updated.objective.title}`,
        ["mission", "completed"],
        "long-term",
        1
      );
      await this.transitionMission(
        updated.objective.id,
        "completed",
        "Mission execution finished successfully.",
        "agent-orchestrator"
      );
      return this.getMission(updated.objective.id);
    } catch (error) {
      this.logger.error("Mission execution failed", {
        missionId: freshRecord.objective.id,
        error: error instanceof Error ? error.message : String(error)
      });
      const recovered = this.recovery.recover(freshRecord, error);
      await this.stateStore.updateResult(freshRecord.objective.id, recovered);
      await this.transitionMission(
        freshRecord.objective.id,
        "failed",
        recovered.verificationSummary,
        "agent-orchestrator"
      );
      return this.getMission(freshRecord.objective.id);
    }
  }

  async processStepExecutionJob(job: QueueJob<StepExecutionJobPayload>) {
    const record = await this.getMission(job.payload.missionId);
    if (record.status !== "running") {
      return record;
    }

    if (record.activeExecution?.completedStepIds.includes(job.payload.stepId)) {
      return record;
    }

    const currentLease = record.activeExecution?.stepLeases.find(
      (lease) => lease.stepId === job.payload.stepId
    );
    if (currentLease && job.payload.leaseId && currentLease.id !== job.payload.leaseId) {
      await this.stateStore.patch(record.objective.id, (updatedRecord) => {
        const context = this.buildExecutionContext(
          updatedRecord,
          job.payload.workspaceRoot,
          job.payload.authContext
        );
        const activeExecution =
          updatedRecord.activeExecution ?? this.createActiveExecution(context);
        activeExecution.workerEvents.push(
          this.createWorkerEvent(
            record.objective.id,
            "step-ignored",
            `Ignored stale distributed step job for "${job.payload.stepId}".`,
            {
              expectedLeaseId: currentLease.id,
              receivedLeaseId: job.payload.leaseId
            },
            {
              stepId: job.payload.stepId,
              jobId: job.id
            }
          )
        );
        updatedRecord.activeExecution = activeExecution;
        return updatedRecord;
      });
      return this.getMission(record.objective.id);
    }

    try {
      await this.commitStepOutcome(
        record.objective.id,
        job.payload.stepId,
        job.payload.workspaceRoot,
        job.payload.authContext,
        {
          id: job.id,
          payload: {
            leaseId: job.payload.leaseId,
            attempt: job.payload.attempt
          }
        }
      );
      return this.getMission(record.objective.id);
    } catch (error) {
      this.logger.error("Distributed step execution failed", {
        missionId: record.objective.id,
        stepId: job.payload.stepId,
        error: error instanceof Error ? error.message : String(error)
      });
      return this.getMission(record.objective.id);
    }
  }

  async getMission(missionId: string) {
    const record = await this.stateStore.get(missionId);
    if (!record) {
      throw new Error(`Mission "${missionId}" not found.`);
    }

    return record;
  }

  async getMissionExecutionTelemetry(missionId: string): Promise<MissionExecutionTelemetry> {
    const record = await this.getMission(missionId);
    const activeExecution = record.activeExecution;
    const planSteps = record.plan?.steps ?? [];
    const stepLeases = [...(activeExecution?.stepLeases ?? [])].sort((left, right) =>
      right.queuedAt.localeCompare(left.queuedAt)
    );
    const workerEvents = [...(activeExecution?.workerEvents ?? [])].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt)
    );
    const stepEventMap = new Map<string, MissionWorkerEvent["kind"]>();
    for (const event of workerEvents) {
      if (event.stepId && !stepEventMap.has(event.stepId)) {
        stepEventMap.set(event.stepId, event.kind);
      }
    }

    const latestArtifacts = [
      ...(record.artifacts ?? []),
      ...(activeExecution?.artifacts ?? []),
      ...(record.result?.artifacts ?? [])
    ]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 12);

    const decisionLog = [...(record.decisionLog ?? []), ...(record.result?.decisionLog ?? [])]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 25);

    return {
      missionId: record.objective.id,
      workspaceId: record.objective.workspaceId,
      status: record.status,
      planVersion: record.planVersion ?? record.plan?.version ?? 1,
      executionMode: activeExecution?.executionMode ?? record.result?.executionMode ?? "local",
      active: Boolean(activeExecution),
      summary: {
        totalSteps: planSteps.length,
        queuedSteps: activeExecution?.queuedStepIds.length ?? 0,
        completedSteps:
          activeExecution?.completedStepIds.length ??
          planSteps.filter((step) => step.status === "completed" || step.status === "skipped").length,
        failedSteps: activeExecution?.failedSteps.length ?? 0,
        artifacts: latestArtifacts.length,
        workerEvents: workerEvents.length,
        outstandingSteps: planSteps
          .filter((step) => step.status !== "completed" && step.status !== "skipped")
          .map((step) => step.id)
      },
      steps: planSteps.map((step) => ({
        id: step.id,
        title: step.title,
        status: step.status,
        capability: step.capability,
        assignee: step.assignee,
        dependsOn: step.dependsOn,
        hasLease: stepLeases.some((lease) => lease.stepId === step.id),
        latestWorkerEventKind: stepEventMap.get(step.id)
      })),
      stepLeases,
      recentWorkerEvents: workerEvents.slice(0, 30),
      failedSteps: activeExecution?.failedSteps ?? [],
      latestArtifacts,
      decisionLog,
      updatedAt: record.lastUpdatedAt
    };
  }

  async listMissions() {
    return this.stateStore.list();
  }

  async waitForMissionStatus(
    missionId: string,
    expected: MissionStatus | MissionStatus[],
    timeoutMs = 30_000,
    pollIntervalMs = 100
  ) {
    const expectedStatuses = new Set(Array.isArray(expected) ? expected : [expected]);
    const terminalFailures = new Set<MissionStatus>(["failed", "cancelled", "blocked"]);
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeoutMs) {
      const record = await this.getMission(missionId);
      if (expectedStatuses.has(record.status)) {
        return record;
      }

      if (terminalFailures.has(record.status) && !expectedStatuses.has(record.status)) {
        throw new Error(
          `Mission "${missionId}" entered terminal status "${record.status}" before reaching "${[
            ...expectedStatuses
          ].join(", ")}".`
        );
      }

      await sleep(pollIntervalMs);
    }

    throw new Error(
      `Mission "${missionId}" did not reach "${[...expectedStatuses].join(", ")}" within ${timeoutMs}ms.`
    );
  }

  listCapabilities() {
    return {
      toolCount: this.toolService.listTools().length,
      memory: true,
      orchestration: true,
      runtime: true,
      policies: true,
      audit: true,
      queueMode: this.config.queueMode,
      persistenceMode: this.config.persistenceMode,
      tools: this.toolService.listTools()
    };
  }

  async workspaceMemory(workspaceId: string) {
    return {
      summary: await this.memoryService.summarizeWorkspace(workspaceId),
      records: await this.memoryService.recall(workspaceId)
    };
  }

  async listAuditEvents(entityId?: string) {
    return this.auditService.list(entityId);
  }

  listTools() {
    return this.toolService.listTools();
  }

  async executeTool(
    input: ToolExecutionInput,
    authContext?: ServiceAuthContext
  ): Promise<ToolExecutionResult> {
    return this.toolService.execute({
      missionId: input.missionId ?? `tool-${crypto.randomUUID()}`,
      toolId: input.toolId,
      action: input.action,
      payload: input.payload,
      authContext
    });
  }

  async executeToolBatch(
    input: ToolBatchExecutionInput,
    authContext?: ServiceAuthContext
  ): Promise<ToolBatchExecutionResult> {
    const missionId = input.missionId ?? `tool-batch-${crypto.randomUUID()}`;
    return this.toolService.executeBatch({
      continueOnError: input.continueOnError,
      requests: input.requests.map((request, index) => ({
        missionId: `${missionId}-${index + 1}`,
        toolId: request.toolId,
        action: request.action,
        payload: request.payload,
        authContext
      }))
    });
  }

  async setMissionStatus(missionId: string, status: MissionStatus) {
    return this.transitionMission(
      missionId,
      status,
      `Mission status manually set to ${status}.`,
      "agent-orchestrator"
    );
  }

  health(): ServiceHealth[] {
    return [
      this.fileService.health(),
      this.memoryService.health(),
      this.auditService.health(),
      this.policyService.health(),
      this.subAgentService.health(),
      this.runtimeService.health(),
      this.toolService.health()
    ];
  }

  async close() {
    await this.jobQueue.close();
  }
}
