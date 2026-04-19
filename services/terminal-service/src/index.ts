import { spawn } from "node:child_process";
import { open, readFile } from "node:fs/promises";
import path from "node:path";

import chokidar, { type FSWatcher } from "chokidar";
import Fastify from "fastify";

import { AuditService } from "@jeanbot/audit-service";
import { LocalJsonStore, ensureDirectory } from "@jeanbot/documents";
import { createLogger } from "@jeanbot/logger";
import {
  assertInternalRequest,
  authContextFromHeaders,
  loadPlatformConfig
} from "@jeanbot/platform";
import { PolicyService } from "@jeanbot/policy-service";
import { redactSecrets } from "@jeanbot/security";
import type {
  ServiceHealth,
  TerminalBackgroundJobRecord,
  TerminalExecutionRecord,
  TerminalRunRequest,
  TerminalWatchRecord,
  ToolDescriptor
} from "@jeanbot/types";

import { runCommand } from "./exec/command-runner.js";

const terminalToolDescriptor: ToolDescriptor = {
  id: "terminal.command.run",
  name: "Terminal runner",
  kind: "terminal",
  description: "Run shell commands with directory and command guardrails.",
  permissions: ["execute"],
  requiresApproval: true
};

export class TerminalService {
  private readonly logger = createLogger("terminal-service");
  private readonly auditService: AuditService;
  private readonly policyService: PolicyService;
  private readonly executionStore: LocalJsonStore<TerminalExecutionRecord>;
  private readonly backgroundStore: LocalJsonStore<TerminalBackgroundJobRecord>;
  private readonly watchStore: LocalJsonStore<TerminalWatchRecord>;
  private readonly watchers = new Map<string, FSWatcher>();
  private resolvedMode: "pty" | "spawn" = "spawn";

  constructor(
    auditService = new AuditService(),
    policyService = new PolicyService()
  ) {
    this.auditService = auditService;
    this.policyService = policyService;

    const runtimeRoot = path.resolve("tmp", "runtime", "terminal");
    this.executionStore = new LocalJsonStore<TerminalExecutionRecord>(
      ensureDirectory(path.join(runtimeRoot, "executions"))
    );
    this.backgroundStore = new LocalJsonStore<TerminalBackgroundJobRecord>(
      ensureDirectory(path.join(runtimeRoot, "background"))
    );
    this.watchStore = new LocalJsonStore<TerminalWatchRecord>(
      ensureDirectory(path.join(runtimeRoot, "watches"))
    );
  }

  private workspaceRoot() {
    return path.resolve(process.env.JEANBOT_ALLOWED_WORKSPACE_ROOT ?? "workspace");
  }

  private terminalRoot(workspaceId: string) {
    return path.resolve("tmp", "runtime", "terminal", "workspaces", workspaceId);
  }

  private async ensureWorkspaceDirectories(workspaceId: string) {
    const root = this.terminalRoot(workspaceId);
    const logRoot = path.join(root, "logs");
    await Promise.all([
      ensureDirectory(root),
      ensureDirectory(logRoot)
    ]);
    return {
      root,
      logRoot
    };
  }

  private normalizeTimeout(timeoutMs?: number | undefined) {
    const parsed = typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
      ? timeoutMs
      : 15_000;
    return Math.max(1_000, Math.min(parsed, 60_000));
  }

  private resolveCwd(cwd: string) {
    const resolved = path.resolve(cwd);
    const allowedRoot = this.workspaceRoot();
    if (!resolved.startsWith(allowedRoot) && !resolved.startsWith(path.resolve("."))) {
      throw new Error(`Terminal cwd "${resolved}" is outside the allowed workspace root.`);
    }

    return resolved;
  }

