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

    plan_parser = subparsers.add_parser("plan", help="Plan a mission without executing it")
    plan_parser.add_argument("--objective", required=True, help="Mission objective")
    plan_parser.add_argument("--workspace-root", required=True, help="Workspace root path")
    plan_parser.add_argument("--title", help="Mission title")

    shell_parser = subparsers.add_parser("shell", help="Start interactive mission shell")
    shell_parser.add_argument("--workspace-root", required=True, help="Workspace root path")
    shell_parser.add_argument("--workspace-id", default="workspace-interactive", help="Workspace ID")
    shell_parser.add_argument("--mode", choices=["local", "live"], default="local", help="Execution mode")

    return parser


class InteractiveShell:
    def __init__(self, service: MissionExecutorService, workspace_id: str, mode: str):
        self.service = service
        self.workspace_id = workspace_id
        self.mode = mode
        self.history: list[str] = []
        self.missions: list[str] = []
        self.last_mission_id: str | None = None

        try:
            import readline  # Enable history and line editing
        except ImportError:
            pass

    def _print_status(self, mission_id: str):
        summary = self.service.get_mission_run_summary(mission_id)
        if not summary:
            print(f"No run summary found for mission {mission_id}")
            return

        res = summary.get("result", {})
        status = res.get("status", "unknown")

        # ANSI Colors
        GREEN = "\033[92m"
        RED = "\033[91m"
        CYAN = "\033[96m"
        BOLD = "\033[1m"
        RESET = "\033[0m"

        color = GREEN if status == "completed" else RED if status == "failed" else RESET

        print(f"\n{BOLD}Mission Status: {color}{status.upper()}{RESET}")
        print(f"{BOLD}Title:{RESET} {summary.get('mission', {}).get('title')}")
        print(f"{BOLD}Summary:{RESET} {res.get('verification_summary')}")

        metrics = res.get("metrics", {})
        if metrics:
            print(f"{BOLD}Metrics:{RESET} {metrics.get('completed_steps')}/{metrics.get('total_steps')} steps, score: {metrics.get('average_score')}")

        artifacts = res.get("artifacts", [])
        if artifacts:
            print(f"{BOLD}Artifacts ({len(artifacts)}):{RESET}")
            for a in artifacts:
                print(f"  - {CYAN}{a.get('title')}{RESET}: {a.get('path')}")

    async def run(self):
        print(f"JeanBot interactive shell ({self.mode} mode)")
        print(f"Workspace: {self.service.workspace_root} ({self.workspace_id})")
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
                    print("Commands:")
                    print("  help              Show this help")
                    print("  history           Show command history")
                    print("  status            Show status of the last mission")
                    print("  exit | quit       Exit shell")
                    print("  <objective>       Plan and execute a mission")
                    print("  refine <feedback> Refine the last mission result with feedback")
                    continue

                if line.lower() == "history":
                    for i, cmd in enumerate(self.history, 1):
                        print(f"  {i:3}  {cmd}")
                    continue

                if line.lower() == "status":
                    m_id = self.last_mission_id or self.service.get_last_mission_id()
                    if m_id:
                        self._print_status(m_id)
                    else:
                        print("No mission history found.")
                    continue

                current_mission_id = self.last_mission_id or f"shell-{uuid.uuid4().hex[:8]}"

                if line.lower().startswith("refine "):
                    if not self.last_mission_id:
                        print("Nothing to refine. Run a mission first.")
                        continue

                    summary = self.service.get_mission_run_summary(self.last_mission_id)
                    prev_summary = summary.get("result", {}).get("verification_summary") if summary else "None"

                    feedback = line[7:].strip()
                    objective = (
                        f"Refine previous mission results based on: {feedback}\n"
                        f"Previous summary: {prev_summary}"
                    )
                    title = f"Refinement: {feedback[:30]}..."
                else:
                    current_mission_id = f"shell-{uuid.uuid4().hex[:8]}"
                    objective = line
                    title = f"Mission: {line[:30]}..."

                payload = {
                    "mission_id": current_mission_id,
                    "workspace_id": self.workspace_id,
                    "title": title,
                    "objective": objective,
                    "mode": self.mode,
                }

                print(f"Executing: {title} ({current_mission_id})")
                result = await self.service.execute_payload(payload)
                self.last_mission_id = result.mission_id
                self.missions.append(result.mission_id)

                self._print_status(result.mission_id)

            except KeyboardInterrupt:
                print("\nInterrupt received, type 'exit' to quit.")
            except Exception as e:
                print(f"\nError: {e}")


async def run_shell(args: argparse.Namespace):
    service = MissionExecutorService(workspace_root=args.workspace_root, mode=args.mode)
    shell = InteractiveShell(service, args.workspace_id, args.mode)
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

    if args.command == "plan":
        payload = {
            "workspace_id": "workspace-plan",
            "title": args.title or f"Plan: {args.objective[:30]}",
            "objective": args.objective,
        }
        plan = service.plan_mission(payload)
        return {
            "command": "plan",
            "summary": plan.summary,
            "steps": [
                {"id": s.id, "title": s.title, "capability": s.capability}
                for s in plan.steps
            ],
        }

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
