from __future__ import annotations

import argparse
import asyncio
import json
import re
import uuid
from pathlib import Path
from typing import Sequence, Any

from .service import MissionExecutorService


def render_markdown(text: str) -> str:
    """Basic ANSI markdown renderer for terminal."""
    # Headers
    text = re.sub(r'^# (.*)$', r'\033[1;34m\1\033[0m', text, flags=re.MULTILINE)
    text = re.sub(r'^## (.*)$', r'\033[1;36m\1\033[0m', text, flags=re.MULTILINE)
    text = re.sub(r'^### (.*)$', r'\033[1;32m\1\033[0m', text, flags=re.MULTILINE)

    # Bold
    text = re.sub(r'\*\*(.*?)\*\*', r'\033[1m\1\033[0m', text)

    # Lists
    text = re.sub(r'^- (.*)$', r'  • \1', text, flags=re.MULTILINE)

    return text


class InteractiveShell:
    def __init__(self, workspace_root: str, workspace_id: str, mode: str):
        self.workspace_root = workspace_root
        self.workspace_id = workspace_id
        self.mode = mode
        self.service = MissionExecutorService(workspace_root=workspace_root, mode=mode)
        self.mission_id = f"shell-{uuid.uuid4().hex[:8]}"
        self.history: list[str] = []
        self.last_result: Any = None

    async def run(self):
        try:
            import readline
        except ImportError:
            pass

        print(f"\033[1;34mJeanBot interactive shell\033[0m ({self.mode} mode)")
        print(f"Workspace: {self.workspace_root} ({self.workspace_id})")
        print("Type 'help' for commands, 'exit' to quit.")

        while True:
            try:
                line = input(f"\n\033[1;32mjeanbot\033[0m> ").strip()
                if not line:
                    continue
                if line.lower() in ("exit", "quit"):
                    break

                self.history.append(line)

                if line.lower() == "help":
                    self.cmd_help()
                elif line.lower() == "history":
                    self.cmd_history()
                elif line.lower() == "plan":
                    self.cmd_plan()
                elif line.lower() == "artifacts":
                    self.cmd_artifacts()
                elif line.lower().startswith("show "):
                    self.cmd_show(line[5:].strip())
                elif line.lower() == "status":
                    self.cmd_status()
                elif line.lower().startswith("refine "):
                    await self.cmd_refine(line[7:].strip())
                else:
                    await self.cmd_execute(line)

            except KeyboardInterrupt:
                print("\nInterrupt received, type 'exit' to quit.")
            except Exception as e:
                print(f"\n\033[1;31mError:\033[0m {e}")

    def cmd_help(self):
        print("\033[1mAvailable commands:\033[0m")
        print("  help              Show this help")
        print("  history           Show command history")
        print("  plan              Show the current mission plan")
        print("  status            Show progress and step results")
        print("  artifacts         List generated artifacts")
        print("  show <id>         Display artifact content (id can be index or path)")
        print("  refine <feedback> Refine the last mission result with feedback")
        print("  exit | quit       Exit shell")
        print("  <objective>       Plan and execute a new mission")

    def cmd_history(self):
        for i, cmd in enumerate(self.history, 1):
            print(f"  {i:3}  {cmd}")

    def cmd_plan(self):
        payload = self.service.get_mission_payload(self.mission_id)
        if not payload:
            print("No active mission plan.")
            return

        print(f"\033[1mPlan for mission: {payload.get('title')}\033[0m")
        for step in payload.get("steps", []):
            status_color = "\033[32m" if step.get("status") == "completed" else "\033[33m"
            print(f"  - {step.get('id')}: {step.get('title')} [{status_color}{step.get('status')}\033[0m]")

    def cmd_artifacts(self):
        summary = self.service.get_mission_run_summary(self.mission_id)
        if not summary:
            print("No artifacts found.")
            return

        res = summary.get("result", {})
        artifacts = res.get("artifacts", []) if isinstance(res, dict) else []
        if not artifacts:
            print("No artifacts generated yet.")
            return

        print(f"\033[1mArtifacts for mission: {self.mission_id}\033[0m")
        for i, art in enumerate(artifacts):
            title = art.get("title") if isinstance(art, dict) else getattr(art, 'title', 'Unknown')
            path = art.get("path") if isinstance(art, dict) else getattr(art, 'path', 'Unknown')
            print(f"  [{i}] {title} -> {path}")

    def cmd_show(self, art_id: str):
        summary = self.service.get_mission_run_summary(self.mission_id)
        if not summary:
            print("No artifacts to show.")
            return

        res = summary.get("result", {})
        artifacts = res.get("artifacts", []) if isinstance(res, dict) else []

        path = None
        try:
            idx = int(art_id)
            if 0 <= idx < len(artifacts):
                art = artifacts[idx]
                path = art.get("path") if isinstance(art, dict) else getattr(art, 'path', None)
        except ValueError:
            path = art_id

        if not path or not Path(path).exists():
            print(f"Artifact not found: {art_id}")
            return

        content = Path(path).read_text(encoding="utf-8")
        print("\n--- Artifact Content ---")
        print(render_markdown(content))
        print("--- End of Content ---")

    def cmd_status(self):
        summary = self.service.get_mission_run_summary(self.mission_id)
        if not summary:
            print("No active mission status.")
            return

        res = summary.get("result", {})
        if not isinstance(res, dict):
            print("Status unavailable.")
            return

        print(f"\033[1mStatus:\033[0m {res.get('status')}")
        print(f"\033[1mSummary:\033[0m {res.get('verification_summary')}")

        reports = res.get("step_reports", [])
        if reports:
            print("\033[1mStep Reports:\033[0m")
            for r in reports:
                diag = r.get("diagnostics", {})
                score = diag.get("overall_score", 0.0)
                print(f"  - {r.get('step_id')}: score={score:.2f} summary={r.get('summary')}")

    async def cmd_refine(self, feedback: str):
        if not self.last_result:
            print("Nothing to refine. Run a mission first.")
            return

        objective = (
            f"Refine previous mission results based on: {feedback}\n"
            f"Previous summary: {self.last_result.verification_summary}"
        )
        payload = {
            "mission_id": self.mission_id,
            "workspace_id": self.workspace_id,
            "title": f"Refinement: {feedback[:30]}...",
            "objective": objective,
            "mode": self.mode,
        }
        print(f"Refining: {payload['title']}")
        self.last_result = await self.service.execute_payload(payload)
        self._print_result()

    async def cmd_execute(self, objective: str):
        payload = {
            "mission_id": self.mission_id,
            "workspace_id": self.workspace_id,
            "title": f"Mission: {objective[:30]}...",
            "objective": objective,
            "mode": self.mode,
        }
        print(f"Executing: {payload['title']}")
        self.last_result = await self.service.execute_payload(payload)
        self._print_result()

    def _print_result(self):
        if not self.last_result:
            return
        print(f"\n\033[1mStatus:\033[0m {self.last_result.status}")
        print(f"\033[1mSummary:\033[0m {self.last_result.verification_summary}")
        if self.last_result.artifacts:
            print(f"\033[1mArtifacts:\033[0m {len(self.last_result.artifacts)} generated. Type 'artifacts' to list.")


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
            workspace_id=args.workspace_id,
            mode=args.mode
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
    if payload.get("command") != "shell":
        print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
