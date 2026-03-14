import { AutomationService } from "../../services/automation-service/src/index.js";
import { createLogger } from "../../packages/logger/src/index.js";
import { loadPlatformConfig } from "../../packages/platform/src/index.js";
import { RedisJobQueue } from "../../packages/queue/src/index.js";

export interface HeartbeatWorkerHandle {
  started: boolean;
  stop: () => Promise<void>;
}

export const startHeartbeatWorker = async (): Promise<HeartbeatWorkerHandle> => {
  const logger = createLogger("heartbeat-worker");
  const config = loadPlatformConfig();

  if (config.queueMode !== "redis" || !config.redisUrl) {
    logger.warn("Heartbeat worker started without redis queue mode enabled; worker is idle.");
    return {
      started: false,
      stop: async () => undefined
    };
  }

  const automation = new AutomationService();
  const queue = new RedisJobQueue(config.redisUrl);

  const stopTriggerConsumer = await queue.consume<{
    heartbeatId: string;
    executionId: string;
    triggerKind: "manual" | "schedule" | "event";
    requestedBy?: string;
  }>("heartbeat.trigger", async (job) => {
    logger.info("Processing heartbeat job", {
      jobId: job.id,
      heartbeatId: job.payload.heartbeatId,
      executionId: job.payload.executionId
    });
    await automation.processHeartbeatJob(job);
  });

  logger.info("Heartbeat worker ready.", {
    queueMode: config.queueMode
  });

  return {
    started: true,
    stop: async () => {
      await stopTriggerConsumer();
      await queue.close();
      await automation.close();
    }
  };
};
