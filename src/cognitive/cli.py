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

    plan_command_parser = subparsers.add_parser("plan", help="Plan a mission without execution")
    plan_command_parser.add_argument("--mission-file", required=True, help="Mission payload JSON file")
    plan_command_parser.add_argument("--workspace-root", required=True, help="Workspace root path")

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
    last_mission_id = None
    history: list[str] = []
    missions: list[dict] = []

    while True:
        try:
            line = input("\njeanbot> ").strip()
            if not line:
                continue
            if line.lower() in ("exit", "quit"):
                break

            # Process commands that don't count as missions
            if line.lower() == "help":
                print("Commands:")
                print("  help              Show this help")
                print("  history           Show command history")
                print("  status            Show status of last mission")
                print("  exit | quit       Exit shell")
                print("  <objective>       Plan and execute a mission")
                print("  refine <feedback> Refine the last mission result with feedback")
                continue

            if line.lower() == "history":
                # Find matching mission for each history entry
                for i, cmd_data in enumerate(history, 1):
                    cmd = cmd_data["line"]
                    m = cmd_data.get("mission")
                    mission_info = f" -> {m['status']} ({m['id']})" if m else ""
                    print(f"  {i:3}  {cmd}{mission_info}")
                continue

            if line.lower() == "status":
                if not last_mission_id:
                    print("No mission executed yet.")
                    continue
                summary = service.get_mission_run_summary(last_mission_id)
                if not summary:
                    print(f"No summary found for mission {last_mission_id}")
                    continue

                res = summary.get("result", {})
                print(f"Mission: {summary['mission']['title']}")
                print(f"ID: {last_mission_id}")
                print(f"Status: {res.get('status', 'unknown')}")
                print(f"Verification: {res.get('verification_summary', 'N/A')}")

                metrics = res.get("metrics", {})
                if metrics:
                    print(f"Performance: {metrics.get('completed_steps', 0)}/{metrics.get('total_steps', 0)} steps, {metrics.get('average_score', 0)} avg score")

                artifacts = res.get("artifacts", [])
                if artifacts:
                    print(f"Artifacts ({len(artifacts)}):")
                    for a in artifacts:
                        print(f"  - {a['title']}: {a['path']}")
                continue

            # This is a mission-generating command
            current_history_entry = {"line": line}
            history.append(current_history_entry)

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

            mission_id = f"shell-{uuid.uuid4().hex[:8]}"
            last_mission_id = mission_id
            payload = {
                "mission_id": mission_id,
                "workspace_id": args.workspace_id,
                "title": title,
                "objective": objective,
                "mode": args.mode,
            }

            print(f"Executing: {title}")
            last_result = await service.execute_payload(payload)
            mission_entry = {"id": mission_id, "status": last_result.status, "title": title}
            missions.append(mission_entry)
            current_history_entry["mission"] = mission_entry

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
    elif args.command == "plan":
        plan = service.plan_mission(payload)
        return {
            "command": "plan",
            "summary": plan.summary,
            "steps": [
                {"id": s.id, "title": s.title, "capability": s.capability}
                for s in plan.steps
            ],
        }
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
