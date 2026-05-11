import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TerminalService } from "../../services/terminal-service/src/index.js";

describe("TerminalService Security Bypasses", () => {
  it("should not allow cwd bypass using prefix matching", async () => {
    // Use a path OUTSIDE the project root to avoid matching projectRoot
    const workspaceRoot = path.resolve("/tmp/mock-workspace");
    vi.stubEnv("JEANBOT_ALLOWED_WORKSPACE_ROOT", workspaceRoot);

    const service = new TerminalService();
    // @ts-ignore - accessing private method for testing
    const s = service as { resolveCwd: (cwd: string) => string };

    // This should be allowed
    expect(() => s.resolveCwd(workspaceRoot)).not.toThrow();

    // This should NOT be allowed (would have passed with startsWith)
    const bypassPath = path.resolve("/tmp/mock-workspace-secret");

    expect(() => s.resolveCwd(bypassPath)).toThrow(/is outside the allowed workspace root/);

    vi.unstubAllEnvs();
  });

  it("should block sensitive commands with robust boundary checks", async () => {
      const service = new TerminalService();
      // @ts-ignore - accessing private method for testing
      const s = service as { assertSafeCommand: (cmd: string) => void };

      // Exact command
      expect(() => s.assertSafeCommand("rm -rf /")).toThrow(/Blocked terminal command pattern/);

      // With leading spaces
      expect(() => s.assertSafeCommand("  rm -rf /")).toThrow(/Blocked terminal command pattern/);

      // After a semicolon
      expect(() => s.assertSafeCommand("ls; rm -rf /")).toThrow(/Blocked terminal command pattern/);

      // After an ampersand
      expect(() => s.assertSafeCommand("ls && rm -rf /")).toThrow(/Blocked terminal command pattern/);

      // Should ALLOW non-matching commands that contain the terms as sub-words
      // Note: "format" is blocked, but "informational" should be allowed if the regex is correct
      // Our regex is (?:^|[\s;&|])format(?:[\s;&|]|$)
      expect(() => s.assertSafeCommand("echo informational")).not.toThrow();

      // Should block "shutdown" but allow "shutdown_script" (if not followed by space/separator)
      expect(() => s.assertSafeCommand("shutdown")).toThrow();
      expect(() => s.assertSafeCommand("./shutdown_script")).not.toThrow();
  });
});
