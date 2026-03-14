import crypto from "node:crypto";
import path from "node:path";

import { createLogger } from "@jeanbot/logger";
import type { ServiceHealth } from "@jeanbot/types";

import {
  type WorkspaceStoreEntry,
  WorkspaceStore
} from "./storage/workspace-store.js";

export interface FileCheckpointEntry {
  relativePath: string;
  exists: boolean;
  kind: "file" | "directory" | "missing";
  snapshotPath?: string | undefined;
  size?: number | undefined;
  modifiedAt?: string | undefined;
}

export interface FileCheckpointManifest {
  id: string;
  missionId: string;
  note: string;
  createdAt: string;
  entries: FileCheckpointEntry[];
}

export interface FileCheckpointSummary {
  checkpointId: string;
  checkpointPath: string;
  createdAt: string;
  note: string;
  missionId: string;
  entries: FileCheckpointEntry[];
}

export interface FileWriteResult {
  absolutePath: string;
  relativePath: string;
  checkpointId?: string | undefined;
}

export interface FileDeleteResult {
  absolutePath: string;
  relativePath: string;
  deleted: boolean;
  checkpointId?: string | undefined;
}

export interface FileRollbackResult {
  checkpointId: string;
  restoredPaths: string[];
}

const checkpointRootRelative = ".jeanbot/checkpoints";

const workspacePaths = (workspaceRoot: string) => ({
  jeanFilePath: path.join(workspaceRoot, "JEAN.md"),
  contextFilePath: path.join(workspaceRoot, ".jeanbot", "context.md"),
  artifactRoot: path.join(workspaceRoot, ".jeanbot", "artifacts"),
  checkpointRoot: path.join(workspaceRoot, ".jeanbot", "checkpoints")
});

const normalizeRelativePath = (value: string) => value.replaceAll("\\", "/");

export class FileService {
  private readonly logger = createLogger("file-service");
  private readonly workspaceStore = new WorkspaceStore();

  private resolveWorkspaceRoot(workspaceRoot: string) {
    return path.resolve(workspaceRoot);
  }

  private resolveWorkspacePath(
    workspaceRoot: string,
    relativePath: string,
    options: {
      allowJeanbotInternals?: boolean | undefined;
      allowWorkspaceRoot?: boolean | undefined;
    } = {}
  ) {
    const root = this.resolveWorkspaceRoot(workspaceRoot);
    const absolutePath = path.resolve(root, relativePath);
    const relativeFromRoot = path.relative(root, absolutePath);
    const normalizedRelativePath =
      relativeFromRoot === "" ? "." : normalizeRelativePath(relativeFromRoot);

    if (relativeFromRoot.startsWith("..") || path.isAbsolute(relativeFromRoot)) {
      throw new Error(`Path traversal blocked for "${relativePath}".`);
    }

    if (!options.allowWorkspaceRoot && normalizedRelativePath === ".") {
      throw new Error("Operating on the workspace root is not allowed for this file action.");
    }

    const jeanbotInternals =
      normalizedRelativePath === ".jeanbot" ||
      normalizedRelativePath.startsWith(".jeanbot/");

    if (!options.allowJeanbotInternals && jeanbotInternals) {
      throw new Error(`Access to internal JeanBot path "${normalizedRelativePath}" is blocked.`);
    }

    return {
      workspaceRoot: root,
      absolutePath,
      relativePath: normalizedRelativePath
    };
  }

  private checkpointDirectory(workspaceRoot: string, checkpointId: string) {
    return path.join(workspacePaths(workspaceRoot).checkpointRoot, checkpointId);
  }

  private checkpointManifestPath(workspaceRoot: string, checkpointId: string) {
    return path.join(this.checkpointDirectory(workspaceRoot, checkpointId), "manifest.json");
  }

  private async buildCheckpointEntry(
    workspaceRoot: string,
    checkpointId: string,
    relativePath: string,
    options: {
      allowJeanbotInternals?: boolean | undefined;
    } = {}
  ): Promise<FileCheckpointEntry> {
    const resolved = this.resolveWorkspacePath(workspaceRoot, relativePath, {
      allowJeanbotInternals: options.allowJeanbotInternals,
      allowWorkspaceRoot: false
    });

    if (!(await this.workspaceStore.exists(resolved.absolutePath))) {
      return {
        relativePath: resolved.relativePath,
        exists: false,
        kind: "missing"
      };
    }

    const stats = await this.workspaceStore.stat(resolved.absolutePath);
    const snapshotRelativePath = normalizeRelativePath(path.join("files", resolved.relativePath));
    const snapshotAbsolutePath = path.join(
      this.checkpointDirectory(workspaceRoot, checkpointId),
      snapshotRelativePath
    );

    await this.workspaceStore.copyPath(resolved.absolutePath, snapshotAbsolutePath);

    return {
      relativePath: resolved.relativePath,
      exists: true,
      kind: stats.isDirectory() ? "directory" : "file",
      snapshotPath: snapshotRelativePath,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString()
    };
  }

