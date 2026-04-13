from __future__ import annotations

import base64
import hashlib
import json
import os
import random
import asyncio
from dataclasses import asdict, dataclass, field, is_dataclass
from pathlib import Path
from typing import Any

try:
    import httpx
except ModuleNotFoundError:  # pragma: no cover - handled at runtime when live mode is used
    httpx = None

from .executor import (
    ActiveExecutionState,
    ExecutionContext,
    MissionObjective,
    MissionPlan,
    MissionStep,
    PolicyDecision,
    StepExecutionDiagnostics,
    StepExecutionRecord,
    SubAgentExecutionResult,
    SubAgentTemplate,
    utc_now_iso,
)


def ensure_directory(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def stable_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def utc_json(value: Any) -> str:
    return json.dumps(value, indent=2, sort_keys=True, default=asdict_fallback)


def asdict_fallback(obj: Any) -> Any:
    if is_dataclass(obj):
        return asdict(obj)
    if isinstance(obj, Path):
        return str(obj)
    if hasattr(obj, "__dict__"):
        return obj.__dict__
    return str(obj)


@dataclass
class AuditEventRecord:
    event: str
    entity_id: str
    service: str
    data: dict[str, Any]


@dataclass
class MemoryRecord:
    workspace_id: str
    text: str
    tags: list[str]
    memory_type: str
    importance: float


@dataclass
class LocalAuditService:
    output_root: str
    records: list[AuditEventRecord] = field(default_factory=list)

    def _audit_dir(self) -> Path:
        return ensure_directory(Path(self.output_root) / ".jeanbot" / "audit")

    async def record(self, event: str, entity_id: str, service: str, data: dict):
        record = AuditEventRecord(event=event, entity_id=entity_id, service=service, data=data)
        self.records.append(record)
        file_name = f"{len(self.records):04d}-{stable_hash(event + entity_id)[:12]}.json"
        path = self._audit_dir() / file_name
        path.write_text(utc_json(asdict(record)), encoding="utf-8")

    def list_events(self, event_prefix: str | None = None) -> list[AuditEventRecord]:
        if event_prefix is None:
            return list(self.records)
        return [record for record in self.records if record.event.startswith(event_prefix)]

    def summarize(self) -> dict[str, Any]:
        by_event: dict[str, int] = {}
        for record in self.records:
            by_event[record.event] = by_event.get(record.event, 0) + 1
        return {
            "total_records": len(self.records),
            "events": by_event,
        }


@dataclass
class HttpAuditService:
    http_base: HttpBaseService

    async def record(self, event: str, entity_id: str, service: str, data: dict):
        # Map parameters to backend expected fields: event->kind, entity_id->entityId, service->actor, data->details
        payload = {
            "kind": event,
            "entityId": entity_id,
            "actor": service,
            "details": data,
        }
        await self.http_base.post("/api/audit/record", "audit-service", payload)

    def summarize(self) -> dict[str, Any]:
        return {"mode": "http", "status": "active"}


@dataclass
class LocalMemoryService:
    output_root: str
    records: list[MemoryRecord] = field(default_factory=list)

    def _memory_dir(self) -> Path:
        return ensure_directory(Path(self.output_root) / ".jeanbot" / "memories")

    async def remember(
        self,
        workspace_id: str,
        text: str,
        tags: list[str],
        memory_type: str,
        importance: float,
    ):
        record = MemoryRecord(
            workspace_id=workspace_id,
            text=text,
            tags=list(tags),
            memory_type=memory_type,
            importance=importance,
        )
        self.records.append(record)
        file_name = f"{len(self.records):04d}-{stable_hash(text)[:12]}.json"
        path = self._memory_dir() / file_name
        path.write_text(utc_json(asdict(record)), encoding="utf-8")

    def search(
        self,
        workspace_id: str,
        query: str,
        limit: int = 5,
    ) -> list[MemoryRecord]:
        query_terms = {term.lower() for term in query.split() if term.strip()}
        scored: list[tuple[float, MemoryRecord]] = []
        for record in self.records:
            if record.workspace_id != workspace_id:
                continue
            haystack = f"{record.text} {' '.join(record.tags)}".lower()
            matches = sum(1 for term in query_terms if term in haystack)
            score = matches + record.importance
            if score > 0:
                scored.append((score, record))
        scored.sort(key=lambda item: item[0], reverse=True)
        return [record for _, record in scored[:limit]]

    def summarize(self, workspace_id: str) -> dict[str, Any]:
        relevant = [record for record in self.records if record.workspace_id == workspace_id]
        return {
            "workspace_id": workspace_id,
            "memory_count": len(relevant),
            "top_tags": self._top_tags(relevant),
        }

    def _top_tags(self, records: list[MemoryRecord]) -> list[tuple[str, int]]:
        counts: dict[str, int] = {}
        for record in records:
            for tag in record.tags:
                counts[tag] = counts.get(tag, 0) + 1
        return sorted(counts.items(), key=lambda item: item[1], reverse=True)[:8]


@dataclass
class HttpMemoryService:
    http_base: HttpBaseService

    async def remember(
        self,
        workspace_id: str,
        text: str,
        tags: list[str],
        memory_type: str,
        importance: float,
    ):
        payload = {
            "workspaceId": workspace_id,
            "content": text,
            "tags": tags,
            "type": memory_type,
            "importance": importance,
        }
        await self.http_base.post("/api/memory/remember", "memory-service", payload)

    def summarize(self, workspace_id: str) -> dict[str, Any]:
        return {"workspace_id": workspace_id, "mode": "http", "status": "active"}


@dataclass
class HttpBrowserService:
    http_base: HttpBaseService

    async def navigate(self, mission_id: str, url: str) -> dict[str, Any]:
        return await self.http_base.post(
            "/api/browser/navigate",
            "browser-service",
            {"missionId": mission_id, "url": url},
        )

    async def capture(self, mission_id: str) -> str:
        result = await self.http_base.post(
            "/api/browser/capture",
            "browser-service",
            {"missionId": mission_id},
        )
        return result.get("screenshotPath", "")

    async def extract(self, mission_id: str, selectors: list[str]) -> dict[str, Any]:
        return await self.http_base.post(
            "/api/browser/extract",
            "browser-service",
            {"missionId": mission_id, "selectors": selectors},
        )


@dataclass
class HttpTerminalService:
    http_base: HttpBaseService

    async def run(self, mission_id: str, command: str, cwd: str | None = None) -> dict[str, Any]:
        return await self.http_base.post(
            "/api/terminal/run",
            "terminal-service",
            {"missionId": mission_id, "command": command, "cwd": cwd},
        )


@dataclass
class HttpFileService:
    http_base: HttpBaseService

    async def update_workspace_context(
        self,
        workspace_root: str,
        mission_title: str,
        completed_steps: list[str],
        running_steps: list[str],
        pending_steps: list[str],
    ):
        payload = {
            "toolId": "filesystem.workspace.context.update",
            "arguments": {
                "workspaceRoot": workspace_root,
                "missionTitle": mission_title,
                "completedSteps": completed_steps,
                "runningSteps": running_steps,
                "pendingSteps": pending_steps,
            },
        }
        await self.http_base.post("/api/tools/execute", "file-service", payload)

    async def write_artifact(
        self,
        workspace_root: str,
        mission_id: str,
        filename: str,
        content: str,
    ) -> str:
        payload = {
            "toolId": "filesystem.artifact.write",
            "arguments": {
                "workspaceRoot": workspace_root,
                "missionId": mission_id,
                "filename": filename,
                "content": content,
            },
        }
        result = await self.http_base.post("/api/tools/execute", "file-service", payload)
        return result.get("path", "")

    def artifact_paths(self, mission_id: str) -> list[str]:
        return []

    async def save_mission_state(self, mission_id: str, state: dict[str, Any]):
        payload = {
            "missionId": mission_id,
            "state": state,
        }
        await self.http_base.post("/api/mission/state/save", "agent-orchestrator", payload)

    async def load_mission_state(self, mission_id: str) -> dict[str, Any] | None:
        try:
            result = await self.http_base.post(
                "/api/mission/state/load",
                "agent-orchestrator",
                {"missionId": mission_id},
            )
            return result.get("state")
        except Exception:
            return None


@dataclass
class LocalFileService:
    output_root: str
    context_history: list[dict[str, Any]] = field(default_factory=list)

    def _workspace_dir(self) -> Path:
        return ensure_directory(Path(self.output_root))

    def _jeanbot_dir(self) -> Path:
        return ensure_directory(self._workspace_dir() / ".jeanbot")

    def _artifact_dir(self, mission_id: str) -> Path:
        return ensure_directory(self._jeanbot_dir() / "artifacts" / mission_id)

    def _state_dir(self) -> Path:
        return ensure_directory(self._jeanbot_dir() / "state")

    async def update_workspace_context(
        self,
        workspace_root: str,
        mission_title: str,
        completed_steps: list[str],
        running_steps: list[str],
        pending_steps: list[str],
    ):
        payload = {
            "mission_title": mission_title,
            "completed_steps": completed_steps,
            "running_steps": running_steps,
            "pending_steps": pending_steps,
        }
        self.context_history.append(payload)
        context_dir = ensure_directory(self._jeanbot_dir() / "plans")
        context_path = context_dir / "python-workspace-context.json"
        context_path.write_text(utc_json(payload), encoding="utf-8")

    async def write_artifact(
        self,
        workspace_root: str,
        mission_id: str,
        filename: str,
        content: str,
    ) -> str:
        path = self._artifact_dir(mission_id) / filename
        path.write_text(content, encoding="utf-8")
        return str(path)

    def artifact_paths(self, mission_id: str) -> list[str]:
        artifact_dir = self._artifact_dir(mission_id)
        return sorted(str(path) for path in artifact_dir.glob("*"))

    async def save_mission_state(self, mission_id: str, state: dict[str, Any]):
        path = self._state_dir() / f"mission-{mission_id}.json"
        path.write_text(utc_json(state), encoding="utf-8")

    async def load_mission_state(self, mission_id: str) -> dict[str, Any] | None:
        path = self._state_dir() / f"mission-{mission_id}.json"
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))


