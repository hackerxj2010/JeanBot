from __future__ import annotations

import argparse
import asyncio
import json
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
    shell_parser.add_argument("--mission-id", help="Resume from a specific mission ID")

    return parser


class InteractiveShell:
    def __init__(self, service: MissionExecutorService, workspace_id: str, mode: str, mission_id: str | None = None):
        self.service = service
        self.workspace_id = workspace_id
        self.mode = mode
        self.last_result = None
        self.current_mission_id = mission_id or f"shell-{uuid.uuid4().hex[:8]}"
        self.history: list[str] = []

    def _print_color(self, text: str, color_code: str):
        print(f"\033[{color_code}m{text}\033[0m")

    def print_blue(self, text: str): self._print_color(text, "94")
    def print_green(self, text: str): self._print_color(text, "92")
    def print_yellow(self, text: str): self._print_color(text, "93")
    def print_red(self, text: str): self._print_color(text, "91")
    def print_bold(self, text: str): self._print_color(text, "1")

    async def run(self):
        try:
            import readline  # Enable history and line editing
        except ImportError:
            pass

        self.print_bold(f"JeanBot interactive shell ({self.mode} mode)")
        self.print_blue(f"Workspace: {self.service.workspace_root} ({self.workspace_id})")

        # Check for existing mission
        summary = self.service.get_mission_run_summary(self.current_mission_id)
        if summary:
            self.print_green(f"Resumed mission: {self.current_mission_id}")
            self.print_blue(f"Current Objective: {summary.get('mission', {}).get('objective', 'N/A')}")
        else:
            self.print_blue(f"New Session: {self.current_mission_id}")

        print("Type 'exit' or 'quit' to end session. Type 'help' for commands.")

        while True:
            try:
                line = input(f"\njeanbot:{self.current_mission_id}> ").strip()
                if not line:
                    continue
                if line.lower() in ("exit", "quit"):
                    break

                self.history.append(line)
                await self.handle_command(line)

            except KeyboardInterrupt:
                print("\nInterrupt received, type 'exit' to quit.")
            except Exception as e:
                self.print_red(f"\nError: {e}")

    async def handle_command(self, line: str):
        parts = line.split()
        cmd = parts[0].lower()

        if cmd == "help":
            print("Commands:")
            print("  help              Show this help")
            print("  history           Show command history")
            print("  plan              Show the current mission plan")
            print("  artifacts         List mission artifacts")
            print("  show <id|path>    Show artifact content")
            print("  exit | quit       Exit shell")
            print("  <objective>       Plan and execute a mission")
            print("  refine <feedback> Refine the last mission result with feedback")
        elif cmd == "history":
            for i, cmd_str in enumerate(self.history, 1):
                print(f"  {i:3}  {cmd_str}")
        elif cmd == "plan":
            await self.show_plan()
        elif cmd == "artifacts":
            await self.show_artifacts()
        elif cmd == "show":
            if len(parts) < 2:
                self.print_yellow("Usage: show <artifact_id | artifact_path>")
                return
            await self.show_artifact(parts[1])
        elif cmd == "refine":
            if not self.last_result:
                # Try to load last result if we resumed
                summary = self.service.get_mission_run_summary(self.current_mission_id)
                if not summary:
                    self.print_yellow("Nothing to refine. Run a mission first.")
                    return

            feedback = " ".join(parts[1:])
            objective = (
                f"Refine previous mission results based on: {feedback}\n"
            )
            if self.last_result:
                objective += f"Previous summary: {self.last_result.verification_summary}"

            await self.execute_mission(
                title=f"Refinement: {feedback[:30]}...",
                objective=objective
            )
        else:
            await self.execute_mission(
                title=f"Mission: {line[:30]}...",
                objective=line
            )

    async def show_plan(self):
        summary = self.service.get_mission_run_summary(self.current_mission_id)
        if not summary:
            self.print_yellow("No active mission plan found.")
            return

        result = summary.get("result", {})
        steps = result.get("step_reports", [])

        self.print_bold(f"\nPlan for Mission: {summary.get('mission', {}).get('title', 'N/A')}")
        self.print_blue(f"Status: {result.get('status', 'unknown')}")

        for step in steps:
            diag = step.get("diagnostics")
            status = "[Done]" if diag and diag.get("failure_class") == "none" else "[Pending]"
            color = self.print_green if status == "[Done]" else self.print_yellow
            color(f"  {status} {step.get('step_id')}: {step.get('summary')}")

    async def show_artifacts(self):
        summary = self.service.get_mission_run_summary(self.current_mission_id)
        if not summary:
            self.print_yellow("No active mission found.")
            return

        artifacts = summary.get("result", {}).get("artifacts", [])
        if not artifacts:
            print("No artifacts found.")
            return

        self.print_bold(f"\nArtifacts for {self.current_mission_id}:")
        for i, artifact in enumerate(artifacts):
            print(f"  [{i}] {artifact.get('title')} ({artifact.get('kind')})")
            print(f"      Path: {artifact.get('path')}")

    async def show_artifact(self, target: str):
        summary = self.service.get_mission_run_summary(self.current_mission_id)
        if not summary:
            self.print_yellow("No active mission found.")
            return

        artifacts = summary.get("result", {}).get("artifacts", [])
        path = None

        if target.isdigit():
            idx = int(target)
            if 0 <= idx < len(artifacts):
                path = artifacts[idx].get("path")
        else:
            for a in artifacts:
                if a.get("id") == target or a.get("path") == target:
                    path = a.get("path")
                    break

        if not path:
            self.print_red(f"Artifact not found: {target}")
            return

        try:
            content = Path(path).read_text(encoding="utf-8")
            self.print_blue(f"\n--- Content of {path} ---")
            print(content)
            self.print_blue("--- End of Content ---")
        except Exception as e:
            self.print_red(f"Error reading artifact: {e}")

    async def execute_mission(self, title: str, objective: str):
        # Preview plan logic
        self.print_blue(f"\nProposed Mission: {title}")
        print(f"Objective: {objective}")

        # In a real scenario, we might call a planning-only method here.
        # For now, we ask for approval to proceed with execution.
        confirm = input("\nProceed with execution? [Y/n]: ").strip().lower()
        if confirm not in ("", "y", "yes"):
            self.print_yellow("Mission cancelled.")
            return

        payload = {
            "mission_id": self.current_mission_id,
            "workspace_id": self.workspace_id,
            "title": title,
            "objective": objective,
            "mode": self.mode,
        }

        self.print_blue(f"Executing...")
        self.last_result = await self.service.execute_payload(payload)

        status_color = self.print_green if self.last_result.status == "completed" else self.print_red
        status_color(f"\nStatus: {self.last_result.status}")
        print(f"Summary: {self.last_result.verification_summary}")

        if self.last_result.artifacts:
            self.print_bold(f"Artifacts: {len(self.last_result.artifacts)}")
            for artifact in self.last_result.artifacts:
                print(f"  - {artifact.title}: {artifact.path}")


async def run_shell(args: argparse.Namespace):
    service = MissionExecutorService(workspace_root=args.workspace_root, mode=args.mode)
    shell = InteractiveShell(service, args.workspace_id, args.mode, mission_id=args.mission_id)
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