  private async loadCheckpointManifest(workspaceRoot: string, checkpointId: string) {
    const manifestPath = this.checkpointManifestPath(workspaceRoot, checkpointId);
    const manifest = await this.workspaceStore.readJson<FileCheckpointManifest | undefined>(
      manifestPath,
      undefined
    );

    if (!manifest) {
      throw new Error(`Checkpoint "${checkpointId}" was not found.`);
    }

    return {
      manifest,
      manifestPath
    };
  }

  private async writeInternalWorkspaceFile(
    workspaceRoot: string,
    relativePath: string,
    content: string,
    note: string
  ) {
    const resolved = this.resolveWorkspacePath(workspaceRoot, relativePath, {
      allowJeanbotInternals: true,
      allowWorkspaceRoot: false
    });

    let checkpointId: string | undefined;
    if (await this.workspaceStore.exists(resolved.absolutePath)) {
      const checkpoint = await this.createCheckpoint(workspaceRoot, "workspace-system", note, [
        resolved.relativePath
      ]);
      checkpointId = checkpoint.checkpointId;
    }

    await this.workspaceStore.writeText(resolved.absolutePath, content);
    return {
      absolutePath: resolved.absolutePath,
      relativePath: resolved.relativePath,
      checkpointId
    };
  }

  async ensureWorkspace(workspaceRoot: string) {
    await this.workspaceStore.ensureWorkspace(this.resolveWorkspaceRoot(workspaceRoot));
  }

  async readJeanFile(jeanFilePath: string) {
    return this.workspaceStore.readText(jeanFilePath, "# No JEAN.md found yet");
  }

  pathsForWorkspace(workspaceRoot: string) {
    return workspacePaths(this.resolveWorkspaceRoot(workspaceRoot));
  }

  async scanWorkspace(workspaceRoot: string, options: { recursive?: boolean | undefined } = {}) {
    const root = this.resolveWorkspaceRoot(workspaceRoot);
    const entries = await this.workspaceStore.listDirectory(root, root, options.recursive ?? false);

    return entries
      .filter((entry) => !entry.relativePath.startsWith(checkpointRootRelative))
      .map((entry) => ({
        name: entry.name,
        relativePath: entry.relativePath,
        type: entry.type,
        size: entry.size,
        modifiedAt: entry.modifiedAt
      }));
  }

  async readWorkspaceFile(workspaceRoot: string, relativePath: string, fallback = "") {
    const resolved = this.resolveWorkspacePath(workspaceRoot, relativePath);
    return this.workspaceStore.readText(resolved.absolutePath, fallback);
  }

  async writeWorkspaceFile(
    workspaceRoot: string,
    relativePath: string,
    content: string,
    options: {
      missionId?: string | undefined;
      note?: string | undefined;
    } = {}
  ): Promise<FileWriteResult> {
    const resolved = this.resolveWorkspacePath(workspaceRoot, relativePath);
    let checkpointId: string | undefined;

    if (await this.workspaceStore.exists(resolved.absolutePath)) {
      const checkpoint = await this.createCheckpoint(
        workspaceRoot,
        options.missionId ?? "workspace-manual",
        options.note ?? `Before overwriting ${resolved.relativePath}`,
        [resolved.relativePath]
      );
      checkpointId = checkpoint.checkpointId;
    }

    await this.workspaceStore.writeText(resolved.absolutePath, content);
    return {
      absolutePath: resolved.absolutePath,
      relativePath: resolved.relativePath,
      checkpointId
    };
  }

  async deleteWorkspacePath(
    workspaceRoot: string,
    relativePath: string,
    options: {
      missionId?: string | undefined;
      note?: string | undefined;
      confirm?: boolean | undefined;
    } = {}
  ): Promise<FileDeleteResult> {
    if (!options.confirm) {
      throw new Error(`Deleting "${relativePath}" requires an explicit confirmation flag.`);
    }

    const resolved = this.resolveWorkspacePath(workspaceRoot, relativePath);
    const exists = await this.workspaceStore.exists(resolved.absolutePath);
    if (!exists) {
      return {
        absolutePath: resolved.absolutePath,
        relativePath: resolved.relativePath,
        deleted: false
      };
    }

    const checkpoint = await this.createCheckpoint(
      workspaceRoot,
      options.missionId ?? "workspace-manual",
      options.note ?? `Before deleting ${resolved.relativePath}`,
      [resolved.relativePath]
    );

    await this.workspaceStore.removePath(resolved.absolutePath);

    return {
      absolutePath: resolved.absolutePath,
      relativePath: resolved.relativePath,
      deleted: true,
      checkpointId: checkpoint.checkpointId
    };
  }