class HttpBaseService:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.token = token

    def _get_headers(self, service_name: str, auth_context: dict | None = None) -> dict[str, str]:
        headers = {
            "x-jeanbot-internal-service": service_name,
            "x-jeanbot-internal-token": self.token,
            "content-type": "application/json",
        }
        if auth_context:
            auth_json = json.dumps(auth_context)
            headers["x-jeanbot-auth-context"] = base64.b64encode(auth_json.encode()).decode()
        return headers

    async def post(
        self,
        path: str,
        service_name: str,
        payload: dict[str, Any],
        auth_context: dict | None = None,
        timeout: float = 30.0,
    ) -> dict[str, Any]:
        if httpx is None:
            raise RuntimeError(
                "Live mode requires optional dependency 'httpx'. Install it with: pip install httpx"
            )

        url = f"{self.base_url}/{path.lstrip('/')}"
        headers = self._get_headers(service_name, auth_context)

        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            return response.json()


@dataclass
class StaticPolicyService:
    approval_required: bool = False
    default_risk: str = "low"
    capability_risk: dict[str, str] = field(default_factory=dict)

    def evaluate_mission(self, mission_data: dict) -> PolicyDecision:
        objective_text = mission_data.get("objective", "")
        title = mission_data.get("title", "")
        risk = self.default_risk
        lowered = f"{title}\n{objective_text}".lower()
        for capability, mapped_risk in self.capability_risk.items():
            if capability.lower() in lowered:
                risk = mapped_risk
                break
        approval_required = self.approval_required or risk in {"high", "critical"}
        return PolicyDecision(approval_required=approval_required, risk=risk)


