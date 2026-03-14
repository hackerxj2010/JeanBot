import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FileService } from "../../services/file-service/src/index.js";

describe("FileService", () => {
  it("creates a checkpoint before overwriting and restores the previous content", async () => {
    const service = new FileService();
    const workspaceRoot = path.resolve("tmp", "sessions", "file-service-checkpoint-test");

    await rm(workspaceRoot, { recursive: true, force: true });
    await mkdir(workspaceRoot, { recursive: true });
    await service.ensureWorkspace(workspaceRoot);

    await service.writeWorkspaceFile(workspaceRoot, "docs/notes.txt", "first version", {
      missionId: "mission-file-service"
    });

    const writeResult = await service.writeWorkspaceFile(workspaceRoot, "docs/notes.txt", "second version", {
      missionId: "mission-file-service"
    });

    expect(writeResult.checkpointId).toBeTruthy();

    const overwritten = await service.readWorkspaceFile(workspaceRoot, "docs/notes.txt");
    expect(overwritten).toBe("second version");

    const checkpoints = await service.listCheckpoints(workspaceRoot, {
      relativePath: "docs/notes.txt"
    });

    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]?.checkpointId).toBe(writeResult.checkpointId);

    await service.rollbackCheckpoint(workspaceRoot, writeResult.checkpointId!);

    const restored = await service.readWorkspaceFile(workspaceRoot, "docs/notes.txt");
    expect(restored).toBe("first version");
  });

  it("requires explicit confirmation before deleting and restores deleted files from a checkpoint", async () => {
    const service = new FileService();
    const workspaceRoot = path.resolve("tmp", "sessions", "file-service-delete-test");

    await rm(workspaceRoot, { recursive: true, force: true });
    await mkdir(workspaceRoot, { recursive: true });
    await service.ensureWorkspace(workspaceRoot);

    await service.writeWorkspaceFile(workspaceRoot, "docs/delete-me.txt", "delete target", {
      missionId: "mission-delete"
    });

    await expect(
      service.deleteWorkspacePath(workspaceRoot, "docs/delete-me.txt", {
        missionId: "mission-delete"
      })
    ).rejects.toThrow(/confirmation flag/i);

    const deleted = await service.deleteWorkspacePath(workspaceRoot, "docs/delete-me.txt", {
      missionId: "mission-delete",
      confirm: true
    });

    expect(deleted.deleted).toBe(true);
    expect(deleted.checkpointId).toBeTruthy();
    expect(await service.readWorkspaceFile(workspaceRoot, "docs/delete-me.txt", "__missing__")).toBe(
      "__missing__"
    );

    await service.rollbackCheckpoint(workspaceRoot, deleted.checkpointId!);

    const restored = await service.readWorkspaceFile(workspaceRoot, "docs/delete-me.txt");
    expect(restored).toBe("delete target");
  });

  it("blocks path traversal attempts for read, write, delete, and checkpoint listing", async () => {
    const service = new FileService();
    const workspaceRoot = path.resolve("tmp", "sessions", "file-service-traversal-test");

    await rm(workspaceRoot, { recursive: true, force: true });
    await mkdir(workspaceRoot, { recursive: true });
    await service.ensureWorkspace(workspaceRoot);

    await expect(service.readWorkspaceFile(workspaceRoot, "../escape.txt")).rejects.toThrow(
      /path traversal blocked/i
    );

    await expect(
      service.writeWorkspaceFile(workspaceRoot, "../escape.txt", "blocked", {
        missionId: "mission-traversal"
      })
    ).rejects.toThrow(/path traversal blocked/i);

    await expect(
      service.deleteWorkspacePath(workspaceRoot, "../escape.txt", {
        missionId: "mission-traversal",
        confirm: true
      })
    ).rejects.toThrow(/path traversal blocked/i);

    await expect(
      service.listCheckpoints(workspaceRoot, {
        relativePath: "../escape.txt"
      })
    ).rejects.toThrow(/path traversal blocked/i);
  });
});
