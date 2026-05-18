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
    missions: list[dict[str, str]] = []

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
                print("  history           Show command and mission history")
                print("  plan <objective>  Plan a mission without executing")
                print("  status [id]       Show status of the last or specific mission")
                print("  exit | quit       Exit shell")
                print("  <objective>       Plan and execute a mission")
                print("  refine <feedback> Refine the last mission result with feedback")
                continue

            if line.lower() == "history":
                print("\nCommand History:")
                for i, cmd in enumerate(history, 1):
                    print(f"  {i:3}  {cmd}")
                if missions:
                    print("\nMission History:")
                    for m in missions:
                        print(f"  {m['id']}  {m['title']} ({m['status']})")
                continue

            if line.lower().startswith("plan "):
                objective = line[5:].strip()
                payload = {
                    "workspace_id": args.workspace_id,
                    "title": f"Plan: {objective[:30]}...",
                    "objective": objective,
                }
                plan_data = service.plan_mission(payload)
                print(f"\nMission ID: {plan_data['mission_id']}")
                print(f"Title: {plan_data['title']}")
                print(f"Summary: {plan_data['summary']}")
                print("Steps:")
                for step in plan_data["steps"]:
                    deps = f" (depends on: {', '.join(step['depends_on'])})" if step["depends_on"] else ""
                    print(f"  - [{step['id']}] {step['title']}: {step['description']}{deps}")
                continue

            if line.lower() == "status" or line.lower().startswith("status "):
                m_id = line[7:].strip() or (last_result.mission_id if last_result else service.get_last_mission_id())
                if not m_id:
                    print("No mission found. Run a mission first or provide an ID.")
                    continue
                try:
                    summary = service.get_mission_run_summary(m_id)
                    res = summary["result"]
                    print(f"\nMission ID: {m_id}")
                    print(f"Title: {summary['mission']['title']}")
                    print(f"Status: {res['status']}")
                    print(f"Finished: {res.get('finished_at', 'N/A')}")
                    print(f"Summary: {res['verification_summary']}")
                    if res.get("metrics"):
                        m = res["metrics"]
                        print(f"Metrics: {m.get('completed_steps')}/{m.get('total_steps')} steps, {m.get('total_artifacts')} artifacts")
                    if res.get("artifacts"):
                        print("Artifacts:")
                        for art in res["artifacts"]:
                            print(f"  - {art['title']}: {art['path']}")
                except Exception as e:
                    print(f"Error retrieving status for {m_id}: {e}")
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
                current_mission_id = last_result.mission_id
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

            print(f"Executing: {title} ({current_mission_id})")
            last_result = await service.execute_payload(payload)

            missions.append({
                "id": last_result.mission_id,
                "title": title,
                "status": last_result.status
            })

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
