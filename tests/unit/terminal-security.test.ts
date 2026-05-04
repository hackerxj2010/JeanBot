import { describe, expect, it } from "vitest";
import { TerminalService } from "../../services/terminal-service/src/index.js";
import { redactSecrets } from "../../packages/security/src/index.js";

describe("TerminalService Security", () => {
  it("blocks dangerous commands", async () => {
    const service = new TerminalService();
    const workspaceId = "test-workspace";

    // This should be blocked but currently might not be due to the \b bug
    const dangerousCommands = [
      "rm -rf /",
      "rm -rf / ",
      "shutdown",
      "reboot"
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
    const service = new TerminalService();
    const workspaceId = "test-workspace";

    const safeCommands = [
      "ls -la",
      "echo /",
      "pwd"
    ];

    for (const command of safeCommands) {
      const result = await service.run({
        workspaceId,
        command,
        cwd: "."
      });
      expect(result.record.status).not.toBe("failed");
    }
  });

  it("redacts various secrets including Anthropic keys", () => {
    const input = "Here is an OpenAI key: sk-12345, an Anthropic key: sk-ant-9876, and a Google key: AIza-abc";
    const redacted = redactSecrets(input);

    expect(redacted).toContain("[REDACTED_OPENAI_KEY]");
    expect(redacted).toContain("[REDACTED_ANTHROPIC_KEY]");
    expect(redacted).toContain("[REDACTED_GOOGLE_KEY]");
    expect(redacted).not.toContain("sk-12345");
    expect(redacted).not.toContain("sk-ant-9876");
    expect(redacted).not.toContain("AIza-abc");
  });
});
