from __future__ import annotations

import argparse
import asyncio
import json
import uuid
from pathlib import Path
from typing import Sequence

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
    shell_parser.add_argument("--mission-id", help="Resume an existing mission by ID")

    return parser


def render_markdown(text: str) -> str:
    """Basic markdown to ANSI terminal output."""
    lines = text.split("\n")
    rendered = []
    for line in lines:
        if line.startswith("# "):
            rendered.append(f"\033[1;36m{line[2:].upper()}\033[0m")
        elif line.startswith("## "):
            rendered.append(f"\033[1;34m{line[3:]}\033[0m")
        elif line.startswith("### "):
            rendered.append(f"\033[1;32m{line[4:]}\033[0m")
        elif line.startswith("- "):
            rendered.append(f"  • {line[2:]}")
        elif "**" in line:
            # Simple bold support
            parts = line.split("**")
            new_line = ""
            for i, part in enumerate(parts):
                new_line += f"\033[1m{part}\033[0m" if i % 2 == 1 else part
            rendered.append(new_line)
        else:
            rendered.append(line)
    return "\n".join(rendered)


class InteractiveShell:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.service = MissionExecutorService(workspace_root=args.workspace_root, mode=args.mode)
        self.mission_id = args.mission_id or f"shell-{uuid.uuid4().hex[:8]}"
        self.history: list[str] = []
        self.last_result = None

    async def run(self):
        try:
            import readline
        except ImportError:
            pass

        print(f"\033[1;35mJeanBot Interactive Shell\033[0m (\033[33m{self.args.mode}\033[0m mode)")
        print(f"Workspace: {self.args.workspace_root} ({self.args.workspace_id})")
        print(f"Mission ID: {self.mission_id}")
        print("Type 'exit' or 'quit' to end session. Type 'help' for commands.")

        # Try to load existing result if resuming
        if self.args.mission_id:
            summary = self.service.get_mission_run_summary(self.mission_id)
            if summary:
                print(f"Resumed mission: {summary.get('mission', {}).get('title', 'Untitled')}")
                # We can't easily reconstruct the last_result object but we have enough for status

        while True:
            try:
                line = input("\njeanbot> ").strip()
                if not line:
                    continue
                if line.lower() in ("exit", "quit"):
                    break

                self.history.append(line)

                cmd_parts = line.split()
                cmd = cmd_parts[0].lower()

                if cmd == "help":
                    self.show_help()
                elif cmd == "history":
                    self.show_history()
                elif cmd == "plan":
                    await self.show_plan()
                elif cmd == "artifacts":
                    await self.show_artifacts()
                elif cmd == "show":
                    await self.show_artifact_detail(cmd_parts[1:] if len(cmd_parts) > 1 else [])
                elif cmd == "status":
                    await self.show_status()
                elif cmd.startswith("refine"):
                    await self.handle_refine(line[7:].strip())
                else:
                    await self.handle_objective(line)

            except KeyboardInterrupt:
                print("\nInterrupt received, type 'exit' to quit.")
            except Exception as e:
                print(f"\n\033[1;31mError:\033[0m {e}")

    def show_help(self):
        print("\033[1mCommands:\033[0m")
        print("  help              Show this help")
        print("  history           Show command history")
        print("  plan              Show current mission plan and steps")
        print("  status            Show current mission status and metrics")
        print("  artifacts         List mission artifacts")
        print("  show <index|id>   View artifact content")
        print("  refine <feedback> Refine the mission with additional feedback")
        print("  exit | quit       Exit shell")
        print("  <objective>       Plan and execute a new mission")

    def show_history(self):
        for i, cmd in enumerate(self.history, 1):
            print(f"  {i:3}  {cmd}")

    async def show_plan(self):
        summary = self.service.get_mission_run_summary(self.mission_id)
        if not summary:
            print("No active mission plan.")
            return

        print(f"\033[1;34mPLAN: {summary['mission']['title']}\033[0m (v{summary['plan_version']})")
        steps = summary.get("payload_steps", [])
        for step in steps:
            status = step.get("status", "pending")
            color = "\033[32m" if status == "completed" else "\033[33m" if status == "running" else ""
            print(f"  {color}[{status:9}]\033[0m {step['id']}: {step['title']}")

    async def show_artifacts(self):
        summary = self.service.get_mission_run_summary(self.mission_id)
        if not summary:
            print("No active mission artifacts.")
            return

        artifacts = summary.get("result", {}).get("artifacts", [])
        if not artifacts:
            print("No artifacts produced yet.")
            return

        print("\033[1;34mARTIFACTS:\033[0m")
        for i, art in enumerate(artifacts):
            print(f"  [{i}] {art['id'][:8]} :: {art['title']} ({art['kind']})")

    async def show_artifact_detail(self, args: list[str]):
        if not args:
            print("Usage: show <index|id>")
            return

        summary = self.service.get_mission_run_summary(self.mission_id)
        if not summary:
            return

        artifacts = summary.get("result", {}).get("artifacts", [])
        target = None

        if args[0].isdigit():
            idx = int(args[0])
            if 0 <= idx < len(artifacts):
                target = artifacts[idx]
        else:
            target = next((a for a in artifacts if a["id"].startswith(args[0])), None)

        if not target:
            print(f"Artifact not found: {args[0]}")
            return

        path = Path(target["path"])
        if path.exists():
            content = path.read_text(encoding="utf-8")
            print(f"\n\033[1;32m--- {target['title']} ---\033[0m")
            if target["kind"] in ("log", "report"):
                print(render_markdown(content))
            else:
                print(content)
        else:
            print(f"Artifact file missing: {target['path']}")

    async def show_status(self):
        summary = self.service.get_mission_run_summary(self.mission_id)
        if not summary:
            print("No active mission.")
            return

        res = summary["result"]
        print(f"\033[1;34mSTATUS: {res['status'].upper()}\033[0m")
        print(f"Summary: {res['verification_summary']}")

        metrics = res.get("metrics", {})
        if metrics:
            print(f"Steps: {metrics.get('completed_steps')}/{metrics.get('total_steps')} completed")
            print(f"Score: {metrics.get('average_score')}")

        gaps = res.get("gaps", [])
        if gaps:
            print("\033[1;31mGaps identified:\033[0m")
            for gap in gaps:
                print(f"  - {gap}")

    async def handle_refine(self, feedback: str):
        summary = self.service.get_mission_run_summary(self.mission_id)
        if not summary:
            print("Nothing to refine. Run a mission first.")
            return

        res = summary["result"]
        objective = (
            f"Refine previous mission results based on: {feedback}\n"
            f"Previous summary: {res.get('verification_summary')}"
        )
        await self.execute_mission(f"Refinement: {feedback[:30]}...", objective)

    async def handle_objective(self, objective: str):
        await self.execute_mission(f"Mission: {objective[:30]}...", objective)

    async def execute_mission(self, title: str, objective: str):
        payload = {
            "mission_id": self.mission_id,
            "workspace_id": self.args.workspace_id,
            "title": title,
            "objective": objective,
            "mode": self.args.mode,
        }

        print(f"\033[1;32mExecuting:\033[0m {title}")
        self.last_result = await self.service.execute_payload(payload)

        print(f"\n\033[1mStatus:\033[0m {self.last_result.status}")
        print(f"\033[1mSummary:\033[0m {self.last_result.verification_summary}")
        if self.last_result.artifacts:
            print(f"\033[1mArtifacts:\033[0m {len(self.last_result.artifacts)} produced. Type 'artifacts' to list.")


async def run_shell(args: argparse.Namespace):
    shell = InteractiveShell(args)
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
