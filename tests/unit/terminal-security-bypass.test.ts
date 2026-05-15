import path from "node:path";
import { describe, expect, it } from "vitest";
import { TerminalService } from "../../services/terminal-service/src/index.js";

describe("TerminalService Security Bypass", () => {
  it("fails to block 'rm -rf /' due to regex boundary issues", async () => {
    const service = new TerminalService();
    const workspaceId = "test-workspace";

    let error: any;
    try {
      await service.run({
        workspaceId,
        command: "rm -rf /",
        cwd: path.resolve(".")
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect(error.message).toContain("Blocked terminal command pattern");
  });

  it("fails to properly restrict cwd due to startsWith flaw", async () => {
    // Set a very specific root to avoid overlap with /app (which is path.resolve("."))
    process.env.JEANBOT_ALLOWED_WORKSPACE_ROOT = "/tmp/allowed-workspace";
    const service = new TerminalService();

    const allowedRoot = path.resolve("/tmp/allowed-workspace");
    const bypassPath = allowedRoot + "-secret";

    let error: any;
    try {
      (service as any).resolveCwd(bypassPath);
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect(error.message).toContain("is outside the allowed workspace root");
  });
});