@dataclass
class HttpRuntimeService:
    http_base: HttpBaseService = field(
        default_factory=lambda: HttpBaseService(
            base_url=os.environ.get("AGENT_RUNTIME_URL", "http://localhost:8084"),
            token=os.environ.get("INTERNAL_SERVICE_TOKEN", "jeanbot-internal-dev-token"),
        )
    )

    def prepare_frame(
        self,
        objective: MissionObjective,
        step: MissionStep,
        plan: MissionPlan,
        template: SubAgentTemplate,
        context: ExecutionContext,
    ) -> dict[str, Any]:
        return {
            "model": {
                "provider": template.provider or "anthropic",
                "model": template.model or "claude-sonnet-4-6",
                "reason": "Python adapter frame preparation.",
            },
            "workspaceContext": "Python local workspace frame.",
            "memorySummary": "Python local memory summary.",
            "availableTools": template.tool_ids or [],
            "policyPosture": "Python static policy posture.",
            "systemPrompt": "Python-initiated live execution.",
            "specialistPrompt": template.instructions or "Execute the mission step.",
        }

    async def execute_task(self, request: dict[str, Any]) -> dict[str, Any]:
        return await self.http_base.post(
            "/internal/runtime/execute",
            "agent-orchestrator",
            request,
            timeout=300.0,
        )


