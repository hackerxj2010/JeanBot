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

    return parser


# Simple ANSI colors for better shell UX
BLUE = "\033[94m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
BOLD = "\033[1m"
RESET = "\033[0m"


async def run_shell(args: argparse.Namespace):
    try:
        import readline  # Enable history and line editing
    except ImportError:
        pass

    service = MissionExecutorService(workspace_root=args.workspace_root, mode=args.mode)
    print(f"{BOLD}JeanBot interactive shell{RESET} ({BLUE}{args.mode}{RESET} mode)")
    print(f"Workspace: {YELLOW}{args.workspace_root}{RESET} ({args.workspace_id})")
    print("Type 'exit' or 'quit' to end session. Type 'help' for commands.")

    last_result = None
    last_mission_id = None
    history: list[str] = []

    while True:
        try:
            line = input(f"\n{BOLD}jeanbot>{RESET} ").strip()
            if not line:
                continue
            if line.lower() in ("exit", "quit"):
                break

            history.append(line)

            if line.lower() == "help":
                print(f"{BOLD}Commands:{RESET}")
                print(f"  {GREEN}help{RESET}              Show this help")
                print(f"  {GREEN}history{RESET}           Show command history")
                print(f"  {GREEN}status{RESET}            Show status of the last mission")
                print(f"  {GREEN}artifacts{RESET}         List artifacts from the last mission")
                print(f"  {GREEN}view <path>{RESET}       View content of an artifact")
                print(f"  {GREEN}exit | quit{RESET}       Exit shell")
                print(f"  {GREEN}<objective>{RESET}       Plan and execute a mission")
                print(f"  {GREEN}refine <feedback>{RESET} Refine the last mission result with feedback")
                continue

            if line.lower() == "history":
                for i, cmd in enumerate(history, 1):
                    print(f"  {i:3}  {cmd}")
                continue

            if line.lower() == "status":
                if not last_mission_id:
                    print(f"{YELLOW}No mission has been run in this session yet.{RESET}")
                    continue

                summary = service.get_mission_run_summary(last_mission_id)
                if not summary:
                    print(f"{RED}Mission summary not found for {last_mission_id}{RESET}")
                    continue

                print(f"{BOLD}Mission Status:{RESET}")
                print(f"  ID: {summary['mission']['id']}")
                print(f"  Title: {summary['mission']['title']}")
                print(f"  Status: {summary['result']['status']}")
                print(f"  Summary: {summary['result']['verification_summary']}")
                print(f"  Gaps: {', '.join(summary['result'].get('gaps', [])) or 'none'}")
                continue

            if line.lower() == "artifacts":
                if not last_mission_id:
                    print(f"{YELLOW}No artifacts found. Run a mission first.{RESET}")
                    continue

                summary = service.get_mission_run_summary(last_mission_id)
                if not summary or not summary.get("artifact_paths"):
                    print(f"{YELLOW}No artifacts found for the last mission.{RESET}")
                    continue

                print(f"{BOLD}Artifacts:{RESET}")
                for path in summary["artifact_paths"]:
                    print(f"  - {path}")
                continue

            if line.lower().startswith("view "):
                if not last_mission_id:
                    print(f"{YELLOW}Run a mission first.{RESET}")
                    continue

                target = line[5:].strip()
                content = service.get_artifact_content(last_mission_id, target)
                if content is None:
                    print(f"{RED}Artifact not found: {target}{RESET}")
                else:
                    print(f"\n{BOLD}--- Content of {target} ---{RESET}")
                    print(content)
                    print(f"{BOLD}--- End of Content ---{RESET}")
                continue

            if line.lower().startswith("refine "):
                if not last_result:
                    print(f"{YELLOW}Nothing to refine. Run a mission first.{RESET}")
                    continue
                feedback = line[7:].strip()
                objective = (
                    f"Refine previous mission results based on: {feedback}\n"
                    f"Previous summary: {last_result.verification_summary}"
                )
                title = f"Refinement: {feedback[:30]}..."
                current_mission_id = last_mission_id
            else:
                objective = line
                title = f"Mission: {line[:30]}..."
                current_mission_id = f"shell-{uuid.uuid4().hex[:8]}"

            payload = {
                "mission_id": current_mission_id,
                "workspace_id": args.workspace_id,
                "title": title,
                "objective": objective,
                "mode": args.mode,
            }

            print(f"{BLUE}Executing:{RESET} {title} ({current_mission_id})")
            last_result = await service.execute_payload(payload)
            last_mission_id = current_mission_id

            status_color = GREEN if last_result.status == "completed" else RED
            print(f"\n{BOLD}Status:{RESET} {status_color}{last_result.status}{RESET}")
            print(f"{BOLD}Summary:{RESET} {last_result.verification_summary}")
            if last_result.artifacts:
                print(f"{BOLD}Artifacts:{RESET} {len(last_result.artifacts)}")
                for artifact in last_result.artifacts:
                    print(f"  - {artifact.title}: {YELLOW}{artifact.path}{RESET}")

        except KeyboardInterrupt:
            print(f"\n{YELLOW}Interrupt received, type 'exit' to quit.{RESET}")
        except Exception as e:
            print(f"\n{RED}Error: {e}{RESET}")


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
