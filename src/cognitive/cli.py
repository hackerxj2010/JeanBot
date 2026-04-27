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


async def run_shell(args: argparse.Namespace):
    try:
        import readline  # Enable history and line editing
    except ImportError:
        pass

    service = MissionExecutorService(workspace_root=args.workspace_root, mode=args.mode)
    print(f"\033[1;34mJeanBot interactive shell ({args.mode} mode)\033[0m")
    print(f"Workspace: {args.workspace_root} ({args.workspace_id})")
    print("Type 'exit' or 'quit' to end session. Type 'help' for commands.")

    last_result = None
    mission_id = f"shell-{uuid.uuid4().hex[:8]}"
    history: list[str] = []

    while True:
        try:
            line = input("\njeanbot> ").strip()
            if not line:
                continue
            if line.lower() in ("exit", "quit"):
                break

            history.append(line)

            if line.lower() == "help":
                print("\033[1mCommands:\033[0m")
                print("  help              Show this help")
                print("  history           Show command history")
                print("  status            Show status of current mission")
                print("  artifacts         List artifacts from current mission")
                print("  view <path|id>    View content of an artifact or file")
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
                    print("No active mission found.")
                else:
                    res = summary.get("result", {})
                    print(f"\033[1mStatus:\033[0m {res.get('status')}")
                    print(f"Summary: {res.get('verification_summary')}")
                    print(f"Steps: {res.get('metrics', {}).get('completed_steps', 0)}/{res.get('metrics', {}).get('total_steps', 0)}")
                continue

            if line.lower() == "artifacts":
                summary = service.get_mission_run_summary(mission_id)
                if not summary or "result" not in summary:
                    print("No mission artifacts found.")
                else:
                    arts = summary["result"].get("artifacts", [])
                    print(f"\033[1mArtifacts ({len(arts)}):\033[0m")
                    for a in arts:
                        print(f"  [{a.get('id')[:8]}] {a.get('title')}: {a.get('path')}")
                continue

            if line.lower().startswith("view "):
                target = line[5:].strip()
                path = Path(target)
                if not path.exists():
                    # Check if it's an artifact ID
                    summary = service.get_mission_run_summary(mission_id)
                    if summary:
                        arts = summary["result"].get("artifacts", [])
                        match = next((a for a in arts if a.get("id").startswith(target)), None)
                        if match:
                            path = Path(match.get("path"))

                if path.exists() and path.is_file():
                    print(f"\033[1;32m--- Viewing {path} ---\033[0m")
                    print(path.read_text(encoding="utf-8"))
                else:
                    print(f"File or artifact not found: {target}")
                continue

            if line.lower().startswith("refine "):
                if not last_result:
                    # Fallback to loading from disk if shell was restarted but mission_id is known
                    summary = service.get_mission_run_summary(mission_id)
                    if not summary:
                        print("Nothing to refine. Run a mission first.")
                        continue
                    prev_summary = summary.get("result", {}).get("verification_summary", "N/A")
                else:
                    prev_summary = last_result.verification_summary

                feedback = line[7:].strip()
                objective = (
                    f"Refine previous mission results based on: {feedback}\n"
                    f"Previous summary: {prev_summary}"
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

            print(f"Executing: \033[1m{title}\033[0m")
            last_result = await service.execute_payload(payload)

            print(f"\nStatus: \033[1m{last_result.status}\033[0m")
            print(f"Summary: {last_result.verification_summary}")
            if last_result.artifacts:
                print(f"Artifacts: {len(last_result.artifacts)}")
                for artifact in last_result.artifacts:
                    print(f"  - {artifact.title}: {artifact.path}")

        except KeyboardInterrupt:
            print("\nInterrupt received, type 'exit' to quit.")
        except Exception as e:
            print(f"\n\033[31mError: {e}\033[0m")


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
    if args.command != "shell":
        print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
