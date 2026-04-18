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
    execute_parser.add_argument("--mode", choices=["local", "live"], help="Execution mode")
    execute_parser.add_argument("--api-url", help="Live API URL")
    execute_parser.add_argument("--token", help="Live API Token")

    finalize_parser = subparsers.add_parser(
        "finalize-distributed",
        help="Finalize a distributed mission payload with active_execution",
    )
    finalize_parser.add_argument("--mission-file", required=True, help="Mission payload JSON file")
    finalize_parser.add_argument("--workspace-root", required=True, help="Workspace root path")
    finalize_parser.add_argument("--api-url", help="Live API URL")
    finalize_parser.add_argument("--token", help="Live API Token")

    shell_parser = subparsers.add_parser("shell", help="Start interactive mission shell")
    shell_parser.add_argument("--workspace-root", required=True, help="Workspace root path")
    shell_parser.add_argument("--workspace-id", default="workspace-interactive", help="Workspace ID")
    shell_parser.add_argument("--mode", choices=["local", "live"], default="local", help="Execution mode")
    shell_parser.add_argument("--api-url", help="Live API URL")
    shell_parser.add_argument("--token", help="Live API Token")

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

    shell_dir = Path(args.workspace_root) / ".jeanbot"
    shell_dir.mkdir(parents=True, exist_ok=True)

    id_file = shell_dir / "shell-mission-id.txt"
    if id_file.exists():
        mission_id = id_file.read_text(encoding="utf-8").strip()
        print(f"Resuming mission: {mission_id}")
    else:
        mission_id = f"shell-{uuid.uuid4().hex[:8]}"
        id_file.write_text(mission_id, encoding="utf-8")

    last_run_file = shell_dir / "shell-last-run.json"
    last_result = None
    if last_run_file.exists():
        try:
            last_run_data = json.loads(last_run_file.read_text(encoding="utf-8"))
            last_result_dict = await service.get_mission_run_summary(mission_id)
            if last_result_dict:
                from .executor import MissionArtifact, MissionRunResult, StepExecutionRecord
                res = last_result_dict["result"]
                last_result = MissionRunResult(
                    mission_id=res["mission_id"],
                    status=res["status"],
                    execution_mode=res["execution_mode"],
                    verification_summary=res["verification_summary"],
                    outputs=res["outputs"],
                    memory_updates=res["memory_updates"],
                    step_reports=[StepExecutionRecord(**r) for r in res["step_reports"]],
                    artifacts=[MissionArtifact(**a) for a in res["artifacts"]],
                    metrics=res["metrics"],
                    gaps=res["gaps"],
                    decision_log=res["decision_log"],
                    started_at=res["started_at"],
                    finished_at=res["finished_at"],
                )
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

            if line.lower() == "history":
                for i, cmd in enumerate(history, 1):
                    print(f"  {i:3}  {cmd}")
                continue

            if line.lower() == "status":
                summary = await service.get_mission_run_summary(mission_id)
                if not summary:
                    print("No active mission run found.")
                else:
                    res = summary["result"]
                    print(f"Mission: {summary['mission']['title']}")
                    print(f"Status: {res['status']}")
                    print(f"Verification: {res['verification_summary']}")
                    print(f"Steps: {len(res['step_reports'])}")
                continue

            if line.lower() == "artifacts":
                summary = await service.get_mission_run_summary(mission_id)
                if not summary:
                    print("No artifacts found.")
                else:
                    artifacts = summary["result"].get("artifacts", [])
                    print(f"Artifacts ({len(artifacts)}):")
                    for a in artifacts:
                        print(f"  {a['id'][:8]}  {a['title']} ({a['kind']})")
                continue

            if line.lower().startswith("show "):
                artifact_id = line[5:].strip()
                content = await service.get_artifact_content(mission_id, artifact_id)
                if content:
                    print("-" * 40)
                    print(content)
                    print("-" * 40)
                else:
                    print(f"Artifact {artifact_id} not found.")
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
                "api_url": args.api_url,
                "auth_context": {"token": args.token} if args.token else None,
            }

            print(f"Executing: {title}")
            last_result = await service.execute_payload(payload)

            # Persist last run marker
            last_run_file.write_text(json.dumps({"mission_id": mission_id}), encoding="utf-8")

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

    service = MissionExecutorService(
        workspace_root=args.workspace_root,
        mode=args.mode if hasattr(args, "mode") else "local",
    )
    payload = service.load_payload(args.mission_file)

    if args.command in ("execute", "finalize-distributed"):
        if getattr(args, "mode", None):
            payload["mode"] = args.mode
        if getattr(args, "api_url", None):
            payload["api_url"] = args.api_url
        if getattr(args, "token", None):
            payload["auth_context"] = {"token": args.token}

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
