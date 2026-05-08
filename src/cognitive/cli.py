from __future__ import annotations

import argparse
import asyncio
import json
import uuid
from pathlib import Path
from typing import Sequence

import re
from .service import MissionExecutorService


def render_markdown(text: str) -> str:
    """Basic markdown to ANSI terminal renderer."""
    # Headers
    text = re.sub(r"^# (.*)$", r"\033[1;34m# \1\033[0m", text, flags=re.MULTILINE)
    text = re.sub(r"^## (.*)$", r"\033[1;36m## \1\033[0m", text, flags=re.MULTILINE)
    text = re.sub(r"^### (.*)$", r"\033[1;32m### \1\033[0m", text, flags=re.MULTILINE)

    # Bold
    text = re.sub(r"\*\*(.*?)\*\*", r"\033[1m\1\033[0m", text)

    # List items
    text = re.sub(r"^- (.*)$", r"  • \1", text, flags=re.MULTILINE)

    return text


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
                print("Commands:")
                print("  help              Show this help")
                print("  history           Show command history")
                print("  status            Show status of the last mission")
                print("  plan              Show the current mission plan")
                print("  artifacts         List artifacts from the last mission")
                print("  show <idx|id>     Show artifact content")
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
                    print("No active mission status found.")
                    continue
                res = summary.get("result", {})
                print(f"\nStatus: {res.get('status', 'unknown')}")
                print(f"Summary: {res.get('verification_summary', 'N/A')}")
                continue

            if line.lower() == "plan":
                summary = service.get_mission_run_summary(mission_id)
                if not summary or "payload" not in summary:
                    print("No active mission plan found.")
                    continue
                steps = summary["payload"].get("steps", [])
                print(f"\nMission: {summary['payload'].get('title', 'Untitled')}")
                for i, step in enumerate(steps, 1):
                    status = step.get("status", "pending")
                    print(f"  {i}. [{status}] {step.get('title')}")
                continue

            if line.lower() == "artifacts":
                summary = service.get_mission_run_summary(mission_id)
                if not summary:
                    print("No mission artifacts found.")
                    continue
                res = summary.get("result", {})
                artifacts = res.get("artifacts", [])
                if not artifacts:
                    print("No artifacts produced yet.")
                    continue
                print(f"\nArtifacts ({len(artifacts)}):")
                for i, a in enumerate(artifacts, 1):
                    print(f"  {i:2}. {a.get('title')} ({a.get('id')[:8]})")
                continue

            if line.lower().startswith("show "):
                summary = service.get_mission_run_summary(mission_id)
                if not summary:
                    print("No mission data found.")
                    continue
                res = summary.get("result", {})
                artifacts = res.get("artifacts", [])
                target = line[5:].strip()
                artifact = None
                if target.isdigit():
                    idx = int(target) - 1
                    if 0 <= idx < len(artifacts):
                        artifact = artifacts[idx]
                else:
                    artifact = next((a for a in artifacts if a.get("id").startswith(target)), None)

                if not artifact:
                    print(f"Artifact '{target}' not found.")
                    continue

                path = Path(artifact.get("path"))
                if not path.exists():
                    print(f"Artifact file not found: {path}")
                    continue

                content = path.read_text(encoding="utf-8")
                print(f"\n--- {artifact.get('title')} ---")
                print(render_markdown(content))
                continue

            if line.lower().startswith("refine "):
                summary = service.get_mission_run_summary(mission_id)
                verification_summary = "N/A"
                if summary:
                    verification_summary = summary.get("result", {}).get("verification_summary", "N/A")
                elif last_result:
                    verification_summary = last_result.verification_summary

                feedback = line[7:].strip()
                objective = (
                    f"Refine previous mission results based on: {feedback}\n"
                    f"Previous summary: {verification_summary}"
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
