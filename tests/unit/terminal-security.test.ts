import { describe, expect, it } from "vitest";
import { TerminalService } from "../../services/terminal-service/src/index.js";

describe("TerminalService Security", () => {
  it("blocks dangerous commands like rm -rf /", async () => {
    const service = new TerminalService();
    const workspaceId = "test-workspace";

    // This should fail because it's a dangerous command
    await expect(service.run({
      workspaceId,
      command: "rm -rf /",
      cwd: ".",
      requestedBy: "test-user"
    })).rejects.toThrow(/Blocked terminal command pattern/);
  });

  it("blocks dangerous commands with trailing spaces", async () => {
    const service = new TerminalService();
    const workspaceId = "test-workspace";

    await expect(service.run({
      workspaceId,
      command: "rm -rf / ",
      cwd: ".",
      requestedBy: "test-user"
    })).rejects.toThrow(/Blocked terminal command pattern/);
  });
});
