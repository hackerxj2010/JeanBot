import { spawn } from "node:child_process";
import path from "node:path";
import { createLogger } from "@jeanbot/logger";
import type { ServiceHealth } from "@jeanbot/types";

/**
 * Universal Git Intelligence Service
 *
 * Provides high-fidelity version control operations, enabling JeanBot
 * to manage codebase state with the precision of a senior engineer.
 */

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
        else {
          this.logger.error("Git command failed", { code, args, stderr });
          reject(new Error(`Git command failed with code ${code}: ${stderr}`));
        }
      });
    });
  }

  /**
   * Retrieves the current workspace diff.
   */
  async getDiff(cwd: string, target = "HEAD") {
    this.logger.info("Fetching git diff", { cwd, target });
    return this.execGit(["diff", target], cwd);
  }

  /**
   * Reads the commit log with architectural formatting.
   */
  async getLog(cwd: string, limit = 10) {
    this.logger.info("Reading git log", { cwd, limit });
    return this.execGit([
      "log",
      "-n",
      String(limit),
      "--pretty=format:%h %ad | %s%d [%an]",
      "--graph",
      "--date=short"
    ], cwd);
  }

  /**
   * Performs a senior-level commit with staging.
   */
  async commit(cwd: string, message: string) {
    this.logger.info("Executing git commit", { cwd, message });
    await this.execGit(["add", "."], cwd);
    return this.execGit(["commit", "-m", message], cwd);
  }

  /**
   * Pushes local changes to the remote upstream.
   */
  async push(cwd: string, remote = "origin", branch = "main") {
    this.logger.info("Pushing to remote", { cwd, remote, branch });
    return this.execGit(["push", remote, branch], cwd);
  }

  /**
   * Retrieves the current branch name.
   */
  async getCurrentBranch(cwd: string) {
    return this.execGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  }

  /**
   * Advanced: Stash current changes.
   */
  async stash(cwd: string, message?: string) {
    const args = ["stash"];
    if (message) args.push("push", "-m", message);
    return this.execGit(args, cwd);
  }

  /**
   * Advanced: Pop the most recent stash.
   */
  async stashPop(cwd: string) {
    return this.execGit(["stash", "pop"], cwd);
  }

  /**
   * Advanced: Create and checkout a new branch.
   */
  async createBranch(cwd: string, branchName: string) {
    this.logger.info("Creating new branch", { branchName });
    return this.execGit(["checkout", "-b", branchName], cwd);
  }

  /**
   * Advanced: Merge a branch.
   */
  async merge(cwd: string, sourceBranch: string) {
    this.logger.info("Merging branch", { sourceBranch });
    return this.execGit(["merge", sourceBranch], cwd);
  }

  health(): ServiceHealth {
    return {
      name: "git-service",
      ok: true,
      details: {
        capabilities: ["diff", "log", "commit", "push", "stash", "branching"]
      }
    };
  }
}