@dataclass
class DeterministicRuntimeService:
    provider: str = "ollama"
    model: str = "glm-5:cloud"

    def prepare_frame(
        self,
        objective: MissionObjective,
        step: MissionStep,
        plan: MissionPlan,
        template: SubAgentTemplate,
        context: ExecutionContext,
    ) -> dict[str, Any]:
        return {
            "mission": {
                "id": objective.id,
                "title": objective.title,
            },
            "step": {
                "id": step.id,
                "title": step.title,
                "capability": step.capability,
            },
            "template": {
                "role": template.role,
                "provider": template.provider,
                "model": template.model,
            },
            "context": {
                "workspace_root": context.workspace_root,
                "max_parallelism": context.max_parallelism,
            },
            "model": {
                "provider": template.provider or self.provider,
                "model": template.model or self.model,
            },
        }

    async def execute_task(self, request):
        return {
            "status": "synthetic",
            "request": request,
        }


@dataclass
class HttpSubAgentService:
    runtime: HttpRuntimeService
    capability_map: dict[str, str] = field(
        default_factory=lambda: {
            "research": "strategist",
            "software-development": "engineer",
            "verification": "analyst",
            "browser": "browser-operator",
            "terminal": "terminal-operator",
        }
    )
    capability_tools: dict[str, list[str]] = field(
        default_factory=lambda: {
            "research": ["filesystem.read", "web.search"],
            "software-development": ["filesystem.read", "filesystem.write", "terminal.command.run"],
            "verification": ["filesystem.read", "terminal.command.run"],
            "browser": ["browser.navigate", "browser.capture", "browser.extract"],
            "terminal": ["terminal.command.run", "filesystem.read"],
        }
    )

    def spawn_for_plan(self, plan: MissionPlan) -> list[SubAgentTemplate]:
        templates: list[SubAgentTemplate] = []
        seen: set[str] = set()
        for step in plan.steps:
            if step.capability in seen:
                continue
            seen.add(step.capability)
            role = self.capability_map.get(step.capability, f"{step.capability}-operator")
            tool_ids = self.capability_tools.get(step.capability)
            templates.append(
                SubAgentTemplate(
                    specialization=step.capability,
                    role=step.assignee or role,
                    provider="anthropic",
                    model="claude-sonnet-4-6",
                    tool_ids=tool_ids,
                    max_parallel_tasks=1,
                    instructions=f"Complete step '{step.title}': {step.description}",
                )
            )
        return templates

    async def run_step(self, params: dict) -> SubAgentExecutionResult:
        mission_id: str = params["mission_id"]
        objective: MissionObjective = params["objective"]
        plan: MissionPlan = params["plan"]
        step: MissionStep = params["step"]
        template: SubAgentTemplate = params["template"]
        context: ExecutionContext = params["context"]
        attempt: int = params.get("attempt", 1)

        request = {
            "objective": {
                "id": objective.id,
                "workspaceId": objective.workspace_id,
                "userId": "python-executor",
                "title": objective.title,
                "objective": objective.objective,
                "context": f"Python execution context for {objective.title}",
                "constraints": [],
                "requiredCapabilities": [step.capability],
                "risk": objective.risk,
                "createdAt": utc_now_iso(),
            },
            "step": {
                "id": step.id,
                "title": step.title,
                "description": step.description,
                "capability": step.capability,
                "stage": step.stage,
                "dependsOn": step.depends_on,
                "verification": f"Step {step.id} completed successfully.",
                "assignee": template.role,
                "status": "ready",
            },
            "plan": {
                "id": f"plan-{mission_id}",
                "missionId": mission_id,
                "version": plan.version,
                "summary": f"Python-initiated plan for {objective.title}",
                "steps": [],  # Minimal plan for individual step execution
                "generatedAt": utc_now_iso(),
            },
            "template": {
                "id": f"template-{step.capability}",
                "role": template.role,
                "specialization": step.capability,
                "instructions": template.instructions or step.description,
                "maxParallelTasks": template.max_parallel_tasks,
                "provider": template.provider,
                "model": template.model,
                "toolIds": template.tool_ids,
            },
            "context": {
                "sessionId": f"session-{mission_id}",
                "workspaceRoot": context.workspace_root,
                "jeanFilePath": f"{context.workspace_root}/JEAN.md",
                "planMode": False,
                "maxParallelism": context.max_parallelism,
            },
            "providerMode": "live",
        }

        raw_result = await self.runtime.execute_task(request)

        # Map the live RuntimeExecutionResult to the SubAgentExecutionResult format
        # expected by the Python executor.
        final_text = raw_result.get("finalText", "")
        tool_calls = raw_result.get("toolCalls", [])
        verification = raw_result.get("verification", {"ok": True, "reason": "Completed by runtime."})

        diagnostics = StepExecutionDiagnostics(
            overall_score=0.9 if verification.get("ok") else 0.4,
            evidence_score=0.9 if final_text else 0.1,
            coverage_score=1.0 if tool_calls else 0.5,
            verification_score=1.0 if verification.get("ok") else 0.2,
            failure_class="none" if verification.get("ok") else "runtime",
            retryable=not verification.get("ok"),
        )

        return SubAgentExecutionResult(
            step_report=StepExecutionRecord(
                step_id=step.id,
                started_at=utc_now_iso(),
                attempts=attempt,
                summary=final_text[:200],
                diagnostics=diagnostics,
            ),
            run={
                "id": f"run-{step.id}-{attempt}",
                "capability": step.capability,
                "templateRole": template.role,
                "status": "completed" if verification.get("ok") else "failed",
                "provider": raw_result.get("provider", template.provider),
                "model": raw_result.get("model", template.model),
            },
            output={
                "finalText": final_text,
                "verification": {
                    "passed": verification.get("ok"),
                    "reason": verification.get("reason"),
                },
                "toolCalls": tool_calls,
                "providerResponses": raw_result.get("providerResponses", []),
            },
            memory_text=f"{step.title}: {final_text[:180]}",
        )


