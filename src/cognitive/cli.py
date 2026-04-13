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

    jeanbot_dir = Path(args.workspace_root) / ".jeanbot"
    jeanbot_dir.mkdir(parents=True, exist_ok=True)
    mission_id_file = jeanbot_dir / "shell-mission-id.txt"
    last_run_file = jeanbot_dir / "shell-last-run.json"

    if mission_id_file.exists():
        mission_id = mission_id_file.read_text().strip()
    else:
        mission_id = f"shell-{uuid.uuid4().hex[:8]}"
        mission_id_file.write_text(mission_id)

    service = MissionExecutorService(workspace_root=args.workspace_root, mode=args.mode)
    print(f"JeanBot interactive shell ({args.mode} mode)")
    print(f"Workspace: {args.workspace_root} ({args.workspace_id})")
    print(f"Mission ID: {mission_id}")
    print("Type 'exit' or 'quit' to end session. Type 'help' for commands.")

    last_result = None
    if last_run_file.exists():
        try:
            from .executor import MissionRunResult, StepExecutionRecord, MissionArtifact
            data = json.loads(last_run_file.read_text())
            # Basic reconstruction for shell preview
            last_result = MissionRunResult(
                mission_id=data["mission_id"],
                status=data["status"],
                execution_mode=data["execution_mode"],
                verification_summary=data["verification_summary"],
                outputs=data["outputs"],
                memory_updates=data["memory_updates"],
                step_reports=[StepExecutionRecord.from_dict(r) for r in data["step_reports"]],
                artifacts=[MissionArtifact.from_dict(a) for a in data["artifacts"]],
                metrics=data["metrics"],
                gaps=data["gaps"],
                decision_log=data["decision_log"],
                started_at=data["started_at"],
                finished_at=data["finished_at"],
            )
            print(f"Loaded previous session: {last_result.verification_summary}")
        except Exception as e:
            print(f"Warning: could not load previous session: {e}")

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
                print("  status            Show current mission status")
                print("  artifacts         List mission artifacts")
                print("  show <id_prefix>  Show content of an artifact")
                print("  history           Show command history")
                print("  exit | quit       Exit shell")
                print("  <objective>       Plan and execute a mission step")
                print("  refine <feedback> Refine the last mission result with feedback")
                continue

            if line.lower() == "history":
                for i, cmd in enumerate(history, 1):
                    print(f"  {i:3}  {cmd}")
                continue

            if line.lower() == "status":
                if not last_result:
                    print("No mission running.")
                else:
                    print(f"Mission: {mission_id}")
                    print(f"Status: {last_result.status}")
                    print(f"Progress: {len(last_result.step_reports)} steps completed")
                    print(f"Summary: {last_result.verification_summary}")
                continue

            if line.lower() == "artifacts":
                if not last_result or not last_result.artifacts:
                    print("No artifacts found.")
                else:
                    for a in last_result.artifacts:
                        print(f"  {a.id[:8]}  {a.kind:10}  {a.title}")
                continue

            if line.lower().startswith("show "):
                if not last_result or not last_result.artifacts:
                    print("No artifacts found.")
                    continue
                prefix = line[5:].strip()
                matches = [a for a in last_result.artifacts if a.id.startswith(prefix)]
                if not matches:
                    print(f"No artifact found with prefix: {prefix}")
                elif len(matches) > 1:
                    print(f"Multiple artifacts found: {[m.id[:8] for m in matches]}")
                else:
                    path = Path(matches[0].path)
                    if path.exists():
                        print(f"\n--- {matches[0].title} ---\n")
                        print(path.read_text())
                    else:
                        print(f"File not found: {path}")
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
                "id": mission_id,
                "workspace_id": args.workspace_id,
                "title": title,
                "objective": objective,
                "mode": args.mode,
            }

            print(f"Executing: {title}")
            last_result = await service.execute_payload(payload)

            # Persist last run for shell resumption
            from .adapters import asdict_fallback
            last_run_file.write_text(json.dumps(last_result, default=asdict_fallback, indent=2))

            print(f"\nStatus: {last_result.status}")
            print(f"Summary: {last_result.verification_summary}")
            if last_result.artifacts:
                print(f"Artifacts: {len(last_result.artifacts)}")
                for artifact in last_result.artifacts:
                    print(f"  - {artifact.title}: {artifact.path}")

        except KeyboardInterrupt:
            print("\nInterrupt received, type 'exit' to quit.")
        except Exception as e:
            import traceback
            traceback.print_exc()
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
