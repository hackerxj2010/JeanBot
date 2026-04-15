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
    execute_parser.add_argument("--mode", choices=["local", "live"], help="Override execution mode")
    execute_parser.add_argument("--api-url", help="Override API URL")
    execute_parser.add_argument("--token", help="Override internal token")

    finalize_parser = subparsers.add_parser(
        "finalize-distributed",
        help="Finalize a distributed mission payload with active_execution",
    )
    finalize_parser.add_argument("--mission-file", required=True, help="Mission payload JSON file")
    finalize_parser.add_argument("--workspace-root", required=True, help="Workspace root path")
    finalize_parser.add_argument("--mode", choices=["local", "live"], help="Override execution mode")
    finalize_parser.add_argument("--api-url", help="Override API URL")
    finalize_parser.add_argument("--token", help="Override internal token")

    shell_parser = subparsers.add_parser("shell", help="Start interactive mission shell")
    shell_parser.add_argument("--workspace-root", required=True, help="Workspace root path")
    shell_parser.add_argument("--workspace-id", default="workspace-interactive", help="Workspace ID")
    shell_parser.add_argument(
        "--mode", choices=["local", "live"], default="local", help="Execution mode"
    )

    return parser


async def run_shell(args: argparse.Namespace):
    try:
        import readline  # Enable history and line editing
    except ImportError:
        pass

    service = MissionExecutorService(workspace_root=args.workspace_root, mode=args.mode)
    print(f"JeanBot interactive shell ({args.mode} mode)")
    print(f"Workspace: {args.workspace_root} ({args.workspace_id})")
    print("Type 'exit' or 'quit' to end session. Type 'help' for commands.")

    last_result = None
    last_run_payload = None

    # Try to resume mission if shell-mission-id.txt exists
    jeanbot_dir = Path(args.workspace_root) / ".jeanbot"
    jeanbot_dir.mkdir(parents=True, exist_ok=True)
    mission_id_file = jeanbot_dir / "shell-mission-id.txt"
    last_run_file = jeanbot_dir / "shell-last-run.json"

    if mission_id_file.exists():
        mission_id = mission_id_file.read_text().strip()
        print(f"Resuming session: {mission_id}")
    else:
        mission_id = f"shell-{uuid.uuid4().hex[:8]}"
        mission_id_file.write_text(mission_id)

    if last_run_file.exists():
        try:
            last_run_payload = json.loads(last_run_file.read_text())
        except Exception:
            pass

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
                print("Commands:")
                print("  help              Show this help")
                print("  history           Show command history")
                print("  status            Show current mission status")
                print("  artifacts         List mission artifacts")
                print("  show <id>         Show artifact content")
                print("  refine <feedback> Refine the last mission result with feedback")
                print("  exit | quit       Exit shell")
                print("  <objective>       Plan and execute a mission")
                continue

            if line.lower() == "history":
                for i, cmd in enumerate(history, 1):
                    print(f"  {i:3}  {cmd}")
                continue

            if line.lower() == "status":
                if not last_result:
                    print("No active mission.")
                else:
                    print(f"Mission: {last_result.mission_id}")
                    print(f"Status: {last_result.status}")
                    print(f"Verification: {last_result.verification_summary}")
                    print(f"Steps: {len(last_result.step_reports)}")
                continue

            if line.lower() == "artifacts":
                if not last_result or not last_result.artifacts:
                    print("No artifacts available.")
                else:
                    for artifact in last_result.artifacts:
                        print(f"  [{artifact.id[:8]}] {artifact.title}: {artifact.path}")
                continue

            if line.lower().startswith("show "):
                if not last_result:
                    print("No artifacts available.")
                    continue
                art_id = line[5:].strip()
                match = next(
                    (a for a in last_result.artifacts if a.id.startswith(art_id)),
                    None,
                )
                if match:
                    content = Path(match.path).read_text(encoding="utf-8")
                    print(f"\n--- {match.title} ---\n")
                    print(content)
                else:
                    print(f"Artifact {art_id} not found.")
                continue

            if line.lower().startswith("refine "):
                if not last_run_payload:
                    print("Nothing to refine. Run a mission first.")
                    continue
                feedback = line[7:].strip()
                objective = (
                    f"Refine previous mission results based on: {feedback}\n"
                    f"Previous summary: {last_result.verification_summary if last_result else 'N/A'}"
                )
                title = f"Refinement: {feedback[:30]}..."
                payload = {**last_run_payload, "title": title, "objective": objective}
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

            print(f"Executing: {title}")
            last_run_payload = payload
            last_run_file.write_text(json.dumps(payload))
            last_result = await service.execute_payload(payload)

            print(f"\nStatus: {last_result.status}")
            print(f"Summary: {last_result.verification_summary}")
            if last_result.artifacts:
                print(f"Artifacts: {len(last_result.artifacts)}")
                for artifact in last_result.artifacts:
                    print(f"  - {artifact.title} ([{artifact.id[:8]}])")

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
    if hasattr(args, "mode") and args.mode:
        service.mode = args.mode

    payload = service.load_payload(args.mission_file)

    if hasattr(args, "api_url") and args.api_url:
        payload["api_url"] = args.api_url
    if hasattr(args, "token") and args.token:
        payload["token"] = args.token

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
