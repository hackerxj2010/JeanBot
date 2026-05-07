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


def render_markdown(text: str) -> str:
    """Basic ANSI renderer for markdown for terminal display."""
    lines = []
    for line in text.splitlines():
        if line.startswith("# "):
            lines.append(f"\033[1;34m{line[2:]}\033[0m")  # Bold Blue
        elif line.startswith("## "):
            lines.append(f"\033[1;36m{line[3:]}\033[0m")  # Bold Cyan
        elif line.startswith("- "):
            lines.append(f"  \033[32m•\033[0m {line[2:]}")  # Green bullet
        elif "**" in line:
            parts = line.split("**")
            new_line = ""
            for i, part in enumerate(parts):
                new_line += f"\033[1m{part}\033[0m" if i % 2 == 1 else part
            lines.append(new_line)
        else:
            lines.append(line)
    return "\n".join(lines)


class InteractiveShell:
    def __init__(self, workspace_root: str, workspace_id: str, mode: str):
        self.workspace_root = workspace_root
        self.workspace_id = workspace_id
        self.mode = mode
        self.service = MissionExecutorService(workspace_root=workspace_root, mode=mode)
        self.last_result = None
        self.mission_id = f"shell-{uuid.uuid4().hex[:8]}"
        self.history: list[str] = []

    async def run(self):
        try:
            import readline
        except ImportError:
            pass

        print(f"JeanBot interactive shell ({self.mode} mode)")
        print(f"Workspace: {self.workspace_root} ({self.workspace_id})")
        print("Type 'exit' or 'quit' to end session. Type 'help' for commands.")

        while True:
            try:
                line = input("\njeanbot> ").strip()
                if not line:
                    continue
                if line.lower() in ("exit", "quit"):
                    break

                self.history.append(line)
                await self.handle_command(line)
            except KeyboardInterrupt:
                print("\nInterrupt received, type 'exit' to quit.")
            except Exception as e:
                print(f"\nError: {e}")

    async def handle_command(self, line: str):
        cmd = line.lower()
        if cmd == "help":
            self.show_help()
        elif cmd == "history":
            self.show_history()
        elif cmd == "status":
            self.show_status()
        elif cmd == "plan":
            self.show_plan()
        elif cmd == "artifacts":
            self.show_artifacts()
        elif cmd.startswith("show "):
            await self.show_artifact(line[5:].strip())
        elif cmd.startswith("refine "):
            await self.refine_mission(line[7:].strip())
        else:
            await self.execute_mission(line)

    def show_help(self):
        print("Commands:")
        print("  help              Show this help")
        print("  history           Show command history")
        print("  status            Show last mission status and metrics")
        print("  plan              Show last mission plan and steps")
        print("  artifacts         List artifacts from the last mission")
        print("  show <index|id>   Display artifact content (by index or prefix)")
        print("  refine <feedback> Refine the last mission result with feedback")
        print("  exit | quit       Exit shell")
        print("  <objective>       Plan and execute a new mission")

    def show_history(self):
        for i, cmd in enumerate(self.history, 1):
            print(f"  {i:3}  {cmd}")

    def show_status(self):
        if not self.last_result:
            print("No mission executed yet.")
            return
        res = self.last_result
        print(f"\nMission ID: {res.mission_id}")
        print(f"Status: {res.status}")
        print(f"Summary: {res.verification_summary}")
        if res.metrics:
            print("Metrics:")
            for k, v in res.metrics.items():
                print(f"  {k}: {v}")

    def show_plan(self):
        if not self.last_result:
            print("No mission executed yet.")
            return
        p = Path(self.workspace_root) / ".jeanbot" / "missions" / self.last_result.mission_id / "mission-payload.json"
        if not p.exists():
            print("Mission plan payload not found.")
            return
        payload = json.loads(p.read_text(encoding="utf-8"))
        print(f"\nPlan: {payload.get('title', 'Untitled')}")
        for step in payload.get("steps", []):
            icon = "✓" if step.get("status") == "completed" else "○"
            print(f"  {icon} [{step.get('id')}] {step.get('title')}")

    def show_artifacts(self):
        if not self.last_result or not self.last_result.artifacts:
            print("No artifacts found.")
            return
        print(f"\nArtifacts ({len(self.last_result.artifacts)}):")
        for i, art in enumerate(self.last_result.artifacts, 1):
            print(f"  {i:2}. [{art.id[:8]}] {art.title} ({art.kind})")

    async def show_artifact(self, target: str):
        if not self.last_result or not self.last_result.artifacts:
            print("No artifacts to show.")
            return
        artifact = None
        if target.isdigit():
            idx = int(target) - 1
            if 0 <= idx < len(self.last_result.artifacts):
                artifact = self.last_result.artifacts[idx]
        else:
            artifact = next((a for a in self.last_result.artifacts if a.id.startswith(target)), None)

        if not artifact:
            print(f"Artifact not found: {target}")
            return

        p = Path(artifact.path)
        if not p.exists():
            print(f"Artifact file missing: {p}")
            return

        print(f"\n--- {artifact.title} ({artifact.kind}) ---")
        content = p.read_text(encoding="utf-8")
        if artifact.kind in ("log", "report") or p.suffix == ".md":
            print(render_markdown(content))
        else:
            print(content)

    async def refine_mission(self, feedback: str):
        if not self.last_result:
            print("Nothing to refine. Run a mission first.")
            return
        objective = (
            f"Refine previous mission results based on: {feedback}\n"
            f"Previous summary: {self.last_result.verification_summary}"
        )
        await self.execute_mission(objective, title=f"Refinement: {feedback[:30]}...")

    async def execute_mission(self, objective: str, title: str | None = None):
        if not title:
            title = f"Mission: {objective[:30]}..."
        payload = {
            "mission_id": self.mission_id,
            "workspace_id": self.workspace_id,
            "title": title,
            "objective": objective,
            "mode": self.mode,
        }
        print(f"Executing: {title}")
        self.last_result = await self.service.execute_payload(payload)
        print(f"\nStatus: {self.last_result.status}")
        print(f"Summary: {self.last_result.verification_summary}")
        if self.last_result.artifacts:
            print(f"Artifacts: {len(self.last_result.artifacts)} (type 'artifacts' to list)")


async def run_shell(args: argparse.Namespace):
    shell = InteractiveShell(
        workspace_root=args.workspace_root,
        workspace_id=args.workspace_id,
        mode=args.mode
    )
    await shell.run()


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
