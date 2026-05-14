import path from "node:path";
import { describe, expect, it } from "vitest";
import { TerminalService } from "../../services/terminal-service/src/index.js";

describe("TerminalService Security Bypasses", () => {
  it("fails because it should block command injection/blacklist bypass", async () => {
    const service = new TerminalService();

    const bypassCommands = [
      "rm -rf /",
      "rm -rf / ",
      "rm -rf /;",
      "sudo rm -rf /",
      "echo; rm -rf /"
    ];

    for (const command of bypassCommands) {
      await expect(service.run({
        workspaceId: "test",
        command,
        cwd: path.resolve("workspace"),
        requestedBy: "test"
      })).rejects.toThrow(/Blocked terminal command pattern/);
    }
  });

  it("fails because it should block path traversal/prefix bypass in resolveCwd", async () => {
    // We need to set JEANBOT_ALLOWED_WORKSPACE_ROOT to something outside project root to test prefix bypass
    // without it being caught by the projectRoot check.
    const originalAllowedRoot = process.env.JEANBOT_ALLOWED_WORKSPACE_ROOT;
    process.env.JEANBOT_ALLOWED_WORKSPACE_ROOT = "/tmp/workspace";

    try {
        const service = new TerminalService();
        const bypassCwd = "/tmp/workspace-secret";

        await expect(service.run({
            workspaceId: "test",
            command: "ls",
            cwd: bypassCwd,
            requestedBy: "test"
        })).rejects.toThrow(/is outside the allowed workspace root/);
    } finally {
        process.env.JEANBOT_ALLOWED_WORKSPACE_ROOT = originalAllowedRoot;
    }
  });
});
