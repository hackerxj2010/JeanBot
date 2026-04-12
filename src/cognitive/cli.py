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
    execute_parser.add_argument("--mode", help="Execution mode (local or http)")
    execute_parser.add_argument("--api-url", help="Base URL for live services")
    execute_parser.add_argument("--token", help="Internal service token")

    finalize_parser = subparsers.add_parser(
        "finalize-distributed",
        help="Finalize a distributed mission payload with active_execution",
    )
    finalize_parser.add_argument("--mission-file", required=True, help="Mission payload JSON file")
    finalize_parser.add_argument("--workspace-root", required=True, help="Workspace root path")
    finalize_parser.add_argument("--mode", help="Execution mode (local or http)")
    finalize_parser.add_argument("--api-url", help="Base URL for live services")
    finalize_parser.add_argument("--token", help="Internal service token")

    return parser


async def run_command(args: argparse.Namespace) -> dict:
    if args.command == "write-template":
        service = MissionExecutorService(workspace_root=".")
        path = service.write_payload_template(args.output)
        return {"command": "write-template", "output": str(Path(path))}

    service = MissionExecutorService(
        workspace_root=args.workspace_root,
        mode=args.mode or "local",
        api_url=args.api_url or "http://localhost:8080",
        internal_token=args.token or "jeanbot-internal-dev-token",
    )
    payload = service.load_payload(args.mission_file)

    # Allow CLI overrides to persist into the payload for the executor
    if args.mode:
        payload["mode"] = args.mode
    if args.api_url:
        payload["api_url"] = args.api_url
    if args.token:
        payload["token"] = args.token

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
