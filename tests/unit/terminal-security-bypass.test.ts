import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TerminalService } from "../../services/terminal-service/src/index.js";

describe("TerminalService Security Bypasses", () => {
  it("should block path prefix bypass in resolveCwd", async () => {
    // Mock process.env for the test
    const originalRoot = process.env.JEANBOT_ALLOWED_WORKSPACE_ROOT;
    process.env.JEANBOT_ALLOWED_WORKSPACE_ROOT = "workspace";
    const service = new TerminalService();

    const allowedRoot = path.resolve("workspace");
    const bypassPath = `${allowedRoot}-secret`;

    // This is expected to FAIL (bypass success) before the fix
    // We test it via the run method which calls resolveCwd
    // We use a command that does nothing to focus on the cwd check

    const runBypass = () => service.run({
        workspaceId: "test",
        command: "ls",
        cwd: bypassPath
    });

    // Before fix, this might NOT throw because of the .startsWith check
    // We want it to throw "Terminal cwd ... is outside the allowed workspace root."
    try {
      await expect(runBypass()).rejects.toThrow(/is outside the allowed workspace root/);
    } finally {
      process.env.JEANBOT_ALLOWED_WORKSPACE_ROOT = originalRoot;
    }
  });

  it("should block rm -rf / bypass in assertSafeCommand", async () => {
    const service = new TerminalService();

    // This is expected to FAIL (bypass success) before the fix
    const runBypass = () => service.run({
        workspaceId: "test",
        command: "rm -rf /",
        cwd: "workspace"
    });

    // Before fix, this might NOT throw because \b doesn't match after /
    // We want it to throw "Blocked terminal command pattern"
    await expect(runBypass()).rejects.toThrow(/Blocked terminal command pattern/);
  });
});
