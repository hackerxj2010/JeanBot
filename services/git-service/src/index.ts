import { spawn } from "node:child_process";
import path from "node:path";
import { createLogger } from "@jeanbot/logger";
import type { ServiceHealth } from "@jeanbot/types";

export class GitService {
  private readonly logger = createLogger("git-service");

  private async execGit(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, { cwd });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => (stdout += data));
      child.stderr.on("data", (data) => (stderr += data));

      child.on("close", (code) => {
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(`Git command failed with code ${code}: ${stderr}`));
      });
    });
  }

  async getDiff(cwd: string, target = "HEAD") {
    return this.execGit(["diff", target], cwd);
  }

  async getLog(cwd: string, limit = 10) {
    return this.execGit(["log", "-n", String(limit), "--pretty=format:%h %ad | %s%d [%an]", "--graph", "--date=short"], cwd);
  }

  async commit(cwd: string, message: string) {
    await this.execGit(["add", "."], cwd);
    return this.execGit(["commit", "-m", message], cwd);
  }

  async push(cwd: string, remote = "origin", branch = "main") {
    return this.execGit(["push", remote, branch], cwd);
  }

  async getCurrentBranch(cwd: string) {
    return this.execGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  }

  health(): ServiceHealth {
    return {
      name: "git-service",
      ok: true,
      details: {}
    };
  }
}
