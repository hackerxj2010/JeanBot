import { MissionOrchestrator } from "../../services/agent-orchestrator/src/index.js";
import { createLogger } from "../../packages/logger/src/index.js";
import { loadPlatformConfig } from "../../packages/platform/src/index.js";
import { RedisJobQueue } from "../../packages/queue/src/index.js";
import type { ServiceAuthContext } from "../../packages/types/src/index.js";

interface ExecutionJobPayload {
  missionId: string;
  workspaceRoot: string;
  authContext?: ServiceAuthContext;
}

interface StepExecutionJobPayload {
  missionId: string;
  stepId: string;
  workspaceRoot: string;
  leaseId?: string | undefined;
  attempt?: number | undefined;
  authContext?: ServiceAuthContext;
}

export interface QueueWorkerHandle {
  started: boolean;
  stop: () => Promise<void>;
}

export const startQueueWorker = async (): Promise<QueueWorkerHandle> => {
  const logger = createLogger("queue-worker");
  const config = loadPlatformConfig();

  if (config.queueMode !== "redis" || !config.redisUrl) {
    logger.warn("Queue worker started without redis queue mode enabled; worker is idle.");
    return {
      started: false,
      stop: async () => undefined
    };
  }

  const orchestrator = new MissionOrchestrator();
  const queue = new RedisJobQueue(config.redisUrl);

  const stopPlanning = await queue.consume<{ missionId: string }>("mission.plan", async (job) => {
    logger.info("Processing planning job", {
      jobId: job.id,
      missionId: job.missionId
    });
    await orchestrator.processPlanningJob(job);
  });

  const stopExecution = await queue.consume<ExecutionJobPayload>("mission.execute", async (job) => {
    logger.info("Processing execution job", {
      jobId: job.id,
      missionId: job.missionId
    });
    await orchestrator.processExecutionJob(job);
  });

  const stopStepExecution = await queue.consume<StepExecutionJobPayload>(
    "mission.step.execute",
    async (job) => {
      logger.info("Processing step execution job", {
        jobId: job.id,
        missionId: job.missionId,
        stepId: job.payload.stepId
      });
      await orchestrator.processStepExecutionJob(job);
    }
  );

  logger.info("Queue worker ready.", {
    queueMode: config.queueMode
  });

  return {
    started: true,
    stop: async () => {
      await stopPlanning();
      await stopExecution();
      await stopStepExecution();
      await queue.close();
      await orchestrator.close();
    }
  };
};
