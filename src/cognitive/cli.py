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

    plan_parser = subparsers.add_parser("plan", help="Plan a mission without executing")
    plan_parser.add_argument("--mission-file", required=True, help="Mission payload JSON file")
    plan_parser.add_argument("--workspace-root", required=True, help="Workspace root path")

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
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.service = MissionExecutorService(workspace_root=args.workspace_root, mode=args.mode)
        self.history: list[str] = []
        self.last_result = None
        self.missions: list[Any] = []
        self.session_id = f"shell-{uuid.uuid4().hex[:8]}"

    async def run(self):
        try:
            import readline  # Enable history and line editing
        except ImportError:
            pass

        print(f"JeanBot interactive shell ({self.args.mode} mode)")
        print(f"Workspace: {self.args.workspace_root} ({self.args.workspace_id})")
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
                    self._show_help()
                    continue

                if line.lower() == "history":
                    self._show_history()
                    continue

                if line.lower() == "status":
                    self._show_status()
                    continue

                if line.lower() == "artifacts":
                    self._show_artifacts()
                    continue

                if line.lower().startswith("plan "):
                    await self._handle_plan_command(line[5:].strip())
                    continue

                if line.lower().startswith("refine "):
                    await self._handle_refine(line[7:].strip())
                    continue

                # Default: plan and execute mission
                await self._handle_mission(line)

            except KeyboardInterrupt:
                print("\nInterrupt received, type 'exit' to quit.")
            except Exception as e:
                print(f"\nError: {e}")

    def _show_help(self):
        print("Commands:")
        print("  help              Show this help")
        print("  history           Show command history")
        print("  status            Show status of the last mission")
        print("  artifacts         Show artifacts from the last mission")
        print("  plan <objective>  Show plan for an objective without executing")
        print("  exit | quit       Exit shell")
        print("  <objective>       Plan and execute a mission")
        print("  refine <feedback> Refine the last mission result with feedback")

    def _show_history(self):
        for i, cmd in enumerate(self.history, 1):
            print(f"  {i:3}  {cmd}")

    def _show_status(self):
        if not self.last_result:
            print("No mission has been executed yet.")
            return

        res = self.last_result
        print(f"Last Mission: {res.mission_id}")
        print(f"Status: {res.status}")
        print(f"Verification: {res.verification_summary}")
        if res.metrics:
            print("Metrics:")
            for k, v in res.metrics.items():
                print(f"  - {k}: {v}")
        print(f"Artifacts: {len(res.artifacts)}")

    def _show_artifacts(self):
        if not self.last_result:
            print("No mission has been executed yet.")
            return

        if not self.last_result.artifacts:
            print("No artifacts found for the last mission.")
            return

        print(f"Artifacts for mission {self.last_result.mission_id}:")
        for artifact in self.last_result.artifacts:
            print(f"  - {artifact.title} ({artifact.kind}): {artifact.path}")

    async def _handle_plan_command(self, objective: str):
        payload = {
            "workspace_id": self.args.workspace_id,
            "title": f"Plan: {objective[:30]}...",
            "objective": objective,
        }
        print(f"Planning: {objective}")
        plan_summary = await self.service.plan_mission(payload)
        print(f"\nPlan Summary: {plan_summary['summary']}")
        print("Steps:")
        for step in plan_summary["steps"]:
            print(f"  [{step['id']}] {step['title']} ({step['capability']})")

    async def _handle_refine(self, feedback: str):
        if not self.last_result:
            print("Nothing to refine. Run a mission first.")
            return

        objective = (
            f"Refine previous mission results based on: {feedback}\n"
            f"Previous summary: {self.last_result.verification_summary}"
        )
        title = f"Refinement: {feedback[:30]}..."
        await self._execute_mission(title, objective)

    async def _handle_mission(self, objective: str):
        title = f"Mission: {objective[:30]}..."
        await self._execute_mission(title, objective)

    async def _execute_mission(self, title: str, objective: str):
        payload = {
            "mission_id": self.session_id,
            "workspace_id": self.args.workspace_id,
            "title": title,
            "objective": objective,
            "mode": self.args.mode,
        }

        print(f"Executing: {title}")
        result = await self.service.execute_payload(payload)
        self.last_result = result
        self.missions.append(result)

        print(f"\nStatus: {result.status}")
        print(f"Summary: {result.verification_summary}")
        if result.artifacts:
            print(f"Artifacts: {len(result.artifacts)}")
            for artifact in result.artifacts:
                print(f"  - {artifact.title}: {artifact.path}")


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
        return {
            "command": args.command,
            "mission_id": result.mission_id,
            "status": result.status,
            "execution_mode": result.execution_mode,
            "verification_summary": result.verification_summary,
            "artifact_count": len(result.artifacts),
            "step_count": len(result.step_reports),
        }
    elif args.command == "plan":
        result = await service.plan_mission(payload)
        return {
            "command": args.command,
            "mission_id": result["mission_id"],
            "title": result["title"],
            "summary": result["summary"],
            "step_count": len(result["steps"]),
            "steps": result["steps"],
        }
    elif args.command == "finalize-distributed":
        result = await service.finalize_distributed_payload(payload)
        return {
            "command": args.command,
            "mission_id": result.mission_id,
            "status": result.status,
            "execution_mode": result.execution_mode,
            "verification_summary": result.verification_summary,
            "artifact_count": len(result.artifacts),
            "step_count": len(result.step_reports),
        }
    else:
        raise ValueError(f"Unsupported command: {args.command}")


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    payload = asyncio.run(run_command(args))
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
