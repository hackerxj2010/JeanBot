import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

const sanitizeSegment = (segment: string) => {
  return segment.replace(/[<>:"|?*]/g, "_");
};

const walkJsonFiles = (directory: string, files: string[] = []) => {
  if (!existsSync(directory)) {
    return files;
  }

  for (const entry of readdirSync(directory)) {
    const fullPath = path.join(directory, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      walkJsonFiles(fullPath, files);
      continue;
    }

    if (fullPath.endsWith(".json")) {
      files.push(fullPath);
    }
  }

  return files;
};

const blockingSleep = (durationMs: number) => {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, durationMs);
};

export class LocalJsonStore<T> {
  constructor(private readonly baseDirectory: string) {
    mkdirSync(baseDirectory, { recursive: true });
  }

  private toPath(key: string) {
    const relative = key
      .split("/")
      .filter(Boolean)
      .map(sanitizeSegment)
      .join(path.sep);

    return path.join(this.baseDirectory, `${relative}.json`);
  }

  private readPath(filePath: string) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const raw = readFileSync(filePath, "utf8");
        if (!raw.trim()) {
          throw new SyntaxError(`JSON store file "${filePath}" is empty.`);
        }

        return JSON.parse(raw) as T;
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        if (code === "ENOENT") {
          return undefined;
        }

        if (error instanceof SyntaxError && attempt < 4) {
          blockingSleep(10);
          continue;
        }

        throw error;
      }
    }

    return undefined;
  }

  read(key: string) {
    const filePath = this.toPath(key);
    if (!existsSync(filePath)) {
      return undefined;
    }

    return this.readPath(filePath);
  }

  write(key: string, value: T) {
    const filePath = this.toPath(key);
    mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
    rmSync(filePath, { force: true });
    renameSync(tempPath, filePath);
    return value;
  }

  list() {
    return walkJsonFiles(this.baseDirectory).flatMap((filePath) => {
      const record = this.readPath(filePath);
      return record === undefined ? [] : [record];
    });
  }

  delete(key: string) {
    const filePath = this.toPath(key);
    if (existsSync(filePath)) {
      rmSync(filePath);
    }
  }

  clear() {
    rmSync(this.baseDirectory, { recursive: true, force: true });
    mkdirSync(this.baseDirectory, { recursive: true });
  }
}

export const ensureDirectory = (directory: string) => {
  mkdirSync(directory, { recursive: true });
  return directory;
};
