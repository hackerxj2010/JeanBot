from __future__ import annotations

import argparse
import asyncio
import json
import uuid
from pathlib import Path
from typing import Sequence

from .service import MissionExecutorService


def render_markdown(text: str) -> str:
    """Basic markdown to ANSI converter for shell display."""
    import re
    lines = []
    for line in text.splitlines():
        # Headers
        if line.startswith("# "):
            line = f"\n{BOLD}{CYAN}{line[2:]}{RESET}"
        elif line.startswith("## "):
            line = f"\n{BOLD}{CYAN}{line[3:]}{RESET}"
        elif line.startswith("### "):
            line = f"\n{BOLD}{YELLOW}{line[4:]}{RESET}"

        # Lists
        elif line.strip().startswith("- "):
            line = f"  • {line.strip()[2:]}"

        # Bold (processed on all lines)
        if "**" in line:
            line = re.sub(r"\*\*(.*?)\*\*", f"{BOLD}\\1{RESET}", line)

        lines.append(line)
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="JeanBot Python mission runner")
    subparsers = parser.add_subparsers(dest="command", required=True)

    template_parser = subparsers.add_parser("write-template", help="Write a sample mission payload")
    template_parser.add_argument("--output", required=True, help="Output JSON path")

    execute_parser = subparsers.add_parser("execute", help="Execute a mission payload")
    execute_parser.add_argument("--mission-file", required=True, help="Mission payload JSON file")
    execute_parser.add_argument("--workspace-root", required=True, help="Workspace root path")

    finalize_parser = subparsers.add_parser(
        "finalize-distributed",
        help="Finalize a distributed mission payload with active_execution",
    )
    finalize_parser.add_argument("--mission-file", required=True, help="Mission payload JSON file")
    finalize_parser.add_argument("--workspace-root", required=True, help="Workspace root path")

    shell_parser = subparsers.add_parser("shell", help="Start interactive mission shell")
    shell_parser.add_argument("--workspace-root", required=True, help="Workspace root path")
    shell_parser.add_argument("--workspace-id", default="workspace-interactive", help="Workspace ID")
    shell_parser.add_argument("--mode", choices=["local", "live"], default="local", help="Execution mode")
    shell_parser.add_argument("--mission-id", help="Mission ID to resume")

    return parser


# ANSI Colors
BOLD = "\033[1m"
GREEN = "\033[32m"
RED = "\033[31m"
CYAN = "\033[36m"
YELLOW = "\033[33m"
RESET = "\033[0m"


