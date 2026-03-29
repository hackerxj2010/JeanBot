from __future__ import annotations

import json
import os
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Protocol

from .adapters import (
    DeterministicRuntimeService,
    DeterministicSubAgentService,
    HttpAuditService,
    HttpMemoryService,
    HttpRuntimeService,
    HttpSubAgentService,
    LocalAuditService,
    LocalFileService,
    LocalMemoryService,
    StaticPolicyService,
    ensure_directory,
    utc_json,
)
from .executor import (
    ActiveExecutionState,
    AuditService,
    ExecutionContext,
    FileService,
    MemoryService,
    MissionArtifact,
    MissionExecutor,
    MissionObjective,
    MissionPlan,
    MissionRecord,
    MissionRunResult,
    MissionStep,
    PolicyService,
    StepExecutionDiagnostics,
    StepExecutionRecord,
    SubAgentService,
)


@dataclass
class MissionExecutionBundle:
    record: MissionRecord
    context: ExecutionContext
    executor: MissionExecutor
    audit_service: AuditService
    memory_service: MemoryService
    file_service: FileService
    runtime_service: Any
    subagent_service: SubAgentService
    policy_service: PolicyService


@dataclass
class MissionExecutorService:
    workspace_root: str
    provider: str = "ollama"
    model: str = "glm-5:cloud"
    max_parallelism: int = 3
    approval_required: bool = False
    capability_risk: dict[str, str] = field(default_factory=dict)
    failure_policy: dict[str, int] = field(default_factory=dict)
    service_mode: str = field(
        default_factory=lambda: os.getenv("JEANBOT_SERVICE_MODE", "local")
    )
    api_url: str = field(
        default_factory=lambda: os.getenv("JEANBOT_API_URL", "http://localhost:8080")
    )
    internal_token: str = field(
        default_factory=lambda: os.getenv("INTERNAL_SERVICE_TOKEN", "default-token")
    )

    def build_bundle(self, mission_payload: dict[str, Any]) -> MissionExecutionBundle:
        workspace_id = mission_payload.get("workspace_id") or mission_payload.get(
            "workspaceId"
        )
        if not workspace_id:
            raise ValueError("mission payload requires workspace_id")

        objective = MissionObjective(
            id=mission_payload.get("id")
            or mission_payload.get("mission_id")
            or self._mission_id(),
            title=mission_payload["title"],
            objective=mission_payload["objective"],
            workspace_id=workspace_id,
            risk=mission_payload.get("risk", "low"),
        )
        plan = self._build_plan(mission_payload)
        record = MissionRecord(
            objective=objective,
            plan=plan,
            plan_version=plan.version,
            decision_log=list(mission_payload.get("decision_log", [])),
            replan_history=list(mission_payload.get("replan_history", [])),
            replan_count=len(mission_payload.get("replan_history", [])),
        )
        context = ExecutionContext(
            workspace_root=self.workspace_root,
            max_parallelism=int(
                mission_payload.get("max_parallelism", self.max_parallelism)
            ),
            auth_context=mission_payload.get("auth_context"),
        )

        file_service = LocalFileService(output_root=self.workspace_root)
        policy_service = StaticPolicyService(
            approval_required=bool(
                mission_payload.get("approval_required", self.approval_required)
            ),
            default_risk=mission_payload.get("risk", "low"),
            capability_risk=dict(
                self.capability_risk | mission_payload.get("capability_risk", {})
            ),
        )

        if self.service_mode == "http":
            audit_service = HttpAuditService(
                api_url=self.api_url, internal_token=self.internal_token
            )
            memory_service = HttpMemoryService(
                api_url=self.api_url, internal_token=self.internal_token
            )
            runtime_service = HttpRuntimeService(
                api_url=self.api_url, internal_token=self.internal_token
            )
            subagent_service = HttpSubAgentService(
                api_url=self.api_url,
                internal_token=self.internal_token,
                failure_policy=dict(
                    self.failure_policy | mission_payload.get("failure_policy", {})
                ),
            )
        else:
            audit_service = LocalAuditService(output_root=self.workspace_root)
            memory_service = LocalMemoryService(output_root=self.workspace_root)
            runtime_service = DeterministicRuntimeService(
                provider=mission_payload.get("provider", self.provider),
                model=mission_payload.get("model", self.model),
            )
            subagent_service = DeterministicSubAgentService(
                failure_policy=dict(
                    self.failure_policy | mission_payload.get("failure_policy", {})
                )
            )

        executor = MissionExecutor(
            runtime=runtime_service,
            memory_service=memory_service,
            audit_service=audit_service,
            sub_agent_service=subagent_service,
            file_service=file_service,
            policy_service=policy_service,
        )
        return MissionExecutionBundle(
            record=record,
            context=context,
            executor=executor,
            audit_service=audit_service,
            memory_service=memory_service,
            file_service=file_service,
            runtime_service=runtime_service,
            subagent_service=subagent_service,
            policy_service=policy_service,
        )

    async def execute_payload(self, mission_payload: dict[str, Any]) -> MissionRunResult:
        bundle = self.build_bundle(mission_payload)
        result = await bundle.executor.execute(bundle.record, bundle.context)
        self._persist_run_summary(bundle, result)
        return result

    async def finalize_distributed_payload(
        self, mission_payload: dict[str, Any]
    ) -> MissionRunResult:
        bundle = self.build_bundle(mission_payload)
        bundle.record.active_execution = self._build_active_execution(mission_payload)
        result = await bundle.executor.finalize_distributed_execution(
            bundle.record, bundle.context
        )
        self._persist_run_summary(bundle, result)
        return result

    def load_payload(self, path: str) -> dict[str, Any]:
        return json.loads(Path(path).read_text(encoding="utf-8"))

    def write_payload_template(self, path: str) -> str:
        payload = {
            "workspace_id": "workspace-local",
            "title": "Local Python Mission",
            "objective": "Execute a Python-backed JeanBot mission end-to-end.",
            "risk": "low",
            "steps": [
                {
                    "id": "step-research",
                    "title": "Research objective",
                    "description": "Collect mission context and relevant evidence.",
                    "capability": "research",
                    "stage": "execution",
                    "depends_on": [],
                },
                {
                    "id": "step-build",
                    "title": "Build output",
                    "description": "Produce the implementation artifact.",
                    "capability": "software-development",
                    "stage": "execution",
                    "depends_on": ["step-research"],
                },
                {
                    "id": "step-verify",
                    "title": "Verify output",
                    "description": "Verify the produced output and summarize gaps.",
                    "capability": "verification",
                    "stage": "verification",
                    "depends_on": ["step-build"],
                },
            ],
        }
        path_obj = Path(path)
        ensure_directory(path_obj.parent)
        path_obj.write_text(utc_json(payload), encoding="utf-8")
        return str(path_obj)

    def _persist_run_summary(
        self,
        bundle: MissionExecutionBundle,
        result: MissionRunResult,
    ) -> None:
        mission_dir = self._mission_dir(bundle.record.objective.id)
        summary = {
            "mission": asdict(bundle.record.objective),
            "plan_version": bundle.record.plan_version,
            "result": self._result_to_dict(result),
            "audit_summary": bundle.audit_service.summarize(),
            "memory_summary": bundle.memory_service.summarize(
                bundle.record.objective.workspace_id
            ),
            "artifact_paths": bundle.file_service.artifact_paths(
                bundle.record.objective.id
            ),
        }
        (mission_dir / "mission-run.json").write_text(utc_json(summary), encoding="utf-8")
        (mission_dir / "mission-payload.json").write_text(
            utc_json(self._record_to_payload(bundle.record)),
            encoding="utf-8",
        )

    def _build_plan(self, mission_payload: dict[str, Any]) -> MissionPlan:
        raw_steps = mission_payload.get("steps")
        if not raw_steps:
            raw_steps = self._default_steps_for_objective(mission_payload["objective"])
        steps = [
            self._build_step(index, item) for index, item in enumerate(raw_steps, start=1)
        ]
        return MissionPlan(
            version=int(
                mission_payload.get("plan_version", mission_payload.get("planVersion", 1))
            ),
            steps=steps,
        )

    def _build_step(self, index: int, item: dict[str, Any]) -> MissionStep:
        step_id = item.get("id") or f"step-{index:03d}"
        return MissionStep(
            id=step_id,
            title=item["title"],
            description=item["description"],
            capability=item["capability"],
            stage=item.get("stage", "execution"),
            status=item.get("status", "pending"),
            depends_on=list(item.get("depends_on", item.get("dependsOn", []))),
            assignee=item.get("assignee"),
        )

    def _default_steps_for_objective(self, objective: str) -> list[dict[str, Any]]:
        return [
            {
                "title": "Analyze objective",
                "description": f"Analyze objective and extract tasks: {objective}",
                "capability": "research",
                "stage": "execution",
                "depends_on": [],
            },
            {
                "title": "Implement deliverable",
                "description": "Create the core output required by the objective.",
                "capability": "software-development",
                "stage": "execution",
                "depends_on": ["step-001"],
            },
            {
                "title": "Verify delivery",
                "description": "Verify output quality and summarize remaining gaps.",
                "capability": "verification",
                "stage": "verification",
                "depends_on": ["step-002"],
            },
        ]

    def _build_active_execution(
        self, mission_payload: dict[str, Any]
    ) -> ActiveExecutionState:
        active = mission_payload.get("active_execution", mission_payload.get("activeExecution"))
        if not active:
            raise ValueError("distributed payload requires active_execution")
        reports = [
            StepExecutionRecord(
                step_id=item["step_id"],
                started_at=item["started_at"],
                attempts=int(item.get("attempts", 1)),
                summary=item.get("summary", ""),
                diagnostics=self._build_diagnostics(item.get("diagnostics", {})),
            )
            for item in active.get("step_reports", active.get("stepReports", []))
        ]
        artifacts = [
            MissionArtifact(
                id=item["id"],
                kind=item["kind"],
                title=item["title"],
                path=item["path"],
                created_at=item["created_at"],
                metadata=dict(item.get("metadata", {})),
            )
            for item in active.get("artifacts", [])
        ]
        return ActiveExecutionState(
            started_at=active["started_at"],
            outputs=dict(active.get("outputs", {})),
            memory_updates=list(active.get("memory_updates", active.get("memoryUpdates", []))),
            step_reports=reports,
            artifacts=artifacts,
        )

    def _build_diagnostics(self, payload: dict[str, Any]) -> StepExecutionDiagnostics:
        return StepExecutionDiagnostics(
            overall_score=float(payload.get("overall_score", payload.get("overallScore", 0.0))),
            evidence_score=float(payload.get("evidence_score", payload.get("evidenceScore", 0.0))),
            coverage_score=float(payload.get("coverage_score", payload.get("coverageScore", 0.0))),
            verification_score=float(
                payload.get("verification_score", payload.get("verificationScore", 0.0))
            ),
            failure_class=payload.get("failure_class", payload.get("failureClass", "none")),
            retryable=bool(payload.get("retryable", False)),
            escalation_required=bool(
                payload.get("escalation_required", payload.get("escalationRequired", False))
            ),
            missing_signals=list(payload.get("missing_signals", payload.get("missingSignals", []))),
            recommended_actions=list(
                payload.get("recommended_actions", payload.get("recommendedActions", []))
            ),
        )

    def _record_to_payload(self, record: MissionRecord) -> dict[str, Any]:
        return {
            "id": record.objective.id,
            "workspace_id": record.objective.workspace_id,
            "title": record.objective.title,
            "objective": record.objective.objective,
            "risk": record.objective.risk,
            "plan_version": record.plan_version,
            "steps": [
                {
                    "id": step.id,
                    "title": step.title,
                    "description": step.description,
                    "capability": step.capability,
                    "stage": step.stage,
                    "status": step.status,
                    "depends_on": step.depends_on,
                    "assignee": step.assignee,
                }
                for step in (record.plan.steps if record.plan else [])
            ],
            "decision_log": list(record.decision_log),
            "replan_history": list(record.replan_history),
        }

    def _result_to_dict(self, result: MissionRunResult) -> dict[str, Any]:
        return {
            "mission_id": result.mission_id,
            "status": result.status,
            "execution_mode": result.execution_mode,
            "verification_summary": result.verification_summary,
            "outputs": result.outputs,
            "memory_updates": result.memory_updates,
            "step_reports": [
                {
                    "step_id": report.step_id,
                    "started_at": report.started_at,
                    "attempts": report.attempts,
                    "summary": report.summary,
                    "diagnostics": asdict(report.diagnostics) if report.diagnostics else None,
                }
                for report in result.step_reports
            ],
            "artifacts": [
                {
                    "id": artifact.id,
                    "kind": artifact.kind,
                    "title": artifact.title,
                    "path": artifact.path,
                    "created_at": artifact.created_at,
                    "metadata": artifact.metadata,
                }
                for artifact in result.artifacts
            ],
            "metrics": result.metrics,
            "gaps": result.gaps,
            "decision_log": result.decision_log,
            "started_at": result.started_at,
            "finished_at": result.finished_at,
        }

    def _mission_dir(self, mission_id: str) -> Path:
        return ensure_directory(Path(self.workspace_root) / ".jeanbot" / "missions" / mission_id)

    def _mission_id(self) -> str:
        return f"py-mission-{uuid.uuid4().hex[:12]}"
