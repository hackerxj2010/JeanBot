import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TerminalService } from "../../services/terminal-service/src/index.js";

describe("TerminalService Security", () => {
  it("blocks dangerous commands like rm -rf /", async () => {
    const service = new TerminalService();
    const workspaceId = "test-security-workspace";

    await expect(service.run({
      workspaceId,
      command: "rm -rf /",
      cwd: path.resolve(".")
    })).rejects.toThrow('Blocked terminal command pattern "\\brm\\s+-rf\\s+\\/".');

    await expect(service.run({
      workspaceId,
      command: "RM -RF /",
      cwd: path.resolve(".")
    })).rejects.toThrow('Blocked terminal command pattern "\\brm\\s+-rf\\s+\\/".');
  });

  it("redacts secrets from output preview", async () => {
    const service = new TerminalService();
    const workspaceId = "test-redaction-workspace";

    // Mock runCommand to return a secret
    vi.mock("../../services/terminal-service/src/exec/command-runner.js", () => ({
      runCommand: vi.fn().mockResolvedValue({
        stdout: "Your OpenAI key is sk-1234567890abcdef1234567890abcdef and your Google key is AIzaTestKey",
        stderr: "",
        exitCode: 0
      })
    }));

    const result = await service.run({
      workspaceId,
      command: "echo secret",
      cwd: path.resolve(".")
    });

    expect(result.record.outputPreview).toContain("[REDACTED_OPENAI_KEY]");
    expect(result.record.outputPreview).toContain("[REDACTED_GOOGLE_KEY]");
    expect(result.record.outputPreview).not.toContain("sk-1234567890abcdef");
    expect(result.record.outputPreview).not.toContain("AIzaTestKey");
  });
});
