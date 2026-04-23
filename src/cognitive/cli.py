from __future__ import annotations

import argparse
import asyncio
import json
import uuid
from pathlib import Path
from typing import Sequence

from .service import MissionExecutorService

# ANSI color constants for shell UX
BLUE = "\033[94m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
BOLD = "\033[1m"
END = "\033[0m"


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
    print(f"{BOLD}{BLUE}JeanBot interactive shell{END} ({args.mode} mode)")
    print(f"Workspace: {args.workspace_root} ({args.workspace_id})")
    print("Type 'exit' or 'quit' to end session. Type 'help' for commands.")

    last_result = None
    mission_id = f"shell-{uuid.uuid4().hex[:8]}"
    history: list[str] = []

    while True:
        try:
            line = input(f"\n{BOLD}{GREEN}jeanbot>{END} ").strip()
            if not line:
                continue
            if line.lower() in ("exit", "quit"):
                break

            history.append(line)

            if line.lower() == "help":
                print(f"{BOLD}Commands:{END}")
                print("  help              Show this help")
                print("  history           Show command history")
                print("  status            Show current mission status")
                print("  artifacts         List produced artifacts")
                print("  view <id|path>    Display artifact content")
                print("  exit | quit       Exit shell")
                print("  <objective>       Plan and execute a mission")
                print("  refine <feedback> Refine the last mission result with feedback")
                continue

            if line.lower() == "history":
                for i, cmd in enumerate(history, 1):
                    print(f"  {i:3}  {cmd}")
                continue

            if line.lower() == "status":
                summary = service.get_mission_run_summary(mission_id)
                if not summary:
                    print("No active mission session found.")
                else:
                    res = summary.get("result", {})
                    print(f"{BOLD}Mission Status:{END} {res.get('status', 'unknown')}")
                    print(f"{BOLD}Summary:{END} {res.get('verification_summary', 'N/A')}")
                    print(f"{BOLD}Metrics:{END}")
                    for k, v in res.get("metrics", {}).items():
                        print(f"  - {k}: {v}")
                continue

            if line.lower() == "artifacts":
                summary = service.get_mission_run_summary(mission_id)
                if not summary:
                    print("No mission artifacts found.")
                else:
                    artifacts = summary.get("result", {}).get("artifacts", [])
                    print(f"{BOLD}Artifacts ({len(artifacts)}):{END}")
                    for a in artifacts:
                        print(f"  - {BOLD}{a['id'][:8]}{END} {a['title']} ({a['path']})")
                continue

            if line.lower().startswith("view "):
                artifact_id = line[5:].strip()
                content_bundle = service.get_artifact_content(mission_id, artifact_id)
                if not content_bundle:
                    print(f"{RED}Artifact not found: {artifact_id}{END}")
                else:
                    artifact = content_bundle["artifact"]
                    print(f"\n{BOLD}--- {artifact['title']} ---{END}")
                    print(content_bundle["content"])
                    print(f"{BOLD}--- End of {artifact['id'][:8]} ---{END}")
                continue

            if line.lower().startswith("refine "):
                feedback = line[7:].strip()
                summary_text = ""
                if last_result:
                    summary_text = last_result.verification_summary
                else:
                    summary = service.get_mission_run_summary(mission_id)
                    if summary:
                        summary_text = summary.get("result", {}).get("verification_summary", "")

                if not summary_text:
                    print(f"{YELLOW}Nothing to refine. Run a mission first.{END}")
                    continue

                objective = (
                    f"Refine previous mission results based on: {feedback}\n"
                    f"Previous summary: {summary_text}"
                )
                title = f"Refinement: {feedback[:30]}..."
            else:
                objective = line
                title = f"Mission: {line[:30]}..."

            payload = {
                "mission_id": mission_id,
                "workspace_id": args.workspace_id,
                "title": title,
                "objective": objective,
                "mode": args.mode,
            }

            print(f"{BLUE}Executing:{END} {BOLD}{title}{END}")
            last_result = await service.execute_payload(payload)

            color = GREEN if last_result.status == "completed" else RED
            print(f"\n{BOLD}Status:{END} {color}{last_result.status}{END}")
            print(f"{BOLD}Summary:{END} {last_result.verification_summary}")
            if last_result.artifacts:
                print(f"{BOLD}Artifacts:{END} {len(last_result.artifacts)}")
                for artifact in last_result.artifacts:
                    print(f"  - {BOLD}{artifact.id[:8]}{END} {artifact.title}: {artifact.path}")

        except KeyboardInterrupt:
            print("\nInterrupt received, type 'exit' to quit.")
        except Exception as e:
            print(f"\nError: {e}")


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
