import { describe, expect, it } from "vitest";
import { TerminalService } from "../../services/terminal-service/src/index.js";

describe("TerminalService Security", () => {
  const service = new TerminalService();
  const workspaceId = "test-workspace";

  it("should block direct 'rm -rf /'", async () => {
    await expect(service.run({
      workspaceId,
      command: "rm -rf /",
      cwd: ".",
      requestedBy: "test"
    })).rejects.toThrow(/Blocked terminal command pattern/);
  });

  it("should block 'rm -rf /' with trailing space", async () => {
    await expect(service.run({
      workspaceId,
      command: "rm -rf / ",
      cwd: ".",
      requestedBy: "test"
    })).rejects.toThrow(/Blocked terminal command pattern/);
  });

  it("should block 'rm -rf /' in multi-command string", async () => {
    await expect(service.run({
      workspaceId,
      command: "echo hello; rm -rf /",
      cwd: ".",
      requestedBy: "test"
    })).rejects.toThrow(/Blocked terminal command pattern/);
  });

  it("should NOT block 'rm -rf /etc'", async () => {
    // This command is still dangerous but not the specific 'rm -rf /' bypass we are testing.
    // The previous flawed regex accidentally blocked this because of word boundaries.
    // We want to ensure we are specifically targeting the root slash.
    const result = await service.run({
      workspaceId,
      command: "echo rm -rf /etc", // Use echo to avoid actually running it if it weren't blocked
      cwd: ".",
      requestedBy: "test"
    });
    expect(result.record.status).toBe("completed");
  });
});
