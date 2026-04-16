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

    last_result = None
    history: list[str] = []

    mission_id_file = Path(args.workspace_root) / ".jeanbot" / "shell-mission-id.txt"
    if mission_id_file.exists():
        mission_id = mission_id_file.read_text(encoding="utf-8").strip()
        print(f"Resuming mission: {mission_id}")
    else:
        mission_id = f"shell-{uuid.uuid4().hex[:8]}"
        ensure_dir = Path(args.workspace_root) / ".jeanbot"
        ensure_dir.mkdir(parents=True, exist_ok=True)
        mission_id_file.write_text(mission_id, encoding="utf-8")

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
                print("  show <id>         Display content of an artifact")
                print("  exit | quit       Exit shell")
                print("  <objective>       Plan and execute a mission")
                print("  refine <feedback> Refine the last mission result with feedback")
                continue

            if line.lower() == "history":
                for i, cmd in enumerate(history, 1):
                    print(f"  {i:3}  {cmd}")
                continue

            if line.lower() == "status":
                summary_data = service.get_mission_run_summary(mission_id)
                if summary_data:
                    res = summary_data.get("result", {})
                    print(f"Status: {res.get('status')}")
                    print(f"Summary: {res.get('verification_summary')}")
                    reports = res.get("step_reports", [])
                    completed = len([r for r in reports if r.get("diagnostics", {}).get("failure_class") == "none"])
                    total = len(reports)
                    print(f"Progress: {completed}/{total} steps completed.")
                elif last_result:
                    print(f"Status: {last_result.status}")
                    print(f"Summary: {last_result.verification_summary}")
                    completed = len([r for r in last_result.step_reports if r.diagnostics and r.diagnostics.failure_class == "none"])
                    total = len(last_result.step_reports)
                    print(f"Progress: {completed}/{total} steps completed.")
                else:
                    print(f"Active mission ID: {mission_id}. No execution results yet.")
                continue

            if line.lower() == "artifacts":
                artifacts = service.get_mission_artifacts(mission_id)
                if not artifacts:
                    print("No artifacts found.")
                else:
                    print(f"Artifacts for {mission_id}:")
                    for art in artifacts:
                        print(f"  [{art['id'][:8]}] {art['title']} ({art['kind']})")
                        print(f"    Path: {art['path']}")
                continue

            if line.lower().startswith("show "):
                art_id = line[5:].strip()
                try:
                    content = service.get_artifact_content(mission_id, art_id)
                    print(f"\n--- Artifact: {art_id} ---\n")
                    print(content)
                    print("\n--- End of Artifact ---\n")
                except Exception as e:
                    print(f"Error: {e}")
                continue

            if line.lower().startswith("refine "):
                if not last_result:
                    print("Nothing to refine. Run a mission first.")
                    continue
                feedback = line[7:].strip()
                objective = (
                    f"Refine previous mission results based on: {feedback}\n"
                    f"Previous summary: {last_result.verification_summary}"
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

            print(f"\nStatus: {last_result.status}")
            print(f"Summary: {last_result.verification_summary}")
            if last_result.artifacts:
                print(f"Artifacts: {len(last_result.artifacts)}")
                for artifact in last_result.artifacts:
                    print(f"  - {artifact.title}: {artifact.path}")

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
