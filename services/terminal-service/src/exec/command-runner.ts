import { spawn } from "node:child_process";

export const runCommand = (
  command: string,
  cwd: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> => {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === "win32";
    const executable = isWindows ? "powershell" : "bash";
    const args = isWindows
      ? ["-NoProfile", "-Command", command]
      : ["-lc", command];

    const child = spawn(executable, args, {
      cwd,
      env: process.env
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill();
      reject(new Error(`Command timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode });
    });
  });
};
