from __future__ import annotations

import argparse
import asyncio
import json
import re
import uuid
from pathlib import Path
from typing import Any, Sequence

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
    shell_parser.add_argument(
        "--workspace-id", default="workspace-interactive", help="Workspace ID"
    )
    shell_parser.add_argument(
        "--mode", choices=["local", "live"], default="local", help="Execution mode"
    )
    shell_parser.add_argument("--mission-id", help="Mission ID to resume")

    return parser


def render_markdown(text: str) -> str:
    # Basic ANSI colors for terminal rendering
    bold = "\033[1m"
    cyan = "\033[36m"
    green = "\033[32m"
    yellow = "\033[33m"
    reset = "\033[0m"

    # Headers
    text = re.sub(r"^# (.*)$", f"{bold}{cyan}# \\1{reset}", text, flags=re.MULTILINE)
    text = re.sub(r"^## (.*)$", f"{bold}{cyan}## \\1{reset}", text, flags=re.MULTILINE)
    text = re.sub(r"^### (.*)$", f"{bold}{cyan}### \\1{reset}", text, flags=re.MULTILINE)

    # Bold
    text = re.sub(r"\*\*(.*?)\*\*", f"{bold}\\1{reset}", text)

    # Lists
    text = re.sub(r"^([ \t]*)[-\*] (.*)$", f"\\1{yellow}•{reset} \\2", text, flags=re.MULTILINE)

    # Success/Failure markers
    text = text.replace("✓", f"{green}✓{reset}").replace("✗", f"\033[31m✗{reset}")

    return text