  async createCheckpoint(
    workspaceRoot: string,
    missionId: string,
    note: string,
    files: string[] = []
  ): Promise<FileCheckpointSummary> {
    const root = this.resolveWorkspaceRoot(workspaceRoot);
    await this.ensureWorkspace(root);

    const createdAt = new Date().toISOString();
    const checkpointId = `${Date.now()}-${crypto.randomUUID()}`;
    const manifestPath = this.checkpointManifestPath(root, checkpointId);
    const requestedFiles = [...new Set(files.map((file) => normalizeRelativePath(file)).filter(Boolean))];
    const entries: FileCheckpointEntry[] = [];

    for (const relativePath of requestedFiles) {
      entries.push(
        await this.buildCheckpointEntry(root, checkpointId, relativePath, {
          allowJeanbotInternals: relativePath.startsWith(".jeanbot/")
        })
      );
    }

    const manifest: FileCheckpointManifest = {
      id: checkpointId,
      missionId,
      note,
      createdAt,
      entries
    };

    await this.workspaceStore.writeJson(manifestPath, manifest);
    this.logger.info("Created checkpoint", {
      checkpointPath: manifestPath,
      missionId
    });

    return {
      checkpointId,
      checkpointPath: manifestPath,
      createdAt,
      note,
      missionId,
      entries
    };
  }

  async listCheckpoints(
    workspaceRoot: string,
    options: {
      relativePath?: string | undefined;
    } = {}
  ) {
    const checkpointRoot = workspacePaths(this.resolveWorkspaceRoot(workspaceRoot)).checkpointRoot;
    const checkpointEntries = await this.workspaceStore.listDirectory(checkpointRoot, checkpointRoot, false);
    const manifests: FileCheckpointSummary[] = [];
    const normalizedFilter = options.relativePath
      ? this.resolveWorkspacePath(workspaceRoot, options.relativePath).relativePath
      : undefined;

    for (const entry of checkpointEntries) {
      if (entry.type !== "directory") {
        continue;
      }

      const manifestPath = path.join(entry.absolutePath, "manifest.json");
      const manifest = await this.workspaceStore.readJson<FileCheckpointManifest | undefined>(
        manifestPath,
        undefined
      );

      if (!manifest) {
        continue;
      }

      if (
        normalizedFilter &&
        !manifest.entries.some((checkpointEntry) => checkpointEntry.relativePath === normalizedFilter)
      ) {
        continue;
      }

      manifests.push({
        checkpointId: manifest.id,
        checkpointPath: manifestPath,
        createdAt: manifest.createdAt,
        note: manifest.note,
        missionId: manifest.missionId,
        entries: manifest.entries
      });
    }

    return manifests.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async rollbackCheckpoint(
    workspaceRoot: string,
    checkpointId: string,
    options: {
      relativePath?: string | undefined;
    } = {}
  ): Promise<FileRollbackResult> {
    const { manifest } = await this.loadCheckpointManifest(workspaceRoot, checkpointId);
    const normalizedFilter = options.relativePath
      ? this.resolveWorkspacePath(workspaceRoot, options.relativePath).relativePath
      : undefined;
    const restoredPaths: string[] = [];

    for (const entry of manifest.entries) {
      if (normalizedFilter && entry.relativePath !== normalizedFilter) {
        continue;
      }

      const resolved = this.resolveWorkspacePath(workspaceRoot, entry.relativePath, {
        allowJeanbotInternals: entry.relativePath.startsWith(".jeanbot/"),
        allowWorkspaceRoot: false
      });

      if (!entry.exists) {
        await this.workspaceStore.removePath(resolved.absolutePath);
        restoredPaths.push(entry.relativePath);
        continue;
      }

      const snapshotPath = entry.snapshotPath
        ? path.join(this.checkpointDirectory(workspaceRoot, checkpointId), entry.snapshotPath)
        : undefined;

      if (!snapshotPath || !(await this.workspaceStore.exists(snapshotPath))) {
        throw new Error(`Checkpoint "${checkpointId}" is missing snapshot data for "${entry.relativePath}".`);
      }

      await this.workspaceStore.removePath(resolved.absolutePath);
      await this.workspaceStore.copyPath(snapshotPath, resolved.absolutePath);
      restoredPaths.push(entry.relativePath);
    }

    return {
      checkpointId,
      restoredPaths
    };
  }

  async updateWorkspaceContext(
    workspaceRoot: string,
    missionTitle: string,
    completed: string[],
    inProgress: string[],
    upcoming: string[]
  ) {
    const content = [
      "# JeanBot User Context",
      "",
      `- Current mission: ${missionTitle}`,
      `- Updated at: ${new Date().toISOString()}`,
      `- Completed steps: ${completed.join(" | ") || "none"}`,
      `- In-progress steps: ${inProgress.join(" | ") || "none"}`,
      `- Upcoming steps: ${upcoming.join(" | ") || "none"}`
    ].join("\n");

    const result = await this.writeInternalWorkspaceFile(
      workspaceRoot,
      ".jeanbot/context.md",
      content,
      "Before updating workspace context"
    );

    return result.absolutePath;
  }

  async writeArtifact(
    workspaceRoot: string,
    missionId: string,
    fileName: string,
    content: string
  ) {
    const result = await this.writeInternalWorkspaceFile(
      workspaceRoot,
      normalizeRelativePath(path.join(".jeanbot", "artifacts", missionId, fileName)),
      content,
      `Before updating artifact ${fileName}`
    );
    return result.absolutePath;
  }

  health(): ServiceHealth {
    return {
      name: "file-service",
      ok: true,
      details: {}
    };
  }
}

export type { WorkspaceStoreEntry };
