import { describe, expect, it } from "vitest";
import { TerminalService } from "../../services/terminal-service/src/index.js";

describe("TerminalService Security", () => {
  it("should block 'rm -rf /'", async () => {
    const service = new TerminalService();
    const workspaceId = "test-workspace";

    await expect(service.run({
      workspaceId,
      command: "rm -rf /",
      cwd: "."
    })).rejects.toThrow(/Blocked terminal command pattern/);
  });

  it("should block 'rm -rf /etc'", async () => {
    const service = new TerminalService();
    const workspaceId = "test-workspace";

    await expect(service.run({
      workspaceId,
      command: "rm -rf /etc",
      cwd: "."
    })).rejects.toThrow(/Blocked terminal command pattern/);
  });
});
