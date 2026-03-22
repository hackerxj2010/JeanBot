from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import random
import urllib.request
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from .executor import (
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
    return json.dumps(value, indent=2, sort_keys=True)


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
class LocalFileService:
    output_root: str
    context_history: list[dict[str, Any]] = field(default_factory=list)

    def _workspace_dir(self) -> Path:
        return ensure_directory(Path(self.output_root))

    def _jeanbot_dir(self) -> Path:
        return ensure_directory(self._workspace_dir() / ".jeanbot")

    def _artifact_dir(self, mission_id: str) -> Path:
        return ensure_directory(self._jeanbot_dir() / "artifacts" / mission_id)

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

    def execute_task(self, request):
        return {
            "status": "synthetic",
            "request": request,
        }


@dataclass
class HttpServiceBase:
    api_url: str
    internal_token: str
    service_name: str = "agent-orchestrator"

    def _build_headers(self, auth_context: dict | None = None) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "x-jeanbot-internal-service": self.service_name,
            "x-jeanbot-internal-token": self.internal_token,
        }
        if auth_context:
            encoded = base64.b64encode(json.dumps(auth_context).encode("utf-8")).decode("utf-8")
            headers["x-jeanbot-auth-context"] = encoded
        return headers

    async def request(
        self,
        path: str,
        method: str = "GET",
        body: Any = None,
        auth_context: dict | None = None,
    ) -> Any:
        url = f"{self.api_url.rstrip('/')}/{path.lstrip('/')}"
        headers = self._build_headers(auth_context)
        data = json.dumps(body).encode("utf-8") if body is not None else None

        def _do_request():
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            with urllib.request.urlopen(req) as resp:
                if resp.status == 204:
                    return None
                return json.loads(resp.read().decode("utf-8"))

        return await asyncio.to_thread(_do_request)


@dataclass
class HttpAuditService(HttpServiceBase):
    async def record(self, event: str, entity_id: str, service: str, data: dict):
        await self.request(
            "/internal/audit",
            method="POST",
            body={
                "kind": event,
                "entityId": entity_id,
                "actor": service,
                "details": data,
            },
        )

    def summarize(self) -> dict[str, Any]:
        return {"mode": "http", "message": "Summary not available in HTTP mode"}


@dataclass
class HttpMemoryService(HttpServiceBase):
    async def remember(
        self,
        workspace_id: str,
        text: str,
        tags: list[str],
        memory_type: str,
        importance: float,
    ):
        await self.request(
            f"/internal/memory/workspaces/{workspace_id}/remember",
            method="POST",
            body={
                "text": text,
                "tags": tags,
                "scope": "long-term" if memory_type == "long-term" else "session",
                "importance": importance,
            },
        )

    def summarize(self, workspace_id: str) -> dict[str, Any]:
        return {
            "workspace_id": workspace_id,
            "mode": "http",
            "message": "Summary not available in HTTP mode",
        }


@dataclass
class HttpPolicyService(HttpServiceBase):
    def evaluate_mission(self, mission_data: dict) -> PolicyDecision:
        return PolicyDecision(approval_required=False, risk="low")


@dataclass
class HttpRuntimeService(HttpServiceBase):
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

    async def execute_task(self, request_payload: dict) -> dict[str, Any]:
        return await self.request(
            "/internal/runtime/execute",
            method="POST",
            body=request_payload,
            auth_context=request_payload.get("authContext"),
        )


@dataclass
class HttpSubAgentService(HttpServiceBase):
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
        mission_id = params["mission_id"]
        objective = params["objective"]
        plan = params["plan"]
        step = params["step"]
        template = params["template"]
        context = params["context"]
        auth_context = params.get("auth_context")

        runtime_request = {
            "objective": asdict(objective),
            "step": asdict(step),
            "plan": {
                "version": plan.version,
                "steps": [asdict(s) for s in plan.steps],
            },
            "template": asdict(template),
            "context": asdict(context),
            "authContext": auth_context,
        }

        output = await self.request(
            "/internal/runtime/execute",
            method="POST",
            body=runtime_request,
            auth_context=auth_context,
        )

        return SubAgentExecutionResult(
            step_report=StepExecutionRecord(
                step_id=step.id,
                started_at=utc_now_iso(),
                attempts=params.get("attempt", 1),
                summary=output.get("finalText", "")[:100],
            ),
            run={
                "id": f"run-{step.id}",
                "capability": step.capability,
                "templateRole": template.role,
                "status": "completed",
                "provider": output.get("provider"),
                "model": output.get("model"),
            },
            output=output,
            memory_text=output.get("finalText", ""),
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

        return SubAgentExecutionResult(
            step_report=StepExecutionRecord(
                step_id=step.id,
                started_at="",
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
