import { describe, expect, it } from "vitest";
import { TerminalService } from "../../services/terminal-service/src/index.js";

describe("TerminalService Security", () => {
  const service = new TerminalService();
  const workspaceId = "security-test-workspace";

  it("blocks dangerous command: rm -rf /", async () => {
    const dangerousCommands = [
      "rm -rf /",
      "rm -rf / ",
      "rm -rf /; ls",
      "rm -rf / && echo hacked"
    ];

    for (const command of dangerousCommands) {
      await expect(service.run({
        workspaceId,
        command,
        cwd: "."
      })).rejects.toThrow(/Blocked terminal command pattern/);
    }
  });

  it("blocks other dangerous commands", async () => {
    const dangerousCommands = [
      "shutdown",
      "reboot",
      "mkfs",
      "format",
      "diskpart",
      "del /f /s /q"
    ];

    for (const command of dangerousCommands) {
      await expect(service.run({
        workspaceId,
        command,
        cwd: "."
      })).rejects.toThrow(/Blocked terminal command pattern/);
    }
  });

  it("allows safe commands", async () => {
    const safeCommands = [
      "ls -la",
      "echo 'hello world'",
      "cat README.md",
      "rm -rf tmp/cache"
    ];

    for (const command of safeCommands) {
      const result = await service.run({
        workspaceId,
        command,
        cwd: "."
      });
      expect(result.record.status).not.toBe("failed");
      expect(result.record.error).toBeUndefined();
    }
  });
});
