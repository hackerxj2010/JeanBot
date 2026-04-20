import path from "node:path";

import { describe, expect, it } from "vitest";

import { TerminalService } from "../../services/terminal-service/src/index.js";

describe("TerminalService", () => {
  it("records terminal executions, outputs, background jobs, and watches", async () => {
    const service = new TerminalService();
    const workspaceId = `terminal-workspace-${Date.now()}`;
    const cwd = path.resolve(".");

    const execution = await service.run({
      workspaceId,
      command: "echo JeanBot terminal test",
      cwd,
      requestedBy: "terminal-test"
    });
    const normalizedStdout = execution.stdout.toLowerCase().replace(/\s+/g, " ").trim();

    expect(execution.record.status).toBe("completed");
    expect(normalizedStdout).toContain("jeanbot terminal test");

    const output = await service.readExecutionOutput(execution.record.id);
    expect(output?.stdout.toLowerCase().replace(/\s+/g, " ").trim()).toContain(
      "jeanbot terminal test"
    );

    const background = await service.runBackground({
      workspaceId,
      command: "echo JeanBot background job",
      cwd,
      requestedBy: "terminal-test"
    });

    expect(background.workspaceId).toBe(workspaceId);

    const jobs = await service.listBackgroundJobs(workspaceId);
    expect(jobs.some((job) => job.id === background.id)).toBe(true);

    const watch = await service.watchWorkspace(workspaceId, cwd, "terminal-test");
    expect(watch.active).toBe(true);

    const watches = await service.listWatches(workspaceId);
    expect(watches.some((record) => record.cwd === cwd)).toBe(true);
  });

  it("redacts secrets in outputPreview", async () => {
    const service = new TerminalService();
    const workspaceId = `terminal-workspace-${Date.now()}`;
    const cwd = path.resolve(".");

    const execution = await service.run({
      workspaceId,
      command: "echo My secret key is sk-1234567890abcdef",
      cwd,
      requestedBy: "terminal-test"
    });

    expect(execution.record.outputPreview).toContain("[REDACTED_OPENAI_KEY]");
    expect(execution.record.outputPreview).not.toContain("sk-1234567890abcdef");
  });
});
