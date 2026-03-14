import {
  copyFile,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";

export interface WorkspaceStoreEntry {
  name: string;
  absolutePath: string;
  relativePath: string;
  type: "file" | "directory";
  size: number;
  modifiedAt: string;
}

export class WorkspaceStore {
  async ensureWorkspace(workspaceRoot: string) {
    await mkdir(workspaceRoot, { recursive: true });
    await mkdir(path.join(workspaceRoot, ".jeanbot", "checkpoints"), {
      recursive: true
    });
    await mkdir(path.join(workspaceRoot, ".jeanbot", "artifacts"), {
      recursive: true
    });
  }

  async exists(targetPath: string) {
    try {
      await lstat(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  async stat(targetPath: string) {
    return lstat(targetPath);
  }

  async readText(filePath: string, fallback = "") {
    try {
      return await readFile(filePath, "utf8");
    } catch {
      return fallback;
    }
  }

  async readJson<T>(filePath: string, fallback: T) {
    try {
      const content = await readFile(filePath, "utf8");
      return JSON.parse(content) as T;
    } catch {
      return fallback;
    }
  }

  async writeJson(filePath: string, payload: unknown) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  }

  async writeText(filePath: string, payload: string) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, payload, "utf8");
  }

  async listDirectory(root: string, baseRoot = root, recursive = false): Promise<WorkspaceStoreEntry[]> {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      const results: WorkspaceStoreEntry[] = [];

      for (const entry of entries) {
        const absolutePath = path.join(root, entry.name);
        const stats = await lstat(absolutePath);
        const relativePath = path.relative(baseRoot, absolutePath).replaceAll("\\", "/");

        results.push({
          name: entry.name,
          absolutePath,
          relativePath,
          type: entry.isDirectory() ? "directory" : "file",
          size: stats.size,
          modifiedAt: stats.mtime.toISOString()
        });

        if (recursive && entry.isDirectory()) {
          results.push(...(await this.listDirectory(absolutePath, baseRoot, true)));
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  async copyPath(sourcePath: string, targetPath: string) {
    const sourceStats = await lstat(sourcePath);
    await mkdir(path.dirname(targetPath), { recursive: true });

    if (sourceStats.isDirectory()) {
      await cp(sourcePath, targetPath, {
        recursive: true,
        force: true
      });
      return;
    }

    await copyFile(sourcePath, targetPath);
  }

  async removePath(targetPath: string) {
    await rm(targetPath, {
      recursive: true,
      force: true
    });
  }
}
