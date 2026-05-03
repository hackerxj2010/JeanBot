from __future__ import annotations

import argparse
import asyncio
import json
import re
import uuid
from pathlib import Path
from typing import Sequence, Any

from .service import MissionExecutorService


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
    shell_parser.add_argument("--mission-id", help="Resume a specific mission ID")

    return parser


def render_markdown(text: str) -> str:
    # Basic ANSI markdown renderer for terminal
    text = re.sub(r"^# (.*)$", r"\033[1;34m\1\033[0m", text, flags=re.M)
    text = re.sub(r"^## (.*)$", r"\033[1;36m\1\033[0m", text, flags=re.M)
    text = re.sub(r"^### (.*)$", r"\033[1;32m\1\033[0m", text, flags=re.M)
    text = re.sub(r"\*\*(.*?)\*\*", r"\033[1m\1\033[0m", text)
    text = re.sub(r"^- (.*)$", r"  • \1", text, flags=re.M)
    return text


class InteractiveShell:
    def __init__(self, service: MissionExecutorService, workspace_id: str, mode: str, mission_id: str | None = None):
        self.service = service
        self.workspace_id = workspace_id
        self.mode = mode
        self.mission_id = mission_id or f"shell-{uuid.uuid4().hex[:8]}"
        self.last_result: Any = None
        self.history: list[str] = []

    async def run(self):
        try:
            import readline
        except ImportError:
            pass

        print(f"\033[1;34mJeanBot interactive shell\033[0m (\033[1;32m{self.mode}\033[0m mode)")
        print(f"Workspace: {self.service.workspace_root} ({self.workspace_id})")
        print(f"Mission ID: \033[1;33m{self.mission_id}\033[0m")
        print("Type 'exit' or 'quit' to end session. Type 'help' for commands.")

        while True:
            try:
                line = input(f"\n\033[1;34mjeanbot\033[0m [\033[1;33m{self.mission_id}\033[0m]> ").strip()
                if not line:
                    continue
                if line.lower() in ("exit", "quit"):
                    break

                self.history.append(line)
                parts = line.split(maxsplit=1)
                cmd = parts[0].lower()
                args = parts[1] if len(parts) > 1 else ""

                if cmd == "help":
                    self.show_help()
                elif cmd == "history":
                    self.show_history()
                elif cmd == "status":
                    await self.show_status()
                elif cmd == "plan":
                    await self.show_plan()
                elif cmd == "artifacts":
                    await self.show_artifacts()
                elif cmd == "show":
                    await self.show_artifact(args)
                elif cmd == "refine":
                    await self.handle_refine(args)
                else:
                    await self.handle_mission(line)

            except KeyboardInterrupt:
                print("\nInterrupt received, type 'exit' to quit.")
            except Exception as e:
                print(f"\n\033[1;31mError:\033[0m {e}")

    def show_help(self):
        print("\033[1mCommands:\033[0m")
        print("  help              Show this help")
        print("  history           Show command history")
        print("  status            Show current mission status")
        print("  plan              Show mission execution plan")
        print("  artifacts         List generated artifacts")
        print("  show <id|path>    Inspect an artifact")
        print("  refine <feedback> Refine the last mission result with feedback")
        print("  <objective>       Plan and execute a new mission (starts new ID if none active)")
        print("  exit | quit       Exit shell")

    def show_history(self):
        for i, cmd in enumerate(self.history, 1):
            print(f"  {i:3}  {cmd}")

    async def show_status(self):
        summary = self.service.get_mission_run_summary(self.mission_id)
        if not summary:
            print("No active mission status found.")
            return

        res = summary.get("result", {})
        status = res.get("status", "unknown")
        print(f"\033[1mStatus:\033[0m {status}")
        print(f"\033[1mSummary:\033[0m {res.get('verification_summary', 'N/A')}")

        metrics = res.get("metrics", {})
        if metrics:
            print(f"\033[1mProgress:\033[0m {metrics.get('completed_steps', 0)}/{metrics.get('total_steps', 0)} steps")

    async def show_plan(self):
        summary = self.service.get_mission_run_summary(self.mission_id)
        if not summary:
            print("No mission plan found.")
            return

        steps = summary.get("payload_steps", [])
        if not steps:
            print("No steps defined in mission plan.")
            return

        print("\033[1mExecution Plan:\033[0m")
        for s in steps:
            status = s.get("status", "pending")
            color = "\033[1;32m" if status == "completed" else "\033[1;34m" if status == "running" else ""
            print(f"  {color}[{status:10}]\033[0m {s.get('id')}: {s.get('title')}")

    async def show_artifacts(self):
        summary = self.service.get_mission_run_summary(self.mission_id)
        if not summary:
            print("No mission artifacts found.")
            return

        artifacts = summary.get("result", {}).get("artifacts", [])
        if not artifacts:
            print("No artifacts generated yet.")
            return

        print("\033[1mArtifacts:\033[0m")
        for i, a in enumerate(artifacts):
            print(f"  {i:2}  \033[1;32m{a.get('id')[:8]}\033[0m  {a.get('kind'):10}  {a.get('title')}")

    async def show_artifact(self, query: str):
        if not query:
            print("Usage: show <artifact_id|index>")
            return

        summary = self.service.get_mission_run_summary(self.mission_id)
        if not summary:
            print("No mission data found.")
            return

        artifacts = summary.get("result", {}).get("artifacts", [])
        target = None

        if query.isdigit():
            idx = int(query)
            if 0 <= idx < len(artifacts):
                target = artifacts[idx]
        else:
            target = next((a for a in artifacts if a.get("id", "").startswith(query)), None)

        if not target:
            print(f"Artifact '{query}' not found.")
            return

        path = Path(target.get("path"))
        if not path.exists():
            print(f"Artifact file not found: {path}")
            return

        content = path.read_text(encoding="utf-8")
        print(f"\n--- \033[1m{target.get('title')}\033[0m ({target.get('path')}) ---\n")
        if target.get("kind") in ("log", "report") or path.suffix == ".md":
            print(render_markdown(content))
        else:
            print(content)

    async def handle_refine(self, feedback: str):
        if not feedback:
            print("Usage: refine <feedback>")
            return

        summary = self.service.get_mission_run_summary(self.mission_id)
        if not summary:
            print("Nothing to refine. Run a mission first.")
            return

        res = summary.get("result", {})
        objective = (
            f"Refine previous mission results based on: {feedback}\n"
            f"Previous summary: {res.get('verification_summary')}"
        )
        title = f"Refinement: {feedback[:30]}..."

        payload = {
            "mission_id": self.mission_id,
            "workspace_id": self.workspace_id,
            "title": title,
            "objective": objective,
            "mode": self.mode,
        }

        print(f"\033[1;34mRefining:\033[0m {title}")
        self.last_result = await self.service.execute_payload(payload)
        self.print_result(self.last_result)

    async def handle_mission(self, objective: str):
        title = f"Mission: {objective[:30]}..."
        payload = {
            "mission_id": self.mission_id,
            "workspace_id": self.workspace_id,
            "title": title,
            "objective": objective,
            "mode": self.mode,
        }

        print(f"\033[1;34mExecuting:\033[0m {title}")
        self.last_result = await self.service.execute_payload(payload)
        self.print_result(self.last_result)

    def print_result(self, result: Any):
        print(f"\n\033[1mStatus:\033[0m {result.status}")
        print(f"\033[1mSummary:\033[0m {result.verification_summary}")
        if result.artifacts:
            print(f"\033[1mArtifacts:\033[0m {len(result.artifacts)} (type 'artifacts' to list)")


async def run_shell(args: argparse.Namespace):
    service = MissionExecutorService(workspace_root=args.workspace_root, mode=args.mode)
    shell = InteractiveShell(
        service=service,
        workspace_id=args.workspace_id,
        mode=args.mode,
        mission_id=args.mission_id
    )
    await shell.run()


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
