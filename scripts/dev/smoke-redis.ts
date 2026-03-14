import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import { AutomationService } from "../../services/automation-service/src/index.js";
import { MissionOrchestrator } from "../../services/agent-orchestrator/src/index.js";

process.env.JEANBOT_MODEL_PROVIDER = "";
process.env.OLLAMA_API_KEY = "";

const workspaceRoot = path.resolve("tmp", "sessions", `redis-smoke-${Date.now()}`);
const redisContainerName = `jeanbot-redis-smoke-${Date.now()}`;
const redisPort = Number(process.env.JEANBOT_REDIS_SMOKE_PORT ?? 6389);
const dockerCommand = process.platform === "win32" ? "docker.exe" : "docker";
const nodeCommand = process.execPath;
const tsxCli = path.resolve("node_modules", "tsx", "dist", "cli.cjs");
const configuredRedisUrl = process.env.REDIS_URL;
let redisUrl = configuredRedisUrl ?? `redis://127.0.0.1:${redisPort}`;
let startedDockerRedis = false;
let teardownMode = false;
let smokeCompleted = false;

const runCommand = (command: string, args: string[], cwd: string) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed (${code}): ${stderr}`));
    });
  });

const waitForPort = (port: number, timeoutMs: number) =>
  new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();

    const attempt = () => {
      const socket = net.createConnection({
        host: "127.0.0.1",
        port
      });

      socket.once("connect", () => {
        socket.end();
        resolve();
      });

      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Port ${port} did not become available within ${timeoutMs}ms.`));
          return;
        }

        setTimeout(attempt, 150);
      });
    };

    attempt();
  });

