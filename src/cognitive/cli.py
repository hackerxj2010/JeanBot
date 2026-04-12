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
    print(f"JeanBot interactive shell ({args.mode} mode)")
    print(f"Workspace: {args.workspace_root} ({args.workspace_id})")
    print("Type 'exit' or 'quit' to end session. Type 'help' for commands.")

    jean_dir = Path(args.workspace_root) / ".jeanbot"
    jean_dir.mkdir(parents=True, exist_ok=True)

    mission_id_file = jean_dir / "shell-mission-id.txt"
    if mission_id_file.exists():
        mission_id = mission_id_file.read_text().strip()
        print(f"Resuming mission: {mission_id}")
    else:
        mission_id = f"shell-{uuid.uuid4().hex[:8]}"
        mission_id_file.write_text(mission_id)

    last_run_file = jean_dir / "shell-last-run.json"
    last_result_dict = None
    if last_run_file.exists():
        try:
            last_result_dict = json.loads(last_run_file.read_text())
            print(f"Loaded last run: {last_result_dict['mission']['title']}")
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
                print("  exit | quit       Exit shell")
                print("  <objective>       Plan and execute a mission")
                print("  refine <feedback> Refine the last mission result with feedback")
                continue

            if line.lower() == "status":
                if not last_result_dict:
                    print("No active mission status available.")
                else:
                    mission = last_result_dict["mission"]
                    result = last_result_dict["result"]
                    print(f"\nMission: {mission['title']}")
                    print(f"Objective: {mission['objective']}")
                    print(f"Status: {result['status']}")
                    print(f"Summary: {result['verification_summary']}")

                    steps = result.get("step_reports", [])
                    if steps:
                        print("\nSteps:")
                        for s in steps:
                            diag = s.get("diagnostics")
                            score = f"{diag['overall_score']:.2f}" if diag else "N/A"
                            status = "✓" if diag and diag["failure_class"] == "none" else "✗"
                            print(f"  {status} {s['step_id']}: score={score} attempts={s['attempts']}")
                continue

            if line.lower() == "artifacts":
                if not last_result_dict:
                    print("No artifacts available.")
                else:
                    artifacts = last_result_dict.get("result", {}).get("artifacts", [])
                    if not artifacts:
                        print("No artifacts found.")
                    else:
                        print("\nArtifacts:")
                        for a in artifacts:
                            print(f"  {a['id'][:8]} :: {a['title']} ({a['kind']})")
                continue

            if line.lower().startswith("show "):
                if not last_result_dict:
                    print("No artifacts available to show.")
                    continue
                art_id_prefix = line[5:].strip()
                artifacts = last_result_dict.get("result", {}).get("artifacts", [])
                match = next((a for a in artifacts if a["id"].startswith(art_id_prefix)), None)
                if not match:
                    print(f"Artifact with prefix '{art_id_prefix}' not found.")
                else:
                    path = Path(match["path"])
                    if path.exists():
                        print(f"\n--- {match['title']} ({match['path']}) ---\n")
                        print(path.read_text())
                        print("\n--- End of artifact ---")
                    else:
                        print(f"Artifact file not found at {match['path']}")
                continue

            if line.lower() == "history":
                for i, cmd in enumerate(history, 1):
                    print(f"  {i:3}  {cmd}")
                continue

            if line.lower().startswith("refine "):
                if not last_result_dict:
                    print("Nothing to refine. Run a mission first.")
                    continue
                feedback = line[7:].strip()
                objective = (
                    f"Refine previous mission results based on: {feedback}\n"
                    f"Previous summary: {last_result_dict['result']['verification_summary']}"
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

            print(f"Executing: {title}")
            last_result = await service.execute_payload(payload)

            # Update shell metadata for persistence
            from dataclasses import asdict
            from .adapters import utc_json

            # Since service no longer writes this, we do it here
            last_result_dict = {
                "mission": {
                    "id": last_result.mission_id,
                    "title": title,
                    "objective": objective,
                    "workspace_id": args.workspace_id,
                },
                "result": service._result_to_dict(last_result)
            }
            last_run_file.write_text(utc_json(last_result_dict), encoding="utf-8")

            print(f"\nStatus: {last_result.status}")
            print(f"Summary: {last_result.verification_summary}")

            if last_result.step_reports:
                print("\nSteps:")
                for s in last_result.step_reports:
                    diag = s.diagnostics
                    score = f"{diag.overall_score:.2f}" if diag else "N/A"
                    status = "✓" if diag and diag.failure_class == "none" else "✗"
                    print(f"  {status} {s.step_id}: score={score} attempts={s.attempts}")

            if last_result.artifacts:
                print(f"\nArtifacts: {len(last_result.artifacts)}")
                for artifact in last_result.artifacts:
                    print(f"  {artifact.id[:8]} :: {artifact.title}: {artifact.path}")

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