  private assertSafeCommand(command: string) {
    const blockedPatterns = [
      /\brm\s+-rf\s+\/\b/i,
      /\bshutdown\b/i,
      /\breboot\b/i,
      /\bformat\b/i,
      /\bdel\s+\/f\s+\/s\s+\/q\b/i,
      /\bmkfs\b/i,
      /\bdiskpart\b/i,
      /\|\s*bash\b/i,
      /\|\s*sh\b/i,
      /\bcurl\b.*\s*\|\s*bash\b/i,
      /\bwget\b.*\s*\|\s*bash\b/i,
      /\bcat\b.*\s*\/etc\/(?:passwd|shadow|gshadow|group)\b/i,
      /\bchmod\b.*\s*\/etc\b/i,
      /\bchown\b.*\s*\/etc\b/i
    ];
    const matched = blockedPatterns.find((pattern) => pattern.test(command));
    if (matched) {
      throw new Error(`Blocked terminal command pattern "${matched.source}".`);
    }
  }

  private buildExecutionRecord(
    input: TerminalRunRequest,
    cwd: string,
    approvalRequired: boolean
  ): TerminalExecutionRecord {
    const timestamp = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      command: input.command,
      cwd,
      status: "running",
      mode: this.resolvedMode,
      createdAt: timestamp,
      startedAt: timestamp,
      approvalRequired,
      requestedBy: input.requestedBy,
      outputPreview: ""
    };
  }

  private async logFilesForExecution(workspaceId: string, executionId: string) {
    const { logRoot } = await this.ensureWorkspaceDirectories(workspaceId);
    return {
      stdoutPath: path.join(logRoot, `${executionId}.stdout.log`),
      stderrPath: path.join(logRoot, `${executionId}.stderr.log`)
    };
  }

  private async persistExecution(record: TerminalExecutionRecord) {
    this.executionStore.write(record.id, record);
    return record;
  }

  private async updateExecutionOutput(
    record: TerminalExecutionRecord,
    stdout: string,
    stderr: string
  ) {
    const { stdoutPath, stderrPath } = await this.logFilesForExecution(record.workspaceId, record.id);
    await Promise.all([
      open(stdoutPath, "w").then((handle) => handle.writeFile(stdout, "utf8").finally(() => handle.close())),
      open(stderrPath, "w").then((handle) => handle.writeFile(stderr, "utf8").finally(() => handle.close()))
    ]);

    return {
      ...record,
      stdoutPath,
      stderrPath,
      outputPreview: redactSecrets(
        [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").slice(0, 400)
      )
    };
  }

  private async runViaPty(command: string, cwd: string, timeoutMs: number) {
    try {
      const nodePty = await import("node-pty");
      const isWindows = process.platform === "win32";
      const executable = isWindows ? "powershell.exe" : "bash";
      const args = isWindows ? ["-NoProfile"] : ["-lc"];
      const pty = nodePty.spawn(executable, args, {
        cwd,
        env: process.env as Record<string, string>,
        cols: 120,
        rows: 30
      });

      this.resolvedMode = "pty";
      let stdout = "";
      let settled = false;

      return await new Promise<{ stdout: string; stderr: string; exitCode: number | null }>(
        (resolve, reject) => {
          const timer = setTimeout(() => {
            if (settled) {
              return;
            }

            settled = true;
            pty.kill();
            reject(new Error(`Command timed out after ${timeoutMs}ms.`));
          }, timeoutMs);

          pty.onData((chunk) => {
            stdout += chunk;
          });

          pty.onExit(({ exitCode }) => {
            if (settled) {
              return;
            }

            settled = true;
            clearTimeout(timer);
            resolve({
              stdout,
              stderr: "",
              exitCode
            });
          });

          pty.write(`${command}${isWindows ? "\r" : "\n"}`);
          pty.write(`exit${isWindows ? "\r" : "\n"}`);
        }
      );
    } catch {
      this.resolvedMode = "spawn";
      return runCommand(command, cwd, timeoutMs);
    }
  }

  private async appendAudit(
    kind: string,
    entityId: string,
    actor: string,
    details: Record<string, unknown>
  ) {
    await this.auditService.record(kind, entityId, actor, details);
  }

  async run(input: TerminalRunRequest) {
    this.assertSafeCommand(input.command);
    const safeCwd = this.resolveCwd(input.cwd ?? process.cwd());
    const timeoutMs = this.normalizeTimeout(input.timeoutMs);
    const decision = this.policyService.evaluateTool(terminalToolDescriptor, input.command);
    const actor = input.requestedBy ?? "terminal-service";
    const running = await this.persistExecution(
      this.buildExecutionRecord(input, safeCwd, decision.approvalRequired)
    );

    this.logger.info("Running terminal command", {
      executionId: running.id,
      workspaceId: running.workspaceId,
      cwd: safeCwd,
      timeoutMs,
      approvalRequired: decision.approvalRequired
    });

    try {
      const result =
        process.env.JEANBOT_TERMINAL_MODE === "pty"
          ? await this.runViaPty(input.command, safeCwd, timeoutMs)
          : await runCommand(input.command, safeCwd, timeoutMs);

      const withOutput = await this.updateExecutionOutput(running, result.stdout, result.stderr);
      const finished: TerminalExecutionRecord = {
        ...withOutput,
        mode: this.resolvedMode,
        status: result.exitCode === 0 ? "completed" : "failed",
        finishedAt: new Date().toISOString(),
        exitCode: result.exitCode,
        error: result.exitCode === 0 ? undefined : "Command exited with a non-zero status."
      };

      await Promise.all([
        this.persistExecution(finished),
        this.appendAudit("terminal.command.executed", finished.id, actor, {
          workspaceId: finished.workspaceId,
          command: finished.command,
          cwd: finished.cwd,
          timeoutMs,
          exitCode: finished.exitCode,
          status: finished.status,
          approvalRequired: finished.approvalRequired
        })
      ]);

      return {
        record: finished,
        stdout: result.stdout,
        stderr: result.stderr
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const withOutput = await this.updateExecutionOutput(running, "", message);
      const failed: TerminalExecutionRecord = {
        ...withOutput,
        mode: this.resolvedMode,
        status: message.includes("timed out") ? "timed_out" : "failed",
        finishedAt: new Date().toISOString(),
        exitCode: null,
        error: message
      };

      await Promise.all([
        this.persistExecution(failed),
        this.appendAudit("terminal.command.failed", failed.id, actor, {
          workspaceId: failed.workspaceId,
          command: failed.command,
          cwd: failed.cwd,
          timeoutMs,
          status: failed.status,
          error: failed.error,
          approvalRequired: failed.approvalRequired
        })
      ]);

      return {
        record: failed,
        stdout: "",
        stderr: message
      };
    }
  }

  private shellExecutable() {
    const isWindows = process.platform === "win32";
    return {
      command: isWindows ? "powershell.exe" : "bash",
      args: isWindows ? ["-NoProfile", "-Command"] : ["-lc"]
    };
  }

  async runBackground(input: TerminalRunRequest) {
    this.assertSafeCommand(input.command);
    const safeCwd = this.resolveCwd(input.cwd ?? process.cwd());
    const actor = input.requestedBy ?? "terminal-service";
    const { stdoutPath, stderrPath } = await this.logFilesForExecution(
      input.workspaceId,
      crypto.randomUUID()
    );
    const { command, args } = this.shellExecutable();
    const stdoutHandle = await open(stdoutPath, "w");
    const stderrHandle = await open(stderrPath, "w");
    const child = spawn(command, [...args, input.command], {
      cwd: safeCwd,
      env: process.env,
      detached: true,
      stdio: ["ignore", stdoutHandle.fd, stderrHandle.fd]
    });

    child.unref();

    const record: TerminalBackgroundJobRecord = {
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      command: input.command,
      cwd: safeCwd,
      createdAt: new Date().toISOString(),
      requestedBy: input.requestedBy,
      stdoutPath,
      stderrPath,
      pid: child.pid ?? undefined,
      status: "running"
    };

    this.backgroundStore.write(record.id, record);
    await Promise.all([
      stdoutHandle.close(),
      stderrHandle.close(),
      this.appendAudit("terminal.background.started", record.id, actor, {
        workspaceId: record.workspaceId,
        command: record.command,
        cwd: record.cwd,
        stdoutPath: record.stdoutPath,
        stderrPath: record.stderrPath,
        pid: record.pid
      })
    ]);

    child.on("close", (exitCode) => {
      const next: TerminalBackgroundJobRecord = {
        ...record,
        status: exitCode === 0 ? "completed" : "failed"
      };
      this.backgroundStore.write(record.id, next);
    });

    return record;
  }

  async listExecutions(workspaceId?: string) {
    const executions = this.executionStore
      .list()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return workspaceId
      ? executions.filter((execution) => execution.workspaceId === workspaceId)
      : executions;
  }

  async getExecution(executionId: string) {
    return this.executionStore.read(executionId);
  }

  async readExecutionOutput(executionId: string) {
    const execution = this.executionStore.read(executionId);
    if (!execution) {
      return undefined;
    }

    const [stdout, stderr] = await Promise.all([
      execution.stdoutPath ? readFile(execution.stdoutPath, "utf8").catch(() => "") : "",
      execution.stderrPath ? readFile(execution.stderrPath, "utf8").catch(() => "") : ""
    ]);

    return {
      executionId,
      stdout,
      stderr
    };
  }

  async listBackgroundJobs(workspaceId?: string) {
    const jobs = this.backgroundStore
      .list()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return workspaceId ? jobs.filter((job) => job.workspaceId === workspaceId) : jobs;
  }

  async watchWorkspace(
    workspaceId: string,
    cwd: string,
    requestedBy?: string | undefined
  ) {
    const safeCwd = this.resolveCwd(cwd);
    const existing = this.watchers.get(safeCwd);
    if (existing) {
      return {
        cwd: safeCwd,
        active: true
      };
    }

    const watcher = chokidar.watch(safeCwd, {
      ignoreInitial: true,
      depth: 4
    });
    this.watchers.set(safeCwd, watcher);

    const record: TerminalWatchRecord = {
      id: crypto.randomUUID(),
      workspaceId,
      cwd: safeCwd,
      createdAt: new Date().toISOString(),
      requestedBy
    };

    this.watchStore.write(record.id, record);
    await this.appendAudit("terminal.watch.started", record.id, requestedBy ?? "terminal-service", {
      workspaceId,
      cwd: safeCwd
    });

    return {
      cwd: safeCwd,
      active: true
    };
  }

  async listWatches(workspaceId?: string) {
    const records = this.watchStore
      .list()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return workspaceId ? records.filter((record) => record.workspaceId === workspaceId) : records;
  }

  health(): ServiceHealth {
    return {
      name: "terminal-service",
      ok: true,
      details: {
        mode: this.resolvedMode,
        activeWatchers: this.watchers.size,
        backgroundJobs: this.backgroundStore.list().length
      }
    };
  }
}

export const buildTerminalServiceApp = () => {
  const app = Fastify();
  const service = new TerminalService();
  const config = loadPlatformConfig();

  app.get("/health", async () => ({
    ok: true,
    service: service.health()
  }));

  app.post("/internal/terminal/run", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const authContext = authContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    const body = request.body as TerminalRunRequest;
    return service.run({
      ...body,
      requestedBy: body.requestedBy ?? authContext?.userId
    });
  });

  app.post("/internal/terminal/background", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const authContext = authContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    const body = request.body as TerminalRunRequest;
    return service.runBackground({
      ...body,
      requestedBy: body.requestedBy ?? authContext?.userId
    });
  });

  app.get("/internal/terminal/executions", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const query = (request.query ?? {}) as { workspaceId?: string };
    return service.listExecutions(query.workspaceId);
  });

  app.get("/internal/terminal/executions/:executionId", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { executionId: string };
    return service.getExecution(params.executionId);
  });

  app.get("/internal/terminal/executions/:executionId/output", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { executionId: string };
    return service.readExecutionOutput(params.executionId);
  });

  app.get("/internal/terminal/background", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const query = (request.query ?? {}) as { workspaceId?: string };
    return service.listBackgroundJobs(query.workspaceId);
  });

  app.post("/internal/terminal/watch", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const authContext = authContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    const body = request.body as { workspaceId: string; cwd: string };
    return service.watchWorkspace(body.workspaceId, body.cwd, authContext?.userId);
  });

  app.get("/internal/terminal/watches", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const query = (request.query ?? {}) as { workspaceId?: string };
    return service.listWatches(query.workspaceId);
  });

  return {
    app,
    service
  };
};
