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


# ANSI color constants
CLR_RESET = "\033[0m"
CLR_BLUE = "\033[94m"
CLR_GREEN = "\033[92m"
CLR_YELLOW = "\033[93m"
CLR_RED = "\033[91m"
CLR_CYAN = "\033[96m"
CLR_BOLD = "\033[1m"


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
            line = input(f"\n{CLR_CYAN}{CLR_BOLD}jeanbot>{CLR_RESET} ").strip()
            if not line:
                continue
            if line.lower() in ("exit", "quit"):
                break

            history.append(line)

            if line.lower() == "help":
                print(f"{CLR_BOLD}Commands:{CLR_RESET}")
                print(f"  {CLR_GREEN}help{CLR_RESET}              Show this help")
                print(f"  {CLR_GREEN}history{CLR_RESET}           Show command history")
                print(f"  {CLR_GREEN}status{CLR_RESET}            Show current mission progress")
                print(f"  {CLR_GREEN}artifacts{CLR_RESET}         List mission artifacts")
                print(f"  {CLR_GREEN}view <path|id>{CLR_RESET}    View artifact content")
                print(f"  {CLR_GREEN}exit | quit{CLR_RESET}       Exit shell")
                print(f"  {CLR_GREEN}<objective>{CLR_RESET}       Plan and execute a mission")
                print(
                    f"  {CLR_GREEN}refine <feedback>{CLR_RESET} Refine the last mission result with feedback"
                )
                continue

            if line.lower() == "history":
                for i, cmd in enumerate(history, 1):
                    print(f"  {i:3}  {cmd}")
                continue

            if line.lower() == "status":
                summary = await service.get_mission_run_summary(current_mission_id)
                if not summary:
                    print(f"{CLR_YELLOW}No active mission found.{CLR_RESET}")
                else:
                    res = summary.get("result", {})
                    print(f"{CLR_BOLD}Mission Status: {res.get('status', 'unknown')}{CLR_RESET}")
                    print(f"Summary: {res.get('verification_summary', 'N/A')}")
                    print(f"Steps: {len(res.get('step_reports', []))}")
                    for step in res.get("step_reports", []):
                        print(f"  - {step['step_id']}: {step['summary']}")
                continue

            if line.lower() == "artifacts":
                summary = await service.get_mission_run_summary(current_mission_id)
                if not summary or not summary.get("result", {}).get("artifacts"):
                    print(f"{CLR_YELLOW}No artifacts found.{CLR_RESET}")
                else:
                    for i, art in enumerate(summary["result"]["artifacts"]):
                        print(f"  {i:2} [{art['kind']}] {art['title']} -> {art['path']}")
                continue

            if line.lower().startswith("view "):
                target = line[5:].strip()
                summary = await service.get_mission_run_summary(current_mission_id)
                found_path = None
                if summary and summary.get("result", {}).get("artifacts"):
                    for art in summary["result"]["artifacts"]:
                        if art["id"] == target or art["path"].endswith(target):
                            found_path = art["path"]
                            break
                if not found_path and Path(target).exists():
                    found_path = target

                if found_path:
                    print(f"{CLR_BLUE}--- Content of {found_path} ---{CLR_RESET}")
                    print(Path(found_path).read_text(encoding="utf-8"))
                    print(f"{CLR_BLUE}--- End of content ---{CLR_RESET}")
                else:
                    print(f"{CLR_RED}Artifact or file not found: {target}{CLR_RESET}")
                continue

            if line.lower().startswith("refine "):
                if not last_result:
                    # Try to restore from disk
                    summary = await service.get_mission_run_summary(current_mission_id)
                    if summary and summary.get("result"):
                        res = summary["result"]
                        from .executor import MissionRunResult, StepExecutionRecord, MissionArtifact
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

                if not last_result:
                    print(f"{CLR_RED}Nothing to refine. Run a mission first.{CLR_RESET}")
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

            if not line.lower().startswith("refine "):
                # Generate new ID for new missions
                current_mission_id = f"shell-{uuid.uuid4().hex[:8]}"

            payload = {
                "mission_id": current_mission_id,
                "workspace_id": args.workspace_id,
                "title": title,
                "objective": objective,
                "mode": args.mode,
            }

            print(f"{CLR_BOLD}Executing:{CLR_RESET} {CLR_CYAN}{title}{CLR_RESET}")
            last_result = await service.execute_payload(payload)

            print(f"\n{CLR_BOLD}Status:{CLR_RESET} {CLR_GREEN}{last_result.status}{CLR_RESET}")
            print(f"{CLR_BOLD}Summary:{CLR_RESET} {last_result.verification_summary}")
            if last_result.artifacts:
                print(f"{CLR_BOLD}Artifacts: {len(last_result.artifacts)}{CLR_RESET}")
                for artifact in last_result.artifacts:
                    print(f"  - {CLR_YELLOW}{artifact.title}{CLR_RESET}: {artifact.path}")

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
