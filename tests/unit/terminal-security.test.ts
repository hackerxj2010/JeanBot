import { describe, expect, it } from "vitest";
import { TerminalService } from "../../services/terminal-service/src/index.ts";

describe("TerminalService Security Guardrails", () => {
  const service = new TerminalService();
  const workspaceId = "test-workspace";

  const assertBlocked = async (command: string) => {
    await expect(service.run({
      workspaceId,
      command,
      cwd: "."
    })).rejects.toThrow(/Blocked terminal command pattern/);
  };

  it("should block 'rm -rf /'", async () => {
    await assertBlocked("rm -rf /");
  });

  it("should block 'rm -rf /' with extra spaces", async () => {
    await assertBlocked("rm   -rf   /");
  });

  it("should block 'rm -rf /' as part of a chain", async () => {
    await assertBlocked("echo hello; rm -rf /");
    await assertBlocked("rm -rf / && echo done");
  });

  it("should block 'shutdown'", async () => {
    await assertBlocked("shutdown -h now");
  });

  it("should block 'reboot'", async () => {
    await assertBlocked("reboot");
  });

  it("should block 'mkfs'", async () => {
    await assertBlocked("mkfs /dev/sda1");
  });
});
