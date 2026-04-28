from __future__ import annotations

import argparse
import asyncio
import json
import uuid
from pathlib import Path
from typing import Sequence

from .executor import (
    MissionArtifact,
    MissionRunResult,
    StepExecutionDiagnostics,
    StepExecutionRecord,
)
from .service import MissionExecutorService

# ANSI Color Constants
GREEN = "\033[92m"
BLUE = "\033[94m"
YELLOW = "\033[93m"
RED = "\033[91m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"


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
    print(f"{BOLD}{GREEN}JeanBot interactive shell{RESET} ({BLUE}{args.mode}{RESET} mode)")
    print(f"Workspace: {CYAN}{args.workspace_root}{RESET} ({YELLOW}{args.workspace_id}{RESET})")
    print("Type 'exit' or 'quit' to end session. Type 'help' for commands.")

    last_result = None
    mission_id = f"shell-{uuid.uuid4().hex[:8]}"
    history: list[str] = []

    while True:
        try:
            prompt = f"\n{BOLD}{GREEN}jeanbot>{RESET} "
            line = input(prompt).strip()
            if not line:
                continue
            if line.lower() in ("exit", "quit"):
                break

            history.append(line)

            if line.lower() == "help":
                print(f"{BOLD}Commands:{RESET}")
                print(f"  {CYAN}help{RESET}               Show this help")
                print(f"  {CYAN}history{RESET}            Show command history")
                print(f"  {CYAN}status{RESET}             Show current mission status")
                print(f"  {CYAN}artifacts{RESET}          List produced artifacts")
                print(f"  {CYAN}view <path|id>{RESET}     View artifact content")
                print(f"  {CYAN}exit | quit{RESET}        Exit shell")
                print(f"  {CYAN}<objective>{RESET}        Plan and execute a mission")
                print(f"  {CYAN}refine <feedback>{RESET}  Refine the last mission result with feedback")
                continue

            if line.lower() == "history":
                print(f"{BOLD}History:{RESET}")
                for i, cmd in enumerate(history, 1):
                    print(f"  {i:3}  {cmd}")
                continue

            if line.lower() == "status":
                current_id = mission_id
                try:
                    summary = service.get_mission_run_summary(current_id)
                    res = summary.get("result", {})
                    print(f"{BOLD}Mission Status ({current_id}):{RESET}")
                    print(f"  Objective: {summary['mission']['objective']}")
                    print(f"  Status: {res.get('status', 'unknown')}")
                    print(f"  Plan Version: {summary.get('plan_version', 1)}")
                    print(f"  Steps: {len(res.get('step_reports', []))}")
                    for report in res.get("step_reports", []):
                        diag = report.get("diagnostics") or {}
                        score = diag.get("overall_score", 0.0)
                        print(f"    - {report['step_id']}: score={score:.2f}")
                except Exception:
                    print(f"{YELLOW}No active mission data found for {current_id}.{RESET}")
                continue

            if line.lower() == "artifacts":
                current_id = mission_id
                try:
                    summary = service.get_mission_run_summary(current_id)
                    res = summary.get("result", {})
                    arts = res.get("artifacts", [])
                    if not arts:
                        print("No artifacts found.")
                    else:
                        print(f"{BOLD}Artifacts ({current_id}):{RESET}")
                        for art in arts:
                            print(f"  - [{CYAN}{art['id'][:8]}{RESET}] {art['title']}: {art['path']}")
                except Exception:
                    print(f"{YELLOW}No mission data found to list artifacts.{RESET}")
                continue

            if line.lower().startswith("view "):
                target = line[5:].strip()
                current_id = mission_id
                try:
                    summary = service.get_mission_run_summary(current_id)
                    res = summary.get("result", {})
                    arts = res.get("artifacts", [])
                    path = None
                    for art in arts:
                        if art["id"].startswith(target) or art["path"] == target:
                            path = art["path"]
                            break

                    if not path and Path(target).exists():
                        path = target

                    if path:
                        print(f"{BOLD}Content of {path}:{RESET}")
                        print("-" * 40)
                        print(Path(path).read_text(encoding="utf-8"))
                        print("-" * 40)
                    else:
                        print(f"{RED}Artifact not found: {target}{RESET}")
                except Exception as e:
                    print(f"{RED}Error viewing artifact: {e}{RESET}")
                continue

            if line.lower().startswith("refine "):
                if not last_result:
                    # Try to restore from disk
                    try:
                        summary = service.get_mission_run_summary(mission_id)
                        res = summary.get("result", {})

                        # Reconstruct a minimal last_result for refine logic
                        last_result = MissionRunResult(
                            mission_id=res["mission_id"],
                            status=res["status"],
                            execution_mode=res["execution_mode"],
                            verification_summary=res["verification_summary"],
                            outputs=res["outputs"],
                            memory_updates=res["memory_updates"],
                            step_reports=[
                                StepExecutionRecord(
                                    **{k: v for k, v in r.items() if k != "diagnostics"},
                                    diagnostics=(
                                        StepExecutionDiagnostics(**r["diagnostics"])
                                        if r.get("diagnostics")
                                        else None
                                    ),
                                )
                                for r in res["step_reports"]
                            ],
                            artifacts=[MissionArtifact(**a) for a in res["artifacts"]],
                            metrics=res["metrics"],
                            gaps=res["gaps"],
                            decision_log=res["decision_log"],
                            started_at=res["started_at"],
                            finished_at=res["finished_at"],
                        )
                    except Exception:
                        print(f"{RED}Nothing to refine. Run a mission first.{RESET}")
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

            print(f"{BOLD}{YELLOW}Executing:{RESET} {title}")
            last_result = await service.execute_payload(payload)

            status_color = GREEN if last_result.status == "completed" else RED
            print(f"\n{BOLD}Status:{RESET} {status_color}{last_result.status}{RESET}")
            print(f"{BOLD}Summary:{RESET} {last_result.verification_summary}")
            if last_result.artifacts:
                print(f"{BOLD}Artifacts:{RESET} {len(last_result.artifacts)}")
                for artifact in last_result.artifacts:
                    print(f"  - {CYAN}{artifact.title}{RESET}: {artifact.path}")

        except KeyboardInterrupt:
            print(f"\n{YELLOW}Interrupt received, type 'exit' to quit.{RESET}")
        except Exception as e:
            print(f"\n{RED}Error: {e}{RESET}")


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
