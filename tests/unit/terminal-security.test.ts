import { describe, expect, it } from "vitest";
import { TerminalService } from "../../services/terminal-service/src/index.js";
import path from "node:path";

describe("TerminalService Security", () => {
  it("should block 'rm -rf /' correctly", async () => {
    const service = new TerminalService();

    // This should fail but currently passes due to the trailing \b
    await expect(service.run({
      workspaceId: "test",
      command: "rm -rf /",
      cwd: path.resolve(".")
    })).rejects.toThrow(/Blocked terminal command/);
  });

  it("should block 'rm -rf / ' (with space)", async () => {
    const service = new TerminalService();

    await expect(service.run({
      workspaceId: "test",
      command: "rm -rf / ",
      cwd: path.resolve(".")
    })).rejects.toThrow(/Blocked terminal command/);
  });

  it("should redact secrets from output previews", async () => {
    const service = new TerminalService();
    const workspaceId = "test-redaction";
    const secret = "sk-ant-api-key-123";

    const execution = await service.run({
      workspaceId,
      command: `echo ${secret}`,
      cwd: path.resolve("."),
      requestedBy: "terminal-test"
    });

    expect(execution.record.outputPreview).toContain("[REDACTED_ANTHROPIC_KEY]");
    expect(execution.record.outputPreview).not.toContain(secret);
  });
});
