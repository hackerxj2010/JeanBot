import path from "node:path";
import { describe, expect, it } from "vitest";
import { TerminalService } from "../../services/terminal-service/src/index.js";

describe("TerminalService Security", () => {
  it("should block 'rm -rf /' with standard word boundaries", async () => {
    const service = new TerminalService();

    // This should be blocked
    expect(() => (service as any).assertSafeCommand("rm -rf /")).toThrow();
  });

  it("should NOT be bypassed by trailing spaces or characters", async () => {
    const service = new TerminalService();

    // These might bypass /\brm\s+-rf\s+\/\b/i
    expect(() => (service as any).assertSafeCommand("rm -rf / ")).toThrow();
    expect(() => (service as any).assertSafeCommand("rm -rf /; echo bypass")).toThrow();
    expect(() => (service as any).assertSafeCommand("rm -rf /& echo bypass")).toThrow();
  });

  it("should block path prefix bypass in resolveCwd", async () => {
    const service = new TerminalService();
    // Use an allowedRoot that is NOT under the current project root to isolate the prefix check
    const allowedRoot = "/tmp/workspace";
    const secretPath = "/tmp/workspace-secret/data.txt";

    // Manually override the workspaceRoot return value for the test
    (service as any).workspaceRoot = () => allowedRoot;

    // In the old code:
    // "/tmp/workspace-secret/data.txt".startsWith("/tmp/workspace") is TRUE
    // In the new code:
    // path.relative("/tmp/workspace", "/tmp/workspace-secret/data.txt") is "../workspace-secret/data.txt"
    // which starts with "..", so it is NOT under allowedRoot.
    // And it's definitely not under projectRoot (/app).

    expect(() => (service as any).resolveCwd(secretPath)).toThrow();
  });
});
