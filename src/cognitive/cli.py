from __future__ import annotations

import argparse
import asyncio
import json
import uuid
from pathlib import Path
from typing import Sequence

from .service import MissionExecutorService

# ANSI color constants
BLUE = "\033[94m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
MAGENTA = "\033[95m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"


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
    try:
        import readline  # Enable history and line editing
    except ImportError:
        pass

    service = MissionExecutorService(workspace_root=args.workspace_root, mode=args.mode)

    banner = f"""
{BOLD}{BLUE}┌──────────────────────────────────────────────────────────┐
│                                                          │
│  {GREEN}JeanBot Interactive Shell{BLUE}                               │
│  {CYAN}Mode: {args.mode:<10}{BLUE}                                        │
│                                                          │
└──────────────────────────────────────────────────────────┘{RESET}
"""
    print(banner)
    print(f"{BOLD}Workspace:{RESET} {args.workspace_root} ({args.workspace_id})")
    print(f"Type '{YELLOW}help{RESET}' for commands.")

    last_result = None
    # We'll use a fixed mission ID for the session to support resumption,
    # but objectives will change.
    session_mission_id = f"shell-{uuid.uuid4().hex[:8]}"
    history: list[str] = []

    while True:
        try:
            prompt = f"\n{BOLD}{GREEN}jeanbot{RESET}> "
            line = input(prompt).strip()
            if not line:
                continue
            if line.lower() in ("exit", "quit"):
                break

            history.append(line)

            if line.lower() == "help":
                print(f"\n{BOLD}Available Commands:{RESET}")
                print(f"  {YELLOW}help{RESET}              Show this help")
                print(f"  {YELLOW}history{RESET}           Show command history")
                print(f"  {YELLOW}status{RESET}            Show last mission status")
                print(f"  {YELLOW}artifacts{RESET}         List produced artifacts")
                print(f"  {YELLOW}view <id|path>{RESET}    View artifact content")
                print(f"  {YELLOW}exit | quit{RESET}       Exit shell")
                print(f"  {BOLD}<objective>{RESET}       Plan and execute a new mission")
                print(f"  {BOLD}refine <feedback>{RESET} Refine the last mission result")
                continue

            if line.lower() == "history":
                print(f"\n{BOLD}Command History:{RESET}")
                for i, cmd in enumerate(history, 1):
                    print(f"  {BLUE}{i:3}{RESET}  {cmd}")
                continue

            if line.lower() == "status":
                summary = await service.get_mission_run_summary(session_mission_id)
                if not summary:
                    print(f"{YELLOW}No active mission run found for this session.{RESET}")
                else:
                    res = summary.get("result", {})
                    print(f"\n{BOLD}Current Mission Status:{RESET}")
                    print(f"  {BOLD}ID:{RESET}      {session_mission_id}")
                    print(f"  {BOLD}Status:{RESET}  {res.get('status', 'unknown')}")
                    print(f"  {BOLD}Summary:{RESET} {res.get('verification_summary', 'N/A')}")
                continue

            if line.lower() == "artifacts":
                summary = await service.get_mission_run_summary(session_mission_id)
                if not summary or not summary.get("result", {}).get("artifacts"):
                    print(f"{YELLOW}No artifacts found.{RESET}")
                else:
                    print(f"\n{BOLD}Artifacts:{RESET}")
                    for i, art in enumerate(summary["result"]["artifacts"], 1):
                        print(f"  {BLUE}[{i}]{RESET} { art.get('title') }")
                        print(f"      {CYAN}Path:{RESET} { art.get('path') }")
                continue

            if line.lower().startswith("view "):
                target = line[5:].strip()
                content = await service.get_artifact_content(session_mission_id, target)
                if content:
                    print(f"\n{BOLD}Content of {target}:{RESET}")
                    print("-" * 40)
                    print(content)
                    print("-" * 40)
                else:
                    print(f"{RED}Artifact '{target}' not found.{RESET}")
                continue

            # Mission execution
            if line.lower().startswith("refine "):
                if not last_result:
                    # Try to load from summary if last_result is None (e.g. after restart)
                    summary = await service.get_mission_run_summary(session_mission_id)
                    if summary:
                        last_summary_text = summary.get("result", {}).get("verification_summary", "N/A")
                    else:
                        print(f"{RED}Nothing to refine. Run a mission first.{RESET}")
                        continue
                else:
                    last_summary_text = last_result.verification_summary

                feedback = line[7:].strip()
                objective = (
                    f"Refine previous mission results based on: {feedback}\n"
                    f"Previous summary: {last_summary_text}"
                )
                title = f"Refinement: {feedback[:30]}..."
            else:
                objective = line
                title = f"Mission: {line[:30]}..."

            # For new objectives in the same session, we keep the mission_id
            # so the executor can recover state if it wants, though usually
            # new objectives might want fresh start.
            # Here we follow the existing pattern of using mission_id.

            payload = {
                "mission_id": session_mission_id,
                "workspace_id": args.workspace_id,
                "title": title,
                "objective": objective,
                "mode": args.mode,
            }

            print(f"\n{BOLD}{BLUE}>>> Executing:{RESET} {BOLD}{title}{RESET}")
            last_result = await service.execute_payload(payload)

            status_color = GREEN if last_result.status == "completed" else RED
            print(f"\n{BOLD}Status:{RESET}  {status_color}{last_result.status}{RESET}")
            print(f"{BOLD}Summary:{RESET} {last_result.verification_summary}")

            if last_result.artifacts:
                print(f"{BOLD}Artifacts:{RESET} {len(last_result.artifacts)}")
                for artifact in last_result.artifacts:
                    print(f"  - {artifact.title}: {CYAN}{artifact.path}{RESET}")

        except KeyboardInterrupt:
            print(f"\n{YELLOW}Interrupt received, type 'exit' to quit.{RESET}")
        except EOFError:
            print(f"\n{YELLOW}EOF received, exiting...{RESET}")
            break
        except Exception as e:
            print(f"\n{RED}{BOLD}Error:{RESET} {e}")


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
