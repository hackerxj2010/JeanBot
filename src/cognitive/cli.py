from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Any, Sequence

from .service import MissionExecutorService


def render_markdown(text: str) -> str:
    """Basic markdown to ANSI terminal formatter."""
    # Bold
    text = re.sub(r"\*\*(.*?)\*\*", r"\033[1m\1\033[0m", text)
    # Headers
    text = re.sub(r"^# (.*)$", r"\033[1;34m\1\033[0m", text, flags=re.M)
    text = re.sub(r"^## (.*)$", r"\033[1;32m\1\033[0m", text, flags=re.M)
    text = re.sub(r"^### (.*)$", r"\033[1;33m\1\033[0m", text, flags=re.M)
    # Lists
    text = re.sub(r"^- (.*)$", r"  • \1", text, flags=re.M)
    return text


class InteractiveShell:
    def __init__(self, workspace_root: str, workspace_id: str, mode: str = "local"):
        self.workspace_root = Path(workspace_root)
        self.workspace_id = workspace_id
        self.mode = mode
        self.service = MissionExecutorService(workspace_root=str(workspace_root), mode=mode)
        self.mission_id: str | None = None
        self.last_result: Any = None

    def _ensure_mission_id(self):
        if not self.mission_id:
            self.mission_id = f"shell-{uuid.uuid4().hex[:8]}"

    async def run(self):
        try:
            import readline
        except ImportError:
            pass

        print(f"\033[1;36mJeanBot Interactive Shell\033[0m ({self.mode} mode)")
        print(f"Workspace: {self.workspace_root} ({self.workspace_id})")
        print("Type 'help' for commands.")

        while True:
            try:
                line = input("\njeanbot> ").strip()
                if not line:
                    continue
                if line.lower() in ("exit", "quit"):
                    break

                if line.lower() == "help":
                    self.show_help()
                elif line.lower() == "status":
                    await self.show_status()
                elif line.lower() == "plan":
                    await self.show_plan()
                elif line.lower() == "artifacts":
                    await self.show_artifacts()
                elif line.lower().startswith("show "):
                    await self.show_artifact(line[5:].strip())
                elif line.lower().startswith("refine "):
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
        print("  status            Show current mission status")
        print("  plan              Show current mission plan")
        print("  artifacts         List mission artifacts")
        print("  show <id>         Inspect an artifact")
        print("  refine <feedback> Refine the last result with steering")
        print("  exit | quit       Exit shell")
        print("  <objective>       Start a new mission")

    async def show_status(self):
        if not self.mission_id:
            print("No active mission.")
            return

        summary = await self._get_summary()
        if not summary:
            print(f"Mission {self.mission_id} state not found.")
            return

        result = summary.get("result", {})
        print(f"\033[1mStatus:\033[0m {result.get('status', 'unknown')}")
        print(f"\033[1mSummary:\033[0m {result.get('verification_summary', 'N/A')}")

        metrics = result.get("metrics", {})
        print(f"\033[1mProgress:\033[0m {metrics.get('completed_steps', 0)}/{metrics.get('total_steps', 0)} steps")

    async def show_plan(self):
        summary = await self._get_summary()
        if not summary:
            print("No active plan.")
            return

        payload = summary.get("payload", {})
        steps = payload.get("steps", [])
        print(f"\033[1mPlan Version:\033[0m {payload.get('plan_version', 1)}")
        for step in steps:
            status_icon = "✓" if step.get("status") == "completed" else "○"
            print(f"  {status_icon} \033[1m{step.get('id')}\033[0m: {step.get('title')}")

    async def show_artifacts(self):
        if not self.mission_id:
            print("No active mission.")
            return

        summary = await self._get_summary()
        if not summary:
            print("No artifacts found.")
            return

        artifacts = summary.get("result", {}).get("artifacts", [])
        if not artifacts:
            print("No artifacts generated yet.")
            return

        print("\033[1mArtifacts:\033[0m")
        for i, art in enumerate(artifacts):
            print(f"  [{i}] \033[1;34m{art.get('title')}\033[0m ({art.get('kind')})")

    async def show_artifact(self, index_or_id: str):
        summary = await self._get_summary()
        if not summary:
            return

        artifacts = summary.get("result", {}).get("artifacts", [])
        selected = None

        try:
            idx = int(index_or_id)
            if 0 <= idx < len(artifacts):
                selected = artifacts[idx]
        except ValueError:
            selected = next((a for a in artifacts if a.get("id") == index_or_id), None)

        if not selected:
            print(f"Artifact '{index_or_id}' not found.")
            return

        path = Path(selected.get("path"))
        if path.exists():
            content = path.read_text(encoding="utf-8")
            print(f"\n--- \033[1m{selected.get('title')}\033[0m ---\n")
            print(render_markdown(content))
        else:
            print(f"Artifact file not found at {path}")

    async def handle_objective(self, objective: str):
        self._ensure_mission_id()
        title = f"Mission: {objective[:30]}..."

        payload = {
            "mission_id": self.mission_id,
            "workspace_id": self.workspace_id,
            "title": title,
            "objective": objective,
            "mode": self.mode,
        }

        print(f"\033[1;33mExecuting:\033[0m {title}")
        self.last_result = await self.service.execute_payload(payload)
        self._print_result(self.last_result)

    async def handle_refine(self, feedback: str):
        if not self.mission_id:
            print("Nothing to refine. Run a mission first.")
            return

        summary = await self._get_summary()
        if not summary:
            print("Could not load mission state for refinement.")
            return

        objective = (
            f"Refine previous mission results based on: {feedback}\n"
            f"Previous summary: {summary.get('result', {}).get('verification_summary')}"
        )

        payload = {
            "mission_id": self.mission_id,
            "workspace_id": self.workspace_id,
            "title": f"Refinement: {feedback[:30]}...",
            "objective": objective,
            "mode": self.mode,
            "decision_log": summary.get("result", {}).get("decision_log", []),
            "replan_history": summary.get("payload", {}).get("replan_history", []),
        }

        print(f"\033[1;33mRefining:\033[0m {self.mission_id}")
        self.last_result = await self.service.execute_payload(payload)
        self._print_result(self.last_result)

    async def _get_summary(self) -> dict | None:
        if not self.mission_id:
            return None
        mission_dir = self.workspace_root / ".jeanbot" / "missions" / self.mission_id
        run_json = mission_dir / "mission-run.json"
        payload_json = mission_dir / "mission-payload.json"

        if not run_json.exists():
            return None

        summary = json.loads(run_json.read_text(encoding="utf-8"))
        if payload_json.exists():
            summary["payload"] = json.loads(payload_json.read_text(encoding="utf-8"))
        return summary

    def _print_result(self, result: Any):
        print(f"\n\033[1mStatus:\033[0m {result.status}")
        print(f"\033[1mSummary:\033[0m {result.verification_summary}")
        if result.artifacts:
            print(f"\033[1mArtifacts:\033[0m {len(result.artifacts)}")


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
    shell_parser.add_argument("--mission-id", help="Mission ID to resume")
    shell_parser.add_argument("--mode", choices=["local", "live"], default="local", help="Execution mode")

    return parser


async def run_command(args: argparse.Namespace) -> dict:
    if args.command == "write-template":
        service = MissionExecutorService(workspace_root=".")
        path = service.write_payload_template(args.output)
        return {"command": "write-template", "output": str(Path(path))}

    if args.command == "shell":
        shell = InteractiveShell(
            workspace_root=args.workspace_root,
            workspace_id=args.workspace_id,
            mode=args.mode
        )
        if args.mission_id:
            shell.mission_id = args.mission_id
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
    if payload:
        print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
