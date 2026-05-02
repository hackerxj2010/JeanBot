from __future__ import annotations

import argparse
import asyncio
import json
import re
import uuid
from pathlib import Path
from typing import Sequence

from .service import MissionExecutorService


def render_markdown(text: str) -> str:
    """Basic markdown to ANSI converter for terminal display."""
    # Headers
    text = re.sub(r"^# (.*)$", r"\033[1;34m\1\033[0m", text, flags=re.MULTILINE)
    text = re.sub(r"^## (.*)$", r"\033[1;36m\1\033[0m", text, flags=re.MULTILINE)
    text = re.sub(r"^### (.*)$", r"\033[1;32m\1\033[0m", text, flags=re.MULTILINE)

    # Bold
    text = re.sub(r"\*\*(.*?)\*\*", r"\033[1m\1\033[0m", text)

    # Lists
    text = re.sub(r"^- (.*)$", r"  • \1", text, flags=re.MULTILINE)

    return text


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

    return parser


class InteractiveShell:
    def __init__(self, workspace_root: str, workspace_id: str, mode: str):
        self.service = MissionExecutorService(workspace_root=workspace_root, mode=mode)
        self.workspace_root = workspace_root
        self.workspace_id = workspace_id
        self.mode = mode
        self.mission_id = f"shell-{uuid.uuid4().hex[:8]}"
        self.last_result = None
        self.history: list[str] = []

    def print_help(self):
        print("\nCommands:")
        print("  help              Show this help")
        print("  history           Show command history")
        print("  status            Show current mission status")
        print("  plan              Show mission plan steps")
        print("  artifacts         List mission artifacts")
        print("  show <path>       Show artifact content")
        print("  refine <feedback> Refine the last mission result with feedback")
        print("  exit | quit       Exit shell")
        print("  <objective>       Start a new mission with the given objective")

    def print_history(self):
        for i, cmd in enumerate(self.history, 1):
            print(f"  {i:3}  {cmd}")

    async def run_mission(self, objective: str, is_refinement: bool = False):
        if is_refinement:
            if not self.last_result:
                print("Nothing to refine. Run a mission first.")
                return
            feedback = objective
            objective = (
                f"Refine previous mission results based on: {feedback}\n"
                f"Previous summary: {self.last_result.verification_summary}"
            )
            title = f"Refinement: {feedback[:30]}..."
        else:
            title = f"Mission: {objective[:30]}..."

        payload = {
            "mission_id": self.mission_id,
            "workspace_id": self.workspace_id,
            "title": title,
            "objective": objective,
            "mode": self.mode,
        }

        print(f"Executing: {title}")
        self.last_result = await self.service.execute_payload(payload)

        print(f"\nStatus: {self.last_result.status}")
        print(f"Summary: {self.last_result.verification_summary}")
        if self.last_result.artifacts:
            print(f"Artifacts: {len(self.last_result.artifacts)} (type 'artifacts' to list)")

    def show_status(self):
        summary = self.service.get_mission_run_summary(self.mission_id)
        if not summary:
            print("No active mission found.")
            return

        # Handle both nested and flat result structures for robustness
        res = summary.get("result")
        if not isinstance(res, dict):
            res = summary

        print(f"\nMission ID: {self.mission_id}")
        print(f"Status: {res.get('status', 'unknown')}")
        print(f"Summary: {res.get('verification_summary', 'N/A')}")

        metrics = res.get("metrics", {})
        print(f"Steps: {metrics.get('completed_steps', 0)}/{metrics.get('total_steps', 0)} completed")
        print(f"Artifacts: {len(res.get('artifacts', []))}")

    def show_plan(self):
        summary = self.service.get_mission_run_summary(self.mission_id)
        if not summary or "payload" not in summary:
            print("No mission plan available.")
            return

        payload = summary["payload"]
        print(f"\nPlan for: {payload.get('title')}")
        for step in payload.get("steps", []):
            status_icon = "✓" if step.get("status") == "completed" else " "
            print(f"  [{status_icon}] {step.get('id')}: {step.get('title')} ({step.get('capability')})")

    def list_artifacts(self):
        artifacts = []
        if self.last_result and self.last_result.artifacts:
            artifacts = self.last_result.artifacts
        else:
            summary = self.service.get_mission_run_summary(self.mission_id)
            if summary:
                res = summary.get("result")
                if not isinstance(res, dict):
                    res = summary
                artifacts = res.get("artifacts", [])

        if not artifacts:
            print("No artifacts found.")
            return

        print("\nArtifacts:")
        for a in artifacts:
            if hasattr(a, "path") and hasattr(a, "title"):
                path, title = a.path, a.title
            elif isinstance(a, dict):
                path = a.get("path", "unknown")
                title = a.get("title", "unknown")
            else:
                continue
            print(f"  - {title}: {path}")

    def show_artifact(self, artifact_path: str):
        if not artifact_path:
            print("Error: No path provided.")
            return

        path = Path(artifact_path)
        if not path.is_file():
            # Try relative to workspace
            path = Path(self.workspace_root) / artifact_path
            if not path.is_file():
                print(f"Error: Artifact file not found: {artifact_path}")
                return

        content = path.read_text(encoding="utf-8")
        if path.suffix == ".md":
            print("\n" + render_markdown(content))
        else:
            print("\n" + content)

    async def start(self):
        try:
            import readline
        except ImportError:
            pass

        print(f"JeanBot interactive shell ({self.mode} mode)")
        print(f"Workspace: {self.workspace_root} ({self.workspace_id})")
        print("Type 'exit' or 'quit' to end session. Type 'help' for commands.")

        while True:
            try:
                line = input("\njeanbot> ").strip()
                if not line:
                    continue
                if line.lower() in ("exit", "quit"):
                    break

                self.history.append(line)

                if line.lower() == "help":
                    self.print_help()
                elif line.lower() == "history":
                    self.print_history()
                elif line.lower() == "status":
                    self.show_status()
                elif line.lower() == "plan":
                    self.show_plan()
                elif line.lower() == "artifacts":
                    self.list_artifacts()
                elif line.lower().startswith("show "):
                    self.show_artifact(line[5:].strip())
                elif line.lower().startswith("refine "):
                    await self.run_mission(line[7:].strip(), is_refinement=True)
                else:
                    await self.run_mission(line)

            except KeyboardInterrupt:
                print("\nInterrupt received, type 'exit' to quit.")
            except Exception as e:
                import traceback
                traceback.print_exc()
                print(f"\nError: {e}")


async def run_shell(args: argparse.Namespace):
    shell = InteractiveShell(
        workspace_root=args.workspace_root,
        workspace_id=args.workspace_id,
        mode=args.mode
    )
    await shell.start()


async def run_command(args: argparse.Namespace) -> dict:
    if args.command == "write-template":
        service = MissionExecutorService(workspace_root=".")
        path = service.write_payload_template(args.output)
        return {"command": "write-template", "output": str(Path(path))}

    if args.command == "shell":
        await run_shell(args)
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
