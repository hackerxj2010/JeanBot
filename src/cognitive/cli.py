from __future__ import annotations

import argparse
import asyncio
import json
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

    shell_parser = subparsers.add_parser("shell", help="Start an interactive mission shell")
    shell_parser.add_argument("--workspace-root", required=True, help="Workspace root path")

    return parser


async def run_shell(args: argparse.Namespace) -> dict:
    from .service import MissionExecutorService
    service = MissionExecutorService(workspace_root=args.workspace_root)
    print("--- JeanBot Universal AI Employee Shell ---")
    print(f"Workspace: {args.workspace_root}")
    print("Type 'exit' to quit.")

    while True:
        try:
            prompt = input("\njeanbot> ").strip()
            if not prompt:
                continue
            if prompt.lower() in ("exit", "quit"):
                break

            payload = {
                "workspace_id": "shell-workspace",
                "title": f"Shell Mission: {prompt[:30]}...",
                "objective": prompt,
            }

            print(f"[*] Planning and executing mission: {prompt}")
            result = await service.execute_payload(payload)
            print(f"[*] Mission {result.status}: {result.verification_summary}")

            if result.artifacts:
                print("[*] Artifacts generated:")
                for artifact in result.artifacts:
                    print(f"  - {artifact.title}: {artifact.path}")

        except KeyboardInterrupt:
            print("\nInterrupt received. Use 'exit' to quit.")
        except Exception as e:
            print(f"[!] Error: {e}")

    return {"command": "shell", "status": "closed"}


async def run_command(args: argparse.Namespace) -> dict:
    if args.command == "shell":
        return await run_shell(args)

    if args.command == "write-template":
        service = MissionExecutorService(workspace_root=".")
        path = service.write_payload_template(args.output)
        return {"command": "write-template", "output": str(Path(path))}

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