class InteractiveShell:
    def __init__(self, service: MissionExecutorService, workspace_id: str, mode: str):
        self.service = service
        self.workspace_id = workspace_id
        self.mode = mode
        self.mission_id = f"shell-{uuid.uuid4().hex[:8]}"
        self.history: list[str] = []
        self.last_result: Any = None

    async def run(self):
        try:
            import readline  # Enable history and line editing
        except ImportError:
            pass

        print(f"\033[1;32mJeanBot interactive shell\033[0m ({self.mode} mode)")
        print(f"Workspace: {self.service.workspace_root} ({self.workspace_id})")
        print("Type 'help' for commands or an objective to start a mission.")

        while True:
            try:
                line = input("\njeanbot> ").strip()
                if not line:
                    continue
                if line.lower() in ("exit", "quit"):
                    break

                self.history.append(line)

                if line.lower() == "help":
                    self.do_help()
                elif line.lower() == "history":
                    self.do_history()
                elif line.lower() == "status":
                    self.do_status()
                elif line.lower() == "plan":
                    self.do_plan()
                elif line.lower() == "artifacts":
                    self.do_artifacts()
                elif line.lower().startswith("show "):
                    self.do_show(line[5:].strip())
                elif line.lower().startswith("refine "):
                    await self.do_refine(line[7:].strip())
                else:
                    await self.do_execute(line)

            except KeyboardInterrupt:
                print("\nInterrupt received, type 'exit' to quit.")
            except Exception as e:
                print(f"\n\033[31mError:\033[0m {e}")

    def do_help(self):
        print("\033[1mCommands:\033[0m")
        print("  help              Show this help")
        print("  history           Show command history")
        print("  status            Show current mission status")
        print("  plan              Show current mission plan")
        print("  artifacts         List mission artifacts")
        print("  show <id|index>   Show artifact content (renders Markdown)")
        print("  refine <feedback> Refine the last result with feedback")
        print("  exit | quit       Exit shell")
        print("  <objective>       Plan and execute a new mission")

    def do_history(self):
        for i, cmd in enumerate(self.history, 1):
            print(f"  {i:3}  {cmd}")

    def do_status(self):
        summary = self.service.get_mission_run_summary(self.mission_id)
        if not summary:
            print("No active mission status found.")
            return

        res = summary.get("result", {})
        print(f"\033[1mStatus:\033[0m {res.get('status', 'unknown')}")
        print(f"\033[1mSummary:\033[0m {res.get('verification_summary', 'N/A')}")

        metrics = res.get("metrics", {})
        if metrics:
            print(f"\033[1mMetrics:\033[0m {metrics.get('completed_steps', 0)}/{metrics.get('total_steps', 0)} steps, {metrics.get('average_score', 0)} avg score")

    def do_plan(self):
        payload = self.service.get_mission_payload(self.mission_id)
        if not payload:
            print("No mission plan found.")
            return

        print(f"\033[1mPlan: {payload.get('title')}\033[0m")
        for step in payload.get("steps", []):
            status = step.get("status", "pending")
            color = "\033[32m" if status == "completed" else "\033[33m" if status == "running" else ""
            print(f"  {color}[{status:9}]\033[0m {step.get('id')}: {step.get('title')}")

    def do_artifacts(self):
        summary = self.service.get_mission_run_summary(self.mission_id)
        if not summary or "result" not in summary:
            print("No artifacts found.")
            return

        artifacts = summary["result"].get("artifacts", [])
        if not artifacts:
            print("No artifacts produced yet.")
            return

        print("\033[1mArtifacts:\033[0m")
        for i, art in enumerate(artifacts, 1):
            print(f"  {i:2}. [{art.get('kind', 'file')}] {art.get('title')} ({art.get('id')[:8]})")
            print(f"      Path: {art.get('path')}")

    def do_show(self, arg: str):
        summary = self.service.get_mission_run_summary(self.mission_id)
        if not summary or "result" not in summary:
            print("No mission data found.")
            return

        artifacts = summary["result"].get("artifacts", [])
        target = None

        if arg.isdigit():
            idx = int(arg) - 1
            if 0 <= idx < len(artifacts):
                target = artifacts[idx]
        else:
            target = next((a for a in artifacts if a.get("id", "").startswith(arg)), None)

        if not target:
            print(f"Artifact '{arg}' not found.")
            return

        path = Path(target["path"])
        if not path.exists():
            print(f"Artifact file not found: {path}")
            return

        content = path.read_text(encoding="utf-8")
        print(f"\n\033[1;36m--- {target['title']} ---\033[0m\n")
        if target.get("kind") in ("log", "report") or path.suffix == ".md":
            print(render_markdown(content))
        else:
            print(content)

    async def do_refine(self, feedback: str):
        if not self.last_result:
            # Try to recover from persistence if available
            summary = self.service.get_mission_run_summary(self.mission_id)
            if not summary:
                print("Nothing to refine. Run a mission first.")
                return
            # Use verification summary from persisted result
            prev_summary = summary.get("result", {}).get("verification_summary", "")
        else:
            prev_summary = self.last_result.verification_summary

        objective = (
            f"Refine previous mission results based on: {feedback}\n"
            f"Previous summary: {prev_summary}"
        )
        await self.do_execute(objective, title=f"Refinement: {feedback[:30]}...")

    async def do_execute(self, objective: str, title: str | None = None):
        if not title:
            title = f"Mission: {objective[:30]}..."

        payload = {
            "mission_id": self.mission_id,
            "workspace_id": self.workspace_id,
            "title": title,
            "objective": objective,
            "mode": self.mode,
        }

        # Check for existing state to resume/replan
        state = self.service.get_mission_state(self.mission_id)
        if state:
            payload.update(state)

        print(f"Executing: \033[1m{title}\033[0m")
        self.last_result = await self.service.execute_payload(payload)

        print(f"\n\033[1mStatus:\033[0m {self.last_result.status}")
        print(f"\033[1mSummary:\033[0m {self.last_result.verification_summary}")
        if self.last_result.artifacts:
            print(f"\033[1mArtifacts produced:\033[0m {len(self.last_result.artifacts)}")


async def run_shell(args: argparse.Namespace):
    service = MissionExecutorService(workspace_root=args.workspace_root, mode=args.mode)
    shell = InteractiveShell(service, args.workspace_id, args.mode)
    if args.mission_id:
        shell.mission_id = args.mission_id
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