const isPortReachable = (port: number, timeoutMs: number) =>
  new Promise<boolean>((resolve) => {
    const socket = net.createConnection({
      host: "127.0.0.1",
      port
    });

    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);

    socket.once("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });

    socket.once("error", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });

const waitForWorkerReady = (
  child: ReturnType<typeof spawn>,
  readyText: string,
  label: string,
  timeoutMs: number
) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} did not become ready in time.`));
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      if (text.includes(readyText)) {
        clearTimeout(timer);
        resolve();
      }
    });

    child.stderr?.on("data", (chunk) => {
      process.stderr.write(chunk.toString());
    });

    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`${label} exited before ready with code ${code ?? -1}.`));
    });
  });

const waitForCondition = async (
  label: string,
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 250
) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`${label} did not reach the expected state within ${timeoutMs}ms.`);
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string) =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    })
  ]);

const isRedisTeardownError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }

  return /(ECONNRESET|ECONNREFUSED|MaxRetriesPerRequest)/.test(error.message);
};

const terminateChild = (child: ReturnType<typeof spawn> | undefined, label: string, timeoutMs: number) =>
  new Promise<void>((resolve) => {
    if (!child || child.exitCode !== null) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      if (process.platform === "win32" && child.pid) {
        void runCommand("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], process.cwd()).catch(
          () => {
            child.kill("SIGKILL");
          }
        );
        return;
      }

      child.kill("SIGKILL");
    }, timeoutMs);

    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });

    child.kill("SIGTERM");
  });

process.on("uncaughtException", (error) => {
  if (teardownMode && isRedisTeardownError(error)) {
    process.stderr.write(`[smoke:redis] Ignored teardown error: ${error.message}\n`);
    return;
  }

  throw error;
});

process.on("unhandledRejection", (reason) => {
  if (teardownMode && isRedisTeardownError(reason)) {
    const message = reason instanceof Error ? reason.message : String(reason);
    process.stderr.write(`[smoke:redis] Ignored teardown rejection: ${message}\n`);
    return;
  }

  throw reason instanceof Error ? reason : new Error(String(reason));
});

const cleanupRedis = async () => {
  if (!startedDockerRedis) {
    return;
  }

  try {
    await runCommand(dockerCommand, ["rm", "-f", redisContainerName], process.cwd());
  } catch {
    // Ignore cleanup failures so the smoke result reflects the real run status.
  }
};

const dockerAvailable = async () => {
  try {
    await runCommand(dockerCommand, ["info"], process.cwd());
    return true;
  } catch {
    return false;
  }
};

process.env.JEANBOT_QUEUE_MODE = "redis";
process.env.JEANBOT_PERSISTENCE_MODE = "local";
process.env.REDIS_URL = redisUrl;

await rm(workspaceRoot, { recursive: true, force: true });
await mkdir(workspaceRoot, { recursive: true });

let workerProcess: ReturnType<typeof spawn> | undefined;
let heartbeatWorkerProcess: ReturnType<typeof spawn> | undefined;
let embeddedRedisProcess: ReturnType<typeof spawn> | undefined;
let orchestrator: MissionOrchestrator | undefined;
let automation: AutomationService | undefined;

try {
  const configuredEndpoint = configuredRedisUrl ? new URL(configuredRedisUrl) : undefined;
  const configuredPort = Number(configuredEndpoint?.port || 6379);
  const configuredReachable =
    configuredEndpoint?.hostname === "127.0.0.1" || configuredEndpoint?.hostname === "localhost"
      ? await isPortReachable(configuredPort, 1_000)
      : Boolean(configuredRedisUrl);

  if (!configuredRedisUrl || !configuredReachable) {
    if (await dockerAvailable()) {
      redisUrl = `redis://127.0.0.1:${redisPort}`;
      process.env.REDIS_URL = redisUrl;
      startedDockerRedis = true;
      await runCommand(
        dockerCommand,
        ["run", "-d", "--rm", "--name", redisContainerName, "-p", `${redisPort}:6379`, "redis:7"],
        process.cwd()
      );
    } else {
      const redisProcessEnv = Object.fromEntries(
        Object.entries({
          ...process.env,
          REDISMS_PORT: String(redisPort)
        }).filter((entry): entry is [string, string] => typeof entry[1] === "string")
      );
      embeddedRedisProcess = spawn(nodeCommand, [tsxCli, "scripts/dev/embedded-redis.ts"], {
        cwd: process.cwd(),
        env: redisProcessEnv,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"]
      });
      embeddedRedisProcess.stdout?.on("data", (chunk) => {
        process.stdout.write(chunk.toString());
      });
      embeddedRedisProcess.stderr?.on("data", (chunk) => {
        process.stderr.write(chunk.toString());
      });
      redisUrl = `redis://127.0.0.1:${redisPort}`;
      process.env.REDIS_URL = redisUrl;
    }
  }

  const redisEndpoint = new URL(redisUrl);
  await waitForPort(Number(redisEndpoint.port || 6379), 20_000);
  const childEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );

  workerProcess = spawn(nodeCommand, [tsxCli, "workers/queue-worker/index.ts"], {
    cwd: process.cwd(),
    env: childEnv,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });

  heartbeatWorkerProcess = spawn(
    nodeCommand,
    [tsxCli, "workers/heartbeat-worker/index.ts"],
    {
      cwd: process.cwd(),
      env: childEnv,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  await Promise.all([
    waitForWorkerReady(workerProcess, "Queue worker ready.", "Queue worker", 20_000),
    waitForWorkerReady(
      heartbeatWorkerProcess,
      "Heartbeat worker ready.",
      "Heartbeat worker",
      20_000
    )
  ]);

  orchestrator = new MissionOrchestrator();
  const mission = await orchestrator.createMission({
    workspaceId: `redis-workspace-${Date.now()}`,
    userId: "redis-smoke-user",
    title: "Redis queue smoke test",
    objective: "Verify queue-backed planning and execution with a separate BullMQ worker.",
    context: "Distributed smoke verification",
    constraints: ["Use Redis-backed queue workers"],
    requiredCapabilities: [
      "planning",
      "filesystem",
      "memory",
      "software-development",
      "orchestration"
    ],
    risk: "low"
  });

  const queuedPlan = await orchestrator.planMission(mission.objective.id);
  const planned = await orchestrator.waitForMissionStatus(
    mission.objective.id,
    ["planned", "awaiting_approval"],
    30_000
  );

  if (planned.status === "awaiting_approval") {
    const approval = planned.approvals?.find((candidate) => candidate.status === "pending");
    if (!approval) {
      throw new Error("Expected a pending approval before execution.");
    }

    await orchestrator.approveMission(mission.objective.id, approval.id, mission.objective.userId);
    await orchestrator.waitForMissionStatus(mission.objective.id, "planned", 10_000);
  }

  const queuedExecution = await orchestrator.runMission(mission.objective.id, workspaceRoot);
  const completed = await orchestrator.waitForMissionStatus(
    mission.objective.id,
    "completed",
    45_000
  );

  automation = new AutomationService();
  const automationService = automation;
  const heartbeat = await automationService.createHeartbeat({
    tenantId: "redis-tenant",
    workspaceId: mission.objective.workspaceId,
    name: "Redis heartbeat smoke",
    schedule: "0 * * * *",
    objective: "Verify heartbeat.trigger jobs are processed by the dedicated worker.",
    active: true
  });

  await automationService.triggerHeartbeat(heartbeat.id, {
    requestedBy: "redis-smoke-user",
    triggerKind: "manual"
  });

  await waitForCondition(
    "Heartbeat execution",
    async () => {
      const history = await automationService.listHeartbeatHistory(heartbeat.id);
      return history.some((record) => record.status === "completed");
    },
    30_000
  );

  const heartbeatHistory = await automationService.listHeartbeatHistory(heartbeat.id);

  console.log(
    JSON.stringify(
      {
        missionId: mission.objective.id,
        queuedPlanStatus: queuedPlan.status,
        plannedStatus: planned.status,
        queuedExecutionStatus: queuedExecution.status,
        finalStatus: completed.status,
        executionMode: completed.result?.executionMode ?? "unknown",
        stepReports: completed.result?.stepReports?.length ?? 0,
        transitions: completed.transitions?.length ?? 0,
        artifactCount: completed.artifacts?.length ?? 0,
        distributedLogArtifact:
          completed.artifacts?.some((artifact) => artifact.title === "Distributed execution log") ?? false,
        decisionLogEntries: completed.result?.decisionLog?.length ?? 0,
        heartbeatExecutions: heartbeatHistory.length,
        heartbeatStatus: heartbeatHistory[0]?.status ?? "missing"
      },
      null,
      2
    )
  );
  smokeCompleted = true;
} finally {
  teardownMode = true;
  await Promise.allSettled([
    withTimeout(orchestrator?.close() ?? Promise.resolve(), 5_000, "Mission orchestrator shutdown").catch(
      (error) => {
        if (!smokeCompleted) {
          throw error;
        }
      }
    ),
    withTimeout(automation?.close() ?? Promise.resolve(), 5_000, "Automation service shutdown").catch(
      (error) => {
        if (!smokeCompleted) {
          throw error;
        }
      }
    )
  ]);
  await Promise.allSettled([
    terminateChild(workerProcess, "queue-worker", 10_000),
    terminateChild(heartbeatWorkerProcess, "heartbeat-worker", 10_000)
  ]);
  await terminateChild(embeddedRedisProcess, "embedded-redis", 10_000);
  await cleanupRedis();

  if (smokeCompleted) {
    process.exit(0);
  }
}
