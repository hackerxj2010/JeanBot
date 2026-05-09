import path from "node:path";
import { describe, expect, it } from "vitest";
import { TerminalService } from "../../services/terminal-service/src/index.js";

describe("TerminalService Security", () => {
  it("prevents prefix-based path traversal (bypass)", () => {
    // biome-ignore lint/suspicious/noExplicitAny: access private methods for testing
    const service = new TerminalService() as any;

    // Mock the roots to simulate the bypass condition
    service.workspaceRoot = () => "/tmp/allowed";

    const bypass = "/tmp/allowed-secret";
    expect(() => service.resolveCwd(bypass)).toThrow(/outside the allowed workspace root/);
  });

  it("allows legitimate paths within the workspace root", () => {
    // biome-ignore lint/suspicious/noExplicitAny: access private methods for testing
    const service = new TerminalService() as any;
    const root = path.resolve("tmp/test-workspace");
    process.env.JEANBOT_ALLOWED_WORKSPACE_ROOT = root;

    const legitimate = path.join(root, "subdir", "file.txt");
    const resolved = service.resolveCwd(legitimate);
    expect(resolved).toBe(legitimate);
  });
});
