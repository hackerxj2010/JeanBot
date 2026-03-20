from __future__ import annotations

import argparse
import asyncio
import json
import os
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
    execute_parser.add_argument(
        "--mode",
        choices=["local", "http"],
        default=os.environ.get("JEANBOT_SERVICE_MODE", "local"),
        help="Service orchestration mode",
    )
    execute_parser.add_argument(
        "--api-url",
        default=os.environ.get("JEANBOT_API_URL", "http://localhost:8080"),
        help="Backend API URL for http mode",
    )
    execute_parser.add_argument(
        "--token",
        default=os.environ.get("INTERNAL_SERVICE_TOKEN", "jeanbot-internal-dev-token"),
        help="Internal service token for http mode",
    )

    finalize_parser = subparsers.add_parser(
        "finalize-distributed",
        help="Finalize a distributed mission payload with active_execution",
    )
    finalize_parser.add_argument("--mission-file", required=True, help="Mission payload JSON file")
    finalize_parser.add_argument("--workspace-root", required=True, help="Workspace root path")
    finalize_parser.add_argument(
        "--mode",
        choices=["local", "http"],
        default=os.environ.get("JEANBOT_SERVICE_MODE", "local"),
        help="Service orchestration mode",
    )
    finalize_parser.add_argument(
        "--api-url",
        default=os.environ.get("JEANBOT_API_URL", "http://localhost:8080"),
        help="Backend API URL for http mode",
    )
    finalize_parser.add_argument(
        "--token",
        default=os.environ.get("INTERNAL_SERVICE_TOKEN", "jeanbot-internal-dev-token"),
        help="Internal service token for http mode",
    )

    return parser


async def run_command(args: argparse.Namespace) -> dict:
    if args.command == "write-template":
        service = MissionExecutorService(workspace_root=".")
        path = service.write_payload_template(args.output)
        return {"command": "write-template", "output": str(Path(path))}

    service = MissionExecutorService(
        workspace_root=args.workspace_root,
        service_mode=args.mode,
        api_url=args.api_url,
        internal_token=args.token,
    )
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
