import { describe, it, expect } from "vitest";
import { TerminalService } from "../../services/terminal-service/src/index.js";

describe("TerminalService Security", () => {
  const service = new TerminalService();

  it("blocks rm -rf / exactly", async () => {
    await expect(service.run({
      workspaceId: "test",
      command: "rm -rf /",
      requestedBy: "test"
    })).rejects.toThrow(/Blocked terminal command/);
  });

  it("blocks rm -rf / with leading space", async () => {
    await expect(service.run({
      workspaceId: "test",
      command: " rm -rf /",
      requestedBy: "test"
    })).rejects.toThrow(/Blocked terminal command/);
  });

  it("blocks rm -rf / with semicolon", async () => {
    await expect(service.run({
      workspaceId: "test",
      command: "ls; rm -rf /",
      requestedBy: "test"
    })).rejects.toThrow(/Blocked terminal command/);
  });

  it("blocks rm -rf / with pipe", async () => {
    await expect(service.run({
      workspaceId: "test",
      command: "echo | rm -rf /",
      requestedBy: "test"
    })).rejects.toThrow(/Blocked terminal command/);
  });

  it("allows rm -rf /path/to/something", async () => {
    // This might fail if the path doesn't exist or is outside workspace, but it shouldn't be blocked by security regex
    try {
      await service.run({
        workspaceId: "test",
        command: "rm -rf /tmp/jeanbot-test-path",
        requestedBy: "test"
      });
    } catch (e: any) {
      expect(e.message).not.toMatch(/Blocked terminal command/);
    }
  });
});
