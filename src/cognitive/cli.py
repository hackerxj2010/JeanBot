from __future__ import annotations

import argparse
import asyncio
import json
import re
import uuid
from pathlib import Path
from typing import Any, Sequence

from .service import MissionExecutorService


def render_markdown(text: str) -> str:
    """Basic ANSI markdown renderer for terminal."""
    # Headers
    text = re.sub(r"^# (.*)$", r"\033[1;34m# \1\033[0m", text, flags=re.MULTILINE)
    text = re.sub(r"^## (.*)$", r"\033[1;36m## \1\033[0m", text, flags=re.MULTILINE)
    # Bold
    text = re.sub(r"\*\*(.*?)\*\*", r"\033[1m\1\033[0m", text)
    # Lists
    text = re.sub(r"^([ \t]*)[-*+] ", r"\1\033[32m•\033[0m ", text, flags=re.MULTILINE)
    return text


class InteractiveShell:
    def __init__(self, workspace_root: str, mode: str = "local", workspace_id: str = "workspace-interactive"):
        self.service = MissionExecutorService(workspace_root=workspace_root, mode=mode)
        self.workspace_root = workspace_root
        self.workspace_id = workspace_id
        self.mode = mode
        self.mission_id = f"shell-{uuid.uuid4().hex[:8]}"
        self.last_result = None
        self.history: list[str] = []

    async def run(self):
        try:
            import readline
        except ImportError:
            pass

        print(f"\033[1;32mJeanBot Interactive Shell\033[0m ({self.mode} mode)")
        print(f"Workspace: {self.workspace_root} ({self.workspace_id})")
        print("Type 'help' for commands.")

        while True:
            try:
                line = input("\njeanbot> ").strip()
                if not line:
                    continue
                if line.lower() in ("exit", "quit"):
                    break

                self.history.append(line)
                await self.handle_command(line)

            except KeyboardInterrupt:
                print("\nInterrupt received, type 'exit' to quit.")
            except Exception as e:
                print(f"\n\033[1;31mError:\033[0m {e}")

    async def handle_command(self, line: str):
        parts = line.split(maxsplit=1)
        cmd = parts[0].lower()
        args = parts[1] if len(parts) > 1 else ""

        if cmd == "help":
            self.show_help()
        elif cmd == "history":
            for i, h in enumerate(self.history, 1):
                print(f"  {i:3}  {h}")
        elif cmd == "status":
            await self.show_status()
        elif cmd == "plan":
            await self.show_plan()
        elif cmd == "artifacts":
            await self.show_artifacts()
        elif cmd == "show":
            await self.show_artifact(args)
        elif cmd == "refine":
            await self.refine_mission(args)
        else:
            await self.execute_objective(line)

    def show_help(self):
        print("\033[1mCommands:\033[0m")
        print("  help              Show this help")
        print("  history           Show command history")
        print("  status            Show status of the current mission")
        print("  plan              Show the current mission plan")
        print("  artifacts         List mission artifacts")
        print("  show <id|index>   Show content of an artifact")
        print("  refine <feedback> Refine the mission with feedback")
        print("  exit | quit       Exit shell")
        print("  <objective>       Plan and execute a new mission")

    async def get_mission_summary(self) -> dict[str, Any] | None:
        path = Path(self.workspace_root) / ".jeanbot" / "missions" / self.mission_id / "mission-run.json"
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    async def show_status(self):
        summary = await self.get_mission_summary()
        if not summary:
            print("No active mission.")
            return

        res = summary.get("result", {})
        print(f"\033[1mMission Status:\033[0m {res.get('status', 'unknown')}")
        print(f"Summary: {res.get('verification_summary', 'N/A')}")
        metrics = res.get("metrics", {})
        print(f"Progress: {metrics.get('completed_steps', 0)}/{metrics.get('total_steps', 0)} steps")

    async def show_plan(self):
        path = Path(self.workspace_root) / ".jeanbot" / "missions" / self.mission_id / "mission-payload.json"
        if not path.exists():
            print("No plan found.")
            return
        payload = json.loads(path.read_text(encoding="utf-8"))
        print(f"\033[1mPlan (v{payload.get('plan_version', 1)}):\033[0m")
        for step in payload.get("steps", []):
            status_color = "\033[32m" if step.get("status") == "completed" else "\033[33m"
            print(f"  {status_color}•\033[0m [{step.get('id')}] {step.get('title')} ({step.get('status')})")

    async def show_artifacts(self):
        summary = await self.get_mission_summary()
        if not summary or "result" not in summary:
            print("No artifacts found.")
            return

        artifacts = summary["result"].get("artifacts", [])
        if not artifacts:
            print("No artifacts generated yet.")
            return

        print("\033[1mArtifacts:\033[0m")
        for i, art in enumerate(artifacts, 1):
            print(f"  {i}. \033[34m{art.get('id')[:8]}\033[0m: {art.get('title')} ({art.get('kind')})")

    async def show_artifact(self, arg: str):
        summary = await self.get_mission_summary()
        if not summary or "result" not in summary:
            print("No mission data.")
            return

        artifacts = summary["result"].get("artifacts", [])
        if not artifacts:
            print("No artifacts.")
            return

        target = None
        if arg.isdigit():
            idx = int(arg) - 1
            if 0 <= idx < len(artifacts):
                target = artifacts[idx]
        else:
            target = next((a for a in artifacts if a.get("id").startswith(arg)), None)

        if not target:
            print(f"Artifact '{arg}' not found.")
            return

        path = Path(target.get("path"))
        if not path.is_absolute():
            path = Path(self.workspace_root) / path

        if path.exists():
            content = path.read_text(encoding="utf-8")
            print(f"\n--- \033[1m{target.get('title')}\033[0m ---\n")
            print(render_markdown(content))
        else:
            print(f"File not found: {path}")

    async def refine_mission(self, feedback: str):
        if not self.last_result:
            print("Run a mission first.")
            return

        if not feedback:
            print("Refine requires feedback text.")
            return

        objective = (
            f"Refine previous mission results based on: {feedback}\n"
            f"Previous summary: {self.last_result.verification_summary}"
        )
        await self.execute_objective(objective, title=f"Refine: {feedback[:30]}...")

    async def execute_objective(self, objective: str, title: str | None = None):
        if not title:
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

        print(f"\n\033[1mStatus:\033[0m {self.last_result.status}")
        print(f"Summary: {self.last_result.verification_summary}")
        if self.last_result.artifacts:
            print(f"Artifacts: {len(self.last_result.artifacts)}")


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


async def run_command(args: argparse.Namespace) -> dict:
    if args.command == "write-template":
        service = MissionExecutorService(workspace_root=".")
        path = service.write_payload_template(args.output)
        return {"command": "write-template", "output": str(Path(path))}

    if args.command == "shell":
        shell = InteractiveShell(
            workspace_root=args.workspace_root,
            mode=args.mode,
            workspace_id=args.workspace_id
        )
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
    if args.command != "shell":
        print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
