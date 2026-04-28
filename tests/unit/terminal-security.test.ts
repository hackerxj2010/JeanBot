import path from "node:path";
import { describe, expect, it } from "vitest";
import { TerminalService } from "../../services/terminal-service/src/index.js";

describe("TerminalService Security", () => {
  it("redacts secrets in output preview", async () => {
    const service = new TerminalService();
    const workspaceId = `terminal-workspace-security-${Date.now()}`;
    const cwd = path.resolve(".");

    // This command simulates outputting a secret
    const secret = "sk-ant-api01-ABC1234567890abcdef1234567890abcdef1234567890ABC1234567890";
    const execution = await service.run({
      workspaceId,
      command: `echo "My key is ${secret}"`,
      cwd,
      requestedBy: "terminal-test"
    });

    expect(execution.record.status).toBe("completed");
    expect(execution.record.outputPreview).not.toContain(secret);
    expect(execution.record.outputPreview).toContain("[REDACTED");
  });
});