class InteractiveShell:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.service = MissionExecutorService(workspace_root=args.workspace_root, mode=args.mode)
        self.last_result = None
        self.mission_id = args.mission_id if hasattr(args, "mission_id") and args.mission_id else f"shell-{uuid.uuid4().hex[:8]}"
        self.history: list[str] = []
        self._artifacts = []

    async def run(self):
        try:
            import readline  # Enable history and line editing
        except ImportError:
            pass

        print(f"{BOLD}{CYAN}JeanBot interactive shell ({self.args.mode} mode){RESET}")
        print(f"Workspace: {self.args.workspace_root} ({self.args.workspace_id})")
        print("Type 'exit' or 'quit' to end session. Type 'help' for commands.")

        while True:
            try:
                line = input(f"\n{BOLD}jeanbot>{RESET} ").strip()
                if not line:
                    continue
                if line.lower() in ("exit", "quit"):
                    break

                self.history.append(line)
            except EOFError:
                print("\nExiting shell...")
                break
            try:

                parts = line.split(maxsplit=1)
                cmd = parts[0].lower()
                arg = parts[1] if len(parts) > 1 else ""

                if cmd == "help":
                    self.cmd_help()
                elif cmd == "history":
                    self.cmd_history()
                elif cmd == "plan":
                    await self.cmd_plan()
                elif cmd == "artifacts":
                    await self.cmd_artifacts()
                elif cmd == "show":
                    await self.cmd_show(arg)
                elif cmd == "status":
                    await self.cmd_status()
                elif cmd == "refine":
                    await self.cmd_refine(arg)
                else:
                    self.mission_id = f"shell-{uuid.uuid4().hex[:8]}"
                    await self.cmd_execute(line)

            except KeyboardInterrupt:
                print("\nInterrupt received, type 'exit' to quit.")
            except Exception as e:
                print(f"\n{RED}Error: {e}{RESET}")

    def cmd_help(self):
        print(f"{BOLD}Commands:{RESET}")
        print("  help              Show this help")
        print("  history           Show command history")
        print("  plan              Show current mission plan and step status")
        print("  artifacts         List generated artifacts")
        print("  show <path>       Show content of an artifact")
        print("  status            Show overall mission status and metrics")
        print("  exit | quit       Exit shell")
        print("  <objective>       Plan and execute a mission")
        print("  refine <feedback> Refine the last mission result with feedback")

    def cmd_history(self):
        for i, cmd in enumerate(self.history, 1):
            print(f"  {i:3}  {cmd}")

    async def cmd_plan(self):
        summary = await self.service.get_mission_run_summary(self.mission_id)
        if not summary:
            print(f"{YELLOW}No active mission found.{RESET}")
            return

        print(f"\n{BOLD}Mission Plan: {summary['mission']['title']}{RESET}")
        result = summary.get("result", {})
        reports = {r["step_id"]: r for r in result.get("step_reports", [])}

        for step in summary["mission"].get("steps", []):
            step_id = step["id"]
            report = reports.get(step_id)
            status = step.get("status", "pending")

            color = RESET
            if status == "completed":
                color = GREEN
            elif status == "running":
                color = CYAN
            elif status == "failed":
                color = RED

            score_str = ""
            if report and report.get("diagnostics"):
                score = report["diagnostics"].get("overall_score", 0)
                score_str = f" (score: {score:.2f})"

            print(f"  {color}{status:10}{RESET} {step_id}: {step['title']}{score_str}")

    async def cmd_artifacts(self):
        summary = await self.service.get_mission_run_summary(self.mission_id)
        artifacts = []
        if summary and summary.get("result") and summary["result"].get("artifacts"):
            artifacts = summary["result"]["artifacts"]
        elif self.last_result and self.last_result.artifacts:
            artifacts = self.last_result.artifacts

        if not artifacts:
            print(f"{YELLOW}No artifacts generated yet.{RESET}")
            return

        self._artifacts = artifacts
        print(f"\n{BOLD}Artifacts:{RESET}")
        for i, artifact in enumerate(artifacts, 1):
            title = artifact.get("title") if isinstance(artifact, dict) else artifact.title
            kind = artifact.get("kind") if isinstance(artifact, dict) else artifact.kind
            path = artifact.get("path") if isinstance(artifact, dict) else artifact.path
            print(f"  {i:2}. {CYAN}{title}{RESET} ({kind})")
            print(f"      Path: {path}")

    async def cmd_show(self, path: str):
        if not path:
            print(f"{YELLOW}Usage: show <artifact_path_or_index>{RESET}")
            return

        artifact_path = None
        if path.isdigit() and self._artifacts:
            idx = int(path) - 1
            if 0 <= idx < len(self._artifacts):
                art = self._artifacts[idx]
                artifact_path = art.get("path") if isinstance(art, dict) else art.path
        else:
            artifact_path = path

        if not artifact_path:
            print(f"{RED}Artifact not found.{RESET}")
            return

        p = Path(artifact_path)
        if not p.exists():
            print(f"{RED}File not found: {artifact_path}{RESET}")
            return

        print(f"\n{BOLD}Showing: {artifact_path}{RESET}")
        print("-" * 40)
        content = p.read_text(encoding="utf-8")
        if artifact_path.endswith(".md"):
            print(render_markdown(content))
        else:
            print(content)
        print("-" * 40)

    async def cmd_status(self):
        summary = await self.service.get_mission_run_summary(self.mission_id)
        if not summary:
            print(f"{YELLOW}No active mission found.{RESET}")
            return

        result = summary.get("result", {})
        metrics = result.get("metrics", {})

        print(f"\n{BOLD}Mission Status: {summary['mission']['title']}{RESET}")
        print(f"Mission ID: {self.mission_id}")
        print(f"Overall Status: {result.get('status', 'unknown')}")
        print(f"Average Score: {metrics.get('average_score', 0):.2f}")
        print(f"Steps: {metrics.get('completed_steps', 0)}/{metrics.get('total_steps', 0)} completed")
        print(f"Artifacts: {metrics.get('total_artifacts', 0)}")
        print(f"Gaps: {len(result.get('gaps', []))}")
        for gap in result.get("gaps", []):
            print(f"  - {RED}{gap}{RESET}")

    async def cmd_refine(self, feedback: str):
        if not self.last_result:
            print(f"{YELLOW}Nothing to refine. Run a mission first.{RESET}")
            return
        objective = (
            f"Refine previous mission results based on: {feedback}\n"
            f"Previous summary: {self.last_result.verification_summary}"
        )
        title = f"Refinement: {feedback[:30]}..."
        await self._execute_mission(title, objective)

    async def cmd_execute(self, objective: str):
        title = f"Mission: {objective[:30]}..."
        await self._execute_mission(title, objective)

    async def _execute_mission(self, title: str, objective: str):
        payload = {
            "mission_id": self.mission_id,
            "workspace_id": self.args.workspace_id,
            "title": title,
            "objective": objective,
            "mode": self.args.mode,
        }

        print(f"{CYAN}Executing: {title}{RESET}")
        self.last_result = await self.service.execute_payload(payload)

        status_color = GREEN if self.last_result.status == "completed" else RED
        print(f"\nStatus: {status_color}{self.last_result.status}{RESET}")
        print(f"Summary: {self.last_result.verification_summary}")
        if self.last_result.artifacts:
            print(f"Artifacts: {len(self.last_result.artifacts)}")
            for artifact in self.last_result.artifacts:
                print(f"  - {artifact.title}: {artifact.path}")


async def run_command(args: argparse.Namespace) -> dict:
    if args.command == "write-template":
        service = MissionExecutorService(workspace_root=".")
        path = service.write_payload_template(args.output)
        return {"command": "write-template", "output": str(Path(path))}

    if args.command == "shell":
        shell = InteractiveShell(args)
        await shell.run()
        return {"command": "shell", "status": "exited"}

    service = MissionExecutorService(workspace_root=args.workspace_root)
    payload = service.load_payload(args.mission_file)
    if args.command == "execute":
        result = await service.execute_payload(payload)
    elif args.command == "finalize-distributed":
        result = await service.finalize_distributed_payload(payload)
    else:
        raise ValueError(f"Unsupported command: {args.command}")

    return {
        "command": args.command,
        "mission_id": result.mission_id,
        "status": result.status,
        "execution_mode": result.execution_mode,
        "verification_summary": result.verification_summary,
        "artifact_count": len(result.artifacts),
        "step_count": len(result.step_reports),
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    payload = asyncio.run(run_command(args))
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
