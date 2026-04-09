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
    current_mission_id = f"shell-{uuid.uuid4().hex[:8]}"
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
                print("  artifacts         List all mission artifacts")
                print("  show <artifact_id> Display a specific artifact content")
                print("  exit | quit       Exit shell")
                print("  <objective>       Plan and execute a mission")
                print("  refine <feedback> Refine the last mission result with feedback")
                continue

            if line.lower() == "history":
                for i, cmd in enumerate(history, 1):
                    print(f"  {i:3}  {cmd}")
                continue

            if line.lower() == "status":
                bundle = service.build_bundle({"workspace_id": args.workspace_id, "title": "Status check", "objective": "none"})
                state = await bundle.file_service.load_mission_state(current_mission_id)
                if not state:
                    print(f"No active mission found for ID: {current_mission_id}")
                else:
                    print(f"\nMission: {state.objective.title}")
                    print(f"Objective: {state.objective.objective}")
                    print(f"Plan Version: {state.plan_version or 1}")
                    if state.plan:
                        print("\nSteps:")
                        for step in state.plan.steps:
                            status_icon = "✓" if step.status == "completed" else "▶" if step.status == "running" else "○"
                            print(f"  {status_icon} {step.id}: {step.title} ({step.status})")
                    if last_result:
                        print(f"\nLast Execution Status: {last_result.status}")
                        print(f"Verification Summary: {last_result.verification_summary}")
                continue

            if line.lower() == "artifacts":
                if not last_result or not last_result.artifacts:
                    print("No artifacts found.")
                else:
                    print(f"\nArtifacts ({len(last_result.artifacts)}):")
                    for art in last_result.artifacts:
                        print(f"  - [{art.id[:8]}] {art.title}: {art.path} ({art.kind})")
                continue

            if line.lower().startswith("show "):
                artifact_id = line[5:].strip()
                if not last_result:
                    print("No mission data available.")
                    continue
                target = next((a for a in last_result.artifacts if a.id.startswith(artifact_id)), None)
                if not target:
                    print(f"Artifact not found: {artifact_id}")
                else:
                    try:
                        content = Path(target.path).read_text(encoding="utf-8")
                        print(f"\n--- {target.title} ---")
                        print(content)
                        print("--- End of Artifact ---")
                    except Exception as e:
                        print(f"Could not read artifact: {e}")
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

                payload = {
                    "mission_id": current_mission_id,
                    "workspace_id": args.workspace_id,
                    "title": title,
                    "objective": objective,
                    "mode": args.mode,
                }
            else:
                objective = line
                title = f"Mission: {line[:30]}..."

                payload = {
                    "mission_id": current_mission_id,
                    "workspace_id": args.workspace_id,
                    "title": title,
                    "objective": objective,
                    "mode": args.mode,
                }

            print(f"\n[JeanBot] Executing: {title}")
            last_result = await service.execute_payload(payload)
            if last_result.mission_id:
                current_mission_id = last_result.mission_id

            print(f"\n--- Mission Result ---")
            print(f"Status:  {last_result.status}")
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