@dataclass
class DeterministicSubAgentService:
    seed: int = 7
    failure_policy: dict[str, int] = field(default_factory=dict)
    capability_tools: dict[str, list[str]] = field(
        default_factory=lambda: {
            "research": ["web_search", "browser_extract", "read_file"],
            "browser": ["browser_navigate", "browser_extract", "browser_capture"],
            "terminal": ["terminal_exec", "read_file", "write_file"],
            "software-development": ["read_file", "write_file", "terminal_exec"],
            "delivery": ["read_file", "write_file"],
            "verification": ["read_file", "terminal_exec"],
        }
    )
    role_map: dict[str, str] = field(
        default_factory=lambda: {
            "research": "researcher",
            "browser": "browser",
            "terminal": "coder",
            "software-development": "coder",
            "delivery": "writer",
            "verification": "analyst",
        }
    )

    def __post_init__(self):
        self._random = random.Random(self.seed)
        self._attempts: dict[str, int] = {}

    def spawn_for_plan(self, plan: MissionPlan) -> list[SubAgentTemplate]:
        templates: list[SubAgentTemplate] = []
        seen: set[str] = set()
        for step in plan.steps:
            if step.capability in seen:
                continue
            seen.add(step.capability)
            templates.append(
                SubAgentTemplate(
                    specialization=step.capability,
                    role=self.role_map.get(step.capability, "generalist"),
                    provider="ollama",
                    model="glm-5:cloud",
                    tool_ids=self.capability_tools.get(step.capability, ["read_file"]),
                    max_parallel_tasks=2 if step.capability in {"research", "browser"} else 1,
                )
            )
        return templates

    async def run_step(self, params: dict) -> SubAgentExecutionResult:
        step: MissionStep = params["step"]
        template: SubAgentTemplate = params["template"]
        attempt = int(params.get("attempt", 1))
        key = step.id
        self._attempts[key] = self._attempts.get(key, 0) + 1
        failure_limit = self.failure_policy.get(step.id, 0)
        if self._attempts[key] <= failure_limit:
            raise RuntimeError(f"Synthetic failure for {step.id} on attempt {attempt}")

        tool_calls = [
            {
                "toolId": tool_id,
                "action": "execute",
                "ok": True,
            }
            for tool_id in (template.tool_ids or ["read_file"])
        ]
        verification = self._build_verification(step, attempt)
        final_text = self._build_final_text(step, template, attempt)
        summary = self._build_summary(step, verification["passed"], attempt)
        diagnostics = StepExecutionDiagnostics(
            overall_score=self._score(step, attempt),
            evidence_score=self._score(step, attempt, 0.75),
            coverage_score=min(1.0, len(tool_calls) / 3),
            verification_score=1.0 if verification["passed"] else 0.5,
            failure_class="none" if verification["passed"] else "verification_failed",
            retryable=not verification["passed"],
            escalation_required=False,
            missing_signals=[] if verification["passed"] else ["verification"],
            recommended_actions=[] if verification["passed"] else ["retry"],
        )
        memory_text = (
            f"{step.title}: {summary}. Tools={','.join(template.tool_ids or [])}. "
            f"Verification={verification['reason']}"
        )

        runtime_request = {
            "objective": params["objective"],
            "step": step,
            "plan": params["plan"],
            "template": template,
            "context": params["context"],
            "providerMode": "synthetic",
        }
        await params["runtime"].execute_task(runtime_request)

        return SubAgentExecutionResult(
            step_report=StepExecutionRecord(
                step_id=step.id,
                started_at=utc_now_iso(),
                attempts=attempt,
                summary=summary,
                diagnostics=diagnostics,
            ),
            run={
                "id": f"run-{step.id}-{attempt}",
                "capability": step.capability,
                "templateRole": template.role,
                "status": "completed",
                "provider": template.provider or "ollama",
                "model": template.model or "glm-5:cloud",
            },
            output={
                "finalText": final_text,
                "verification": verification,
                "toolCalls": tool_calls,
                "providerResponses": [
                    {
                        "provider": template.provider or "ollama",
                        "mode": "synthetic",
                        "message": final_text,
                    }
                ],
            },
            memory_text=memory_text,
        )

    def _build_verification(self, step: MissionStep, attempt: int) -> dict[str, Any]:
        return {
            "passed": True,
            "reason": f"{step.capability} completed on attempt {attempt}",
        }

    def _build_final_text(
        self,
        step: MissionStep,
        template: SubAgentTemplate,
        attempt: int,
    ) -> str:
        return (
            f"[{template.role}] Completed step '{step.title}' using capability "
            f"'{step.capability}' on attempt {attempt}. "
            f"Description: {step.description}"
        )

    def _build_summary(self, step: MissionStep, passed: bool, attempt: int) -> str:
        status = "verified" if passed else "needs retry"
        return f"{step.title} {status} after attempt {attempt}"

    def _score(self, step: MissionStep, attempt: int, base: float = 0.82) -> float:
        capability_weight = (sum(ord(char) for char in step.capability) % 10) / 100
        attempt_penalty = max(0.0, (attempt - 1) * 0.05)
        score = base + capability_weight - attempt_penalty
        return round(min(1.0, max(0.45, score)), 2)
