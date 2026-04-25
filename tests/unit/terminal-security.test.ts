import { describe, expect, it } from "vitest";
import { TerminalService } from "../../services/terminal-service/src/index.js";
import { redactSecrets } from "../../packages/security/src/index.js";

describe("TerminalService Security", () => {
  it("should redact secrets from output preview", async () => {
    const service = new TerminalService();
    const secret = "sk-ant-api01-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-xxxxxxxx";

    // We mock runCommand to simulate a command that outputs a secret
    // Note: TerminalService uses either runViaPty or runCommand from ./exec/command-runner.js
    // For simplicity in unit test, we can try to run a real command if environment allows,
    // or just rely on the fact that updateExecutionOutput is called.

    const result = await service.run({
      workspaceId: "test-ws",
      command: `echo "My key is ${secret}"`,
      cwd: process.cwd(),
      requestedBy: "test-user"
    });

    expect(result.record.outputPreview).not.toContain(secret);
    expect(result.record.outputPreview).toContain("[REDACTED");
  });
});
