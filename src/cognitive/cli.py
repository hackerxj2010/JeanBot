from __future__ import annotations

import argparse
import asyncio
import json
import re
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
    shell_parser.add_argument(
        "--workspace-id", default="workspace-interactive", help="Workspace ID"
    )
    shell_parser.add_argument(
        "--mode", choices=["local", "live"], default="local", help="Execution mode"
    )
    shell_parser.add_argument("--mission-id", help="Resume a mission by ID")

    return parser


class InteractiveShell:
    def __init__(self, workspace_root: str, workspace_id: str, mode: str):
        self.service = MissionExecutorService(workspace_root=workspace_root, mode=mode)
        self.workspace_id = workspace_id
        self.mode = mode
        self.mission_id = f"shell-{uuid.uuid4().hex[:8]}"
        self.last_result = None
        self.history: list[str] = []

    def render_markdown(self, text: str):
        # Very basic ANSI coloring for markdown-ish text
        text = re.sub(r"^# (.*)$", r"\033[1;34m\1\033[0m", text, flags=re.MULTILINE)
        text = re.sub(r"^## (.*)$", r"\033[1;36m\1\033[0m", text, flags=re.MULTILINE)
        text = re.sub(r"\*\*(.*?)\*\*", r"\033[1m\1\033[0m", text)
        text = re.sub(r"^- (.*)$", r"  • \1", text, flags=re.MULTILINE)
        print(text)

    async def run(self, resume_id: str | None = None):
        try:
            import readline  # Enable history and line editing
        except ImportError:
            pass

        if resume_id:
            self.mission_id = resume_id
            print(f"Resuming mission: {resume_id}")
            summary = self.service.get_mission_run_summary(resume_id)
            if summary and "result" in summary:
                # Reconstruct a basic result object for 'last_result'
                from dataclasses import dataclass

                @dataclass
                class MockResult:
                    status: str
                    verification_summary: str
                    artifacts: list
                    mission_id: str

                res = summary["result"]
                artifacts = []
                for a in res.get("artifacts", []):
                    from .executor import MissionArtifact

                    artifacts.append(MissionArtifact(**a))

                self.last_result = MockResult(
                    status=res.get("status", "unknown"),
                    verification_summary=res.get("verification_summary", ""),
                    artifacts=artifacts,
                    mission_id=resume_id,
                )

        print(f"\033[1;32mJeanBot Interactive Shell\033[0m ({self.mode} mode)")
        print(f"Workspace: {self.service.workspace_root} ({self.workspace_id})")
        print(f"Mission ID: {self.mission_id}")
        print("Type 'help' for commands.")

        while True:
            try:
                line = input("\n\033[1;34mjeanbot>\033[0m ").strip()
                if not line:
                    continue
                if line.lower() in ("exit", "quit"):
                    break

                self.history.append(line)

                if line.lower() == "help":
                    self.show_help()
                elif line.lower() == "history":
                    self.show_history()
                elif line.lower() == "status":
                    await self.show_status()
                elif line.lower() == "artifacts":
                    self.show_artifacts()
                elif line.lower() == "plan":
                    self.show_plan()
                elif line.lower().startswith("show "):
                    self.show_artifact_content(line[5:].strip())
                elif line.lower().startswith("refine "):
                    await self.refine_mission(line[7:].strip())
                else:
                    await self.execute_mission(line)

            except KeyboardInterrupt:
                print("\nInterrupt received, type 'exit' to quit.")
            except Exception as e:
                print(f"\n\033[1;31mError:\033[0m {e}")

    def show_help(self):
        print("\033[1mCommands:\033[0m")
        print("  \033[36mhelp\033[0m              Show this help")
        print("  \033[36mstatus\033[0m            Show current mission status")
        print("  \033[36mplan\033[0m              Show the current mission plan")
        print("  \033[36martifacts\033[0m         List generated artifacts")
        print("  \033[36mshow <index|id>\033[0m   View artifact content")
        print("  \033[36mrefine <feedback>\033[0m Refine the last mission result with feedback")
        print("  \033[36mhistory\033[0m           Show command history")
        print("  \033[36mexit | quit\033[0m       Exit shell")
        print("  \033[36m<objective>\033[0m       Plan and execute a new mission")

    def show_history(self):
        for i, cmd in enumerate(self.history, 1):
            print(f"  {i:3}  {cmd}")

    async def show_status(self):
        summary = self.service.get_mission_run_summary(self.mission_id)
        if not summary:
            print("No active mission found.")
            return

        res = summary.get("result", {})
        print(f"\033[1mStatus:\033[0m {res.get('status', 'unknown')}")
        print(f"\033[1mSummary:\033[0m {res.get('verification_summary', 'N/A')}")

        metrics = res.get("metrics", {})
        if metrics:
            print(
                f"\033[1mProgress:\033[0m {metrics.get('completed_steps', 0)}/{metrics.get('total_steps', 0)} steps completed"
            )

    def show_artifacts(self):
        if not self.last_result or not self.last_result.artifacts:
            print("No artifacts found.")
            return

        print("\033[1mArtifacts:\033[0m")
        for i, artifact in enumerate(self.last_result.artifacts, 1):
            print(f"  [{i}] \033[32m{artifact.id[:8]}\033[0m: {artifact.title} ({artifact.kind})")

    def show_plan(self):
        summary = self.service.get_mission_run_summary(self.mission_id)
        if not summary or "steps" not in summary:
            print("No plan found.")
            return

        print(f"\033[1mPlan (v{summary.get('plan_version', 1)}):\033[0m")
        for step in summary["steps"]:
            status_color = "\033[32m" if step.get("status") == "completed" else "\033[33m"
            print(f"  - [{status_color}{step.get('status', 'pending')}\033[0m] {step.get('title')}")

    def show_artifact_content(self, target: str):
        if not self.last_result or not self.last_result.artifacts:
            print("No artifacts available.")
            return

        artifact = None
        if target.isdigit():
            idx = int(target) - 1
            if 0 <= idx < len(self.last_result.artifacts):
                artifact = self.last_result.artifacts[idx]
        else:
            artifact = next((a for a in self.last_result.artifacts if a.id.startswith(target)), None)

        if not artifact:
            print(f"Artifact '{target}' not found.")
            return

        path = Path(artifact.path)
        if path.exists():
            print(f"\n\033[1;35m--- {artifact.title} ---\033[0m")
            content = path.read_text(encoding="utf-8")
            if artifact.kind == "log" or artifact.path.endswith(".md"):
                self.render_markdown(content)
            else:
                print(content)
            print("\033[1;35m---\033[0m")
        else:
            print(f"Artifact file not found: {artifact.path}")

    async def execute_mission(self, objective: str):
        title = f"Mission: {objective[:30]}..."
        payload = {
            "mission_id": self.mission_id,
            "workspace_id": self.workspace_id,
            "title": title,
            "objective": objective,
            "mode": self.mode,
        }

        print(f"\033[1mExecuting:\033[0m {title}")
        self.last_result = await self.service.execute_payload(payload)

        print(f"\n\033[1mStatus:\033[0m {self.last_result.status}")
        print(f"\033[1mSummary:\033[0m {self.last_result.verification_summary}")
        if self.last_result.artifacts:
            print(f"Artifacts: {len(self.last_result.artifacts)} generated.")

    async def refine_mission(self, feedback: str):
        if not self.last_result:
            # Try to load last result from summary if available
            summary = self.service.get_mission_run_summary(self.mission_id)
            if not summary or "result" not in summary:
                print("Nothing to refine. Run a mission first.")
                return

        objective = (
            f"Refine previous mission results based on: {feedback}\n"
            f"Previous summary: {self.last_result.verification_summary if self.last_result else 'See logs'}"
        )
        await self.execute_mission(objective)


async def run_command(args: argparse.Namespace) -> dict:
    if args.command == "write-template":
        service = MissionExecutorService(workspace_root=".")
        path = service.write_payload_template(args.output)
        return {"command": "write-template", "output": str(Path(path))}

    if args.command == "shell":
        shell = InteractiveShell(
            workspace_root=args.workspace_root,
            workspace_id=args.workspace_id,
            mode=args.mode,
        )
        await shell.run(resume_id=args.mission_id)
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
