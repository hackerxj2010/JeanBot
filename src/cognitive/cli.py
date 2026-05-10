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
    """Basic Markdown to ANSI renderer for terminal display."""
    # Headers
    text = re.sub(r"^# (.*)$", r"\033[1;34m\1\033[0m", text, flags=re.MULTILINE)
    text = re.sub(r"^## (.*)$", r"\033[1;32m\1\033[0m", text, flags=re.MULTILINE)
    text = re.sub(r"^### (.*)$", r"\033[1;36m\1\033[0m", text, flags=re.MULTILINE)

    # Bold
    text = re.sub(r"\*\*(.*?)\*\*", r"\033[1m\1\033[0m", text)

    # Lists
    text = re.sub(r"^- (.*)$", r"  • \1", text, flags=re.MULTILINE)

    return text


class InteractiveShell:
    def __init__(self, workspace_root: str, workspace_id: str, mode: str = "local"):
        self.service = MissionExecutorService(workspace_root=workspace_root, mode=mode)
        self.workspace_root = workspace_root
        self.workspace_id = workspace_id
        self.mode = mode
        self.mission_id = f"shell-{uuid.uuid4().hex[:8]}"
        self.history: list[str] = []
        self.last_result: Any = None

    async def start(self):
        try:
            import readline  # Enable history and line editing
        except ImportError:
            pass

        print(f"\033[1;35mJeanBot interactive shell\033[0m ({self.mode} mode)")
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
                await self.handle_command(line)

            except KeyboardInterrupt:
                print("\nInterrupt received, type 'exit' to quit.")
            except Exception as e:
                print(f"\n\033[1;31mError:\033[0m {e}")

    async def handle_command(self, line: str):
        parts = line.split(maxsplit=1)
        command = parts[0].lower()
        args = parts[1] if len(parts) > 1 else ""

        if command == "help":
            self.show_help()
        elif command == "history":
            self.show_history()
        elif command == "status":
            self.show_status()
        elif command == "artifacts":
            self.show_artifacts()
        elif command == "show":
            await self.show_artifact(args)
        elif command == "refine":
            await self.refine_mission(args)
        else:
            await self.execute_mission(line)

    def show_help(self):
        print("\033[1mAvailable Commands:\033[0m")
        print("  help              Show this help")
        print("  history           Show command history")
        print("  status            Show status of the current mission")
        print("  artifacts         List generated artifacts")
        print("  show <id/index>   Show content of an artifact")
        print("  refine <feedback> Refine the last mission result with feedback")
        print("  exit | quit       Exit shell")
        print("  <objective>       Plan and execute a new mission")

    def show_history(self):
        for i, cmd in enumerate(self.history, 1):
            print(f"  {i:3}  {cmd}")

    def show_status(self):
        if not self.last_result:
            print("No active mission.")
            return

        res = self.last_result
        # Handle both dict-like and object-like result access
        status = getattr(res, "status", None) or res.get("status", "unknown")
        summary = getattr(res, "verification_summary", None) or res.get("verification_summary", "")
        steps = getattr(res, "step_reports", []) or res.get("step_reports", [])

        print(f"\033[1mCurrent Mission Status:\033[0m {status}")
        print(f"Summary: {summary}")
        print(f"Steps: {len(steps)}")

        for step in steps:
            step_id = getattr(step, "step_id", None) or step.get("step_id")
            diag = getattr(step, "diagnostics", None) or step.get("diagnostics")
            score = 0.0
            if diag:
                score = getattr(diag, "overall_score", 0.0) if hasattr(diag, "overall_score") else diag.get("overall_score", 0.0)

            print(f"  - {step_id}: score={score:.2f}")

    def show_artifacts(self):
        if not self.last_result:
            print("No artifacts available.")
            return

        artifacts = getattr(self.last_result, "artifacts", []) or self.last_result.get("artifacts", [])
        if not artifacts:
            print("No artifacts generated.")
            return

        print(f"\033[1mArtifacts ({len(artifacts)}):\033[0m")
        for i, artifact in enumerate(artifacts, 1):
            title = getattr(artifact, "title", None) or artifact.get("title")
            art_id = getattr(artifact, "id", None) or artifact.get("id")
            print(f"  {i:2}. [{art_id[:8]}] {title}")

    async def show_artifact(self, arg: str):
        if not self.last_result:
            print("No mission executed yet.")
            return

        artifacts = getattr(self.last_result, "artifacts", []) or self.last_result.get("artifacts", [])
        if not artifacts:
            print("No artifacts available.")
            return

        selected = None
        if arg.isdigit():
            idx = int(arg) - 1
            if 0 <= idx < len(artifacts):
                selected = artifacts[idx]
        else:
            for art in artifacts:
                art_id = getattr(art, "id", None) or art.get("id")
                if art_id.startswith(arg):
                    selected = art
                    break

        if not selected:
            print(f"Artifact '{arg}' not found.")
            return

        path_str = getattr(selected, "path", None) or selected.get("path")
        path = Path(path_str)
        if not path.exists():
            print(f"File not found: {path}")
            return

        content = path.read_text(encoding="utf-8")
        print(f"\n\033[1;34m--- {getattr(selected, 'title', 'Artifact')} ---\033[0m\n")
        print(render_markdown(content))
        print(f"\n\033[1;34m--- End of Artifact ---\033[0m")

    async def refine_mission(self, feedback: str):
        if not self.last_result:
            print("Nothing to refine. Run a mission first.")
            return

        if not feedback:
            print("Refinement requires feedback text.")
            return

        summary = getattr(self.last_result, "verification_summary", None) or self.last_result.get("verification_summary", "")
        objective = (
            f"Refine previous mission results based on: {feedback}\n"
            f"Previous summary: {summary}"
        )
        title = f"Refinement: {feedback[:30]}..."
        await self.execute_mission(objective, title)

    async def execute_mission(self, objective: str, title: str | None = None):
        if not title:
            title = f"Mission: {objective[:30]}..."

        payload = {
            "mission_id": self.mission_id,
            "workspace_id": self.workspace_id,
            "title": title,
            "objective": objective,
            "mode": self.mode,
        }

        print(f"\n\033[1;33mExecuting:\033[0m {title}")
        self.last_result = await self.service.execute_payload(payload)

        status = getattr(self.last_result, "status", None) or self.last_result.get("status", "unknown")
        summary = getattr(self.last_result, "verification_summary", None) or self.last_result.get("verification_summary", "")
        artifacts = getattr(self.last_result, "artifacts", []) or self.last_result.get("artifacts", [])

        print(f"\n\033[1mStatus:\033[0m {status}")
        print(f"Summary: {summary}")
        if artifacts:
            print(f"Artifacts: {len(artifacts)} (type 'artifacts' to list)")


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
    if payload:
        print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
