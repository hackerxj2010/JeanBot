import path from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import { TerminalService } from "../../services/terminal-service/src/index.js";

describe("TerminalService Security", () => {
  let service: TerminalService;

  beforeEach(() => {
    // Reset env for each test to ensure predictable workspace roots
    process.env.JEANBOT_ALLOWED_WORKSPACE_ROOT = "/tmp/jeanbot-allowed";
    service = new TerminalService();
  });

  describe("Command Guardrails (assertSafeCommand)", () => {
    it("should block 'rm -rf /' when exactly matched", async () => {
      await expect(service.run({
        workspaceId: "test",
        command: "rm -rf /",
        cwd: path.resolve(".")
      })).rejects.toThrow(/Blocked terminal command pattern/);
    });

    it("should block 'rm -rf /' when followed by a semicolon", async () => {
      await expect(service.run({
        workspaceId: "test",
        command: "rm -rf /; ls",
        cwd: path.resolve(".")
      })).rejects.toThrow(/Blocked terminal command pattern/);
    });

    it("should NOT block 'rm -rf /something'", async () => {
        const result = await service.run({
            workspaceId: "test",
            command: "rm -rf /tmp/jeanbot-test-safe-delete",
            cwd: path.resolve(".")
        });
        // We expect it to at least pass the guardrail check and attempt to run
        expect(result.record.status).not.toBe("failed");
    });
  });

  describe("CWD Validation (resolveCwd)", () => {
    it("should block directory prefix bypass", async () => {
      const allowedRoot = "/tmp/jeanbot-allowed";
      const secretDir = "/tmp/jeanbot-allowed-secret";

      const fs = await import("node:fs");
      if (!fs.existsSync(allowedRoot)) fs.mkdirSync(allowedRoot, { recursive: true });
      if (!fs.existsSync(secretDir)) fs.mkdirSync(secretDir, { recursive: true });

      await expect(service.run({
        workspaceId: "test",
        command: "ls",
        cwd: secretDir
      })).rejects.toThrow(/is outside the allowed workspace root/);

      fs.rmdirSync(secretDir);
      fs.rmdirSync(allowedRoot);
    });

    it("should allow paths truly under allowed root", async () => {
        const allowedRoot = "/tmp/jeanbot-allowed";
        const subDir = path.join(allowedRoot, "subdir");

        const fs = await import("node:fs");
        if (!fs.existsSync(allowedRoot)) fs.mkdirSync(allowedRoot, { recursive: true });
        if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });

        const result = await service.run({
            workspaceId: "test",
            command: "ls",
            cwd: subDir
        });

        expect(result.record.cwd).toBe(subDir);

        fs.rmdirSync(subDir);
        fs.rmdirSync(allowedRoot);
    });
  });
});
