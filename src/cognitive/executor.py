from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Awaitable, Protocol


def sleep_ms(ms: int) -> Awaitable[None]:
    return asyncio.sleep(ms / 1000)


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def summarize_text(value: str, max_length: int = 220) -> str:
    normalized = " ".join(value.split()).strip()
    if len(normalized) <= max_length:
        return normalized
    return normalized[: max_length - 3] + "..."


def json_preview(value: Any, max_length: int = 280) -> str:
    try:
        return summarize_text(json.dumps(value, indent=2), max_length)
    except Exception:
        return summarize_text(str(value), max_length)


class StepExecutionFailure(Exception):
    def __init__(
        self,
        step: MissionStep,
        attempts: int,
        error_message: str,
        diagnostics: StepExecutionDiagnostics | None = None,
    ):
        super().__init__(error_message)
        self.step = step
        self.attempts = attempts
        self.error_message = error_message
        self.diagnostics = diagnostics
        self.name = "StepExecutionFailure"


@dataclass
class MissionObjective:
    id: str
    title: str
    objective: str
    workspace_id: str
    risk: str = "low"


@dataclass
class MissionStep:
    id: str
    title: str
    description: str
    capability: str
    stage: str = "execution"
    status: str = "pending"
    depends_on: list[str] = field(default_factory=list)
    assignee: str | None = None


@dataclass
class MissionPlan:
    version: int = 1
    steps: list[MissionStep] = field(default_factory=list)


@dataclass
class MissionRecord:
    objective: MissionObjective
    plan: MissionPlan | None = None
    plan_version: int | None = None
    decision_log: list[dict] = field(default_factory=list)
    replan_history: list[dict] = field(default_factory=list)
    replan_count: int = 0
    active_execution: ActiveExecutionState | None = None


@dataclass
class ExecutionContext:
    workspace_root: str
    max_parallelism: int = 3
    auth_context: dict | None = None


@dataclass
class StepExecutionRecord:
    step_id: str
    started_at: str
    attempts: int = 1
    summary: str = ""
    diagnostics: StepExecutionDiagnostics | None = None


@dataclass
class ActiveExecutionState:
    started_at: str
    outputs: dict[str, Any] = field(default_factory=dict)
    memory_updates: list[str] = field(default_factory=list)
    step_reports: list[StepExecutionRecord] = field(default_factory=list)
    artifacts: list[MissionArtifact] = field(default_factory=list)


@dataclass
class StepExecutionDiagnostics:
    overall_score: float = 0.0
    evidence_score: float = 0.0
    coverage_score: float = 0.0
    verification_score: float = 0.0
    failure_class: str = "none"
    retryable: bool = False
    escalation_required: bool = False
    missing_signals: list[str] = field(default_factory=list)
    recommended_actions: list[str] = field(default_factory=list)


@dataclass
class PolicyDecision:
    approval_required: bool = False
    risk: str = "low"


@dataclass
class SubAgentTemplate:
    specialization: str
    role: str
    provider: str | None = None
    model: str | None = None
    tool_ids: list[str] | None = None
    max_parallel_tasks: int = 1


@dataclass
class SubAgentExecutionResult:
    step_report: StepExecutionRecord
    run: dict
    output: dict
    memory_text: str


@dataclass
class MissionArtifact:
    id: str
    kind: str
    title: str
    path: str
    created_at: str
    metadata: dict = field(default_factory=dict)


@dataclass
class MissionRunResult:
    mission_id: str
    status: str
    execution_mode: str
    verification_summary: str
    outputs: dict
    memory_updates: list[str]
    step_reports: list[StepExecutionRecord]
    artifacts: list[MissionArtifact]
    metrics: dict
    gaps: list[str]
    decision_log: list[dict]
    started_at: str
    finished_at: str


class AgentRuntimeService(Protocol):
    def prepare_frame(
        self,
        objective: MissionObjective,
        step: MissionStep,
        plan: MissionPlan,
        template: SubAgentTemplate,
        context: ExecutionContext,
    ) -> dict[str, Any]: ...

    def execute_task(self, request: dict[str, Any]) -> dict[str, Any]: ...


class AuditService(Protocol):
    async def record(self, event: str, entity_id: str, service: str, data: dict[str, Any]) -> None: ...
    def summarize(self) -> dict[str, Any]: ...


class MemoryService(Protocol):
    async def remember(
        self,
        workspace_id: str,
        text: str,
        tags: list[str],
        memory_type: str,
        importance: float,
    ) -> None: ...
    def summarize(self, workspace_id: str) -> dict[str, Any]: ...


class FileService(Protocol):
    async def update_workspace_context(
        self,
        workspace_root: str,
        mission_title: str,
        completed_steps: list[str],
        running_steps: list[str],
        pending_steps: list[str],
    ) -> None: ...

    async def write_artifact(
        self,
        workspace_root: str,
        mission_id: str,
        filename: str,
        content: str,
    ) -> str: ...


class PolicyService(Protocol):
    def evaluate_mission(self, mission_data: dict[str, Any]) -> PolicyDecision: ...


class SubAgentService(Protocol):
    def spawn_for_plan(self, plan: MissionPlan) -> list[SubAgentTemplate]: ...
    async def run_step(self, params: dict[str, Any]) -> SubAgentExecutionResult: ...


class MissionExecutionIntelligence:
    def assess_step(
        self,
        step: MissionStep,
        output: dict,
        policy_decision: PolicyDecision,
        attempt: int,
    ) -> StepExecutionDiagnostics:
        verification = output.get("verification", {})
        tool_calls = output.get("toolCalls", [])
        
        failure_class = "none"
        retryable = False
        escalation_required = False
        missing_signals = []
        recommended_actions = []
        
        if not output.get("finalText"):
            failure_class = "empty_output"
            retryable = True
            missing_signals.append("No final text output")
            recommended_actions.append("Retry with clearer instructions")
        
        if not verification.get("passed"):
            failure_class = "verification_failed"
            retryable = True
            missing_signals.append("Verification did not pass")
            recommended_actions.append("Review and fix based on verification feedback")
        
        if tool_calls and all(tc.get("ok", True) is False for tc in tool_calls):
            failure_class = "all_tools_failed"
            retryable = True
            missing_signals.append("All tool calls failed")
            recommended_actions.append("Check tool configuration and permissions")
        
        evidence_score = 0.5
        coverage_score = 0.5
        verification_score = 0.5
        
        if output.get("finalText"):
            evidence_score = min(1.0, len(output["finalText"]) / 500)
        if verification.get("passed"):
            verification_score = 1.0
        if tool_calls:
            coverage_score = min(1.0, len([tc for tc in tool_calls if tc.get("ok")]) / len(tool_calls))
        
        overall_score = (evidence_score + coverage_score + verification_score) / 3
        
        if failure_class == "none":
            retryable = False
        
        return StepExecutionDiagnostics(
            overall_score=overall_score,
            evidence_score=evidence_score,
            coverage_score=coverage_score,
            verification_score=verification_score,
            failure_class=failure_class,
            retryable=retryable,
            escalation_required=escalation_required,
            missing_signals=missing_signals,
            recommended_actions=recommended_actions,
        )

    def build_mission_metrics(
        self,
        reports: list[StepExecutionRecord],
        artifacts: list[MissionArtifact],
        decision_log: list[dict],
    ) -> dict:
        total_steps = len(reports)
        completed = len([r for r in reports if r.diagnostics and r.diagnostics.failure_class == "none"])
        failed = len([r for r in reports if r.diagnostics and r.diagnostics.failure_class != "none"])
        
        avg_score = 0.0
        if reports:
            scores = [r.diagnostics.overall_score for r in reports if r.diagnostics]
            avg_score = sum(scores) / len(scores) if scores else 0.0
        
        return {
            "total_steps": total_steps,
            "completed_steps": completed,
            "failed_steps": failed,
            "average_score": round(avg_score, 2),
            "total_artifacts": len(artifacts),
            "decisions_logged": len(decision_log),
        }

    def build_mission_gaps(self, reports: list[StepExecutionRecord]) -> list[str]:
        gaps = []
        for report in reports:
            if report.diagnostics and report.diagnostics.failure_class != "none":
                gaps.append(f"Step {report.step_id}: {report.diagnostics.failure_class}")
        return gaps

    def build_verification_summary(
        self,
        record: MissionRecord,
        reports: list[StepExecutionRecord],
        metrics: dict,
    ) -> str:
        passed = len([r for r in reports if r.diagnostics and r.diagnostics.failure_class == "none"])
        total = len(reports)
        return f"Verification: {passed}/{total} steps passed. Average score: {metrics.get('average_score', 0):.2f}"

    def build_mission_report(
        self,
        record: MissionRecord,
        reports: list[StepExecutionRecord],
        artifacts: list[MissionArtifact],
        metrics: dict,
        decision_log: list[dict],
        replan_history: list[dict],
    ) -> str:
        lines = [
            f"# Mission Report: {record.objective.title}",
            "",
            f"Mission ID: {record.objective.id}",
            f"Plan version: {record.plan_version or record.plan.version if record.plan else 1}",
            f"Status: {metrics.get('completed_steps', 0)}/{metrics.get('total_steps', 0)} completed",
            "",
            "## Summary",
            f"- Total steps: {metrics.get('total_steps', 0)}",
            f"- Completed: {metrics.get('completed_steps', 0)}",
            f"- Failed: {metrics.get('failed_steps', 0)}",
            f"- Average score: {metrics.get('average_score', 0):.2f}",
            f"- Artifacts: {metrics.get('total_artifacts', 0)}",
            "",
            "## Step Results",
        ]
        
        for report in reports:
            status = "✓" if report.diagnostics and report.diagnostics.failure_class == "none" else "✗"
            score = report.diagnostics.overall_score if report.diagnostics else 0.0
            lines.append(f"- {status} {report.step_id}: score={score:.2f}")
        
        if decision_log:
            lines.extend(["", "## Decisions", f"- {len(decision_log)} decisions logged"])
        
        if replan_history:
            lines.extend(["", "## Replans", f"- {len(replan_history)} replans applied"])
        
        return "\n".join(lines)


class AdaptiveReplanner:
    def apply(
        self,
        record: MissionRecord,
        failure_context: dict,
    ) -> dict:
        step = failure_context.get("step")
        attempts = failure_context.get("attempts", 1)
        error_message = failure_context.get("error_message", "")
        diagnostics = failure_context.get("diagnostics")
        
        decision_entries = []
        patched = False
        plan = record.plan
        replan_patch = None
        
        if not step or not plan:
            return {
                "patched": False,
                "decision_entries": decision_entries,
                "remediation_steps": [],
                "plan": plan,
                "replan_patch": replan_patch,
            }
        
        failure_class = diagnostics.failure_class if diagnostics else "unknown"
        
        if failure_class == "verification_failed" and attempts < 3:
            decision_entries.append({
                "step_id": step.id,
                "category": "retry_strategy",
                "severity": "info",
                "scope": "step",
                "summary": f"Step failed verification, will retry with adjusted approach",
                "reasoning": f"Failure class: {failure_class}, attempts: {attempts}",
                "recommended_actions": ["Adjust instructions", "Simplify step objective"],
                "metadata": {"attempts": attempts},
                "created_at": utc_now_iso(),
                "plan_version": record.plan_version or 1,
            })
            patched = True
            
        elif failure_class == "empty_output" and attempts < 2:
            decision_entries.append({
                "step_id": step.id,
                "category": "retry_strategy",
                "severity": "warning",
                "scope": "step",
                "summary": "Step produced no output, retrying with expanded context",
                "reasoning": "Empty output indicates model needs more context",
                "recommended_actions": ["Add more context to prompt", "Break into smaller steps"],
                "metadata": {"attempts": attempts},
                "created_at": utc_now_iso(),
                "plan_version": record.plan_version or 1,
            })
            patched = True
            
        elif attempts >= 3:
            decision_entries.append({
                "step_id": step.id,
                "category": "step_failure",
                "severity": "error",
                "scope": "step",
                "summary": f"Step failed after {attempts} attempts: {error_message}",
                "reasoning": f"Exhausted retry limit for failure class: {failure_class}",
                "recommended_actions": ["Mark step as failed", "Consider alternative approach"],
                "metadata": {"attempts": attempts, "failure_class": failure_class},
                "created_at": utc_now_iso(),
                "plan_version": record.plan_version or 1,
            })
        
        return {
            "patched": patched,
            "decision_entries": decision_entries,
            "remediation_steps": [],
            "plan": plan,
            "replan_patch": replan_patch,
        }


@dataclass
class StepOutcome:
    step: MissionStep
    report: StepExecutionRecord
    output: dict
    artifact: MissionArtifact
    memory_text: str
    run_id: str
    diagnostics: StepExecutionDiagnostics


class MissionExecutor:
    def __init__(
        self,
        runtime: AgentRuntimeService,
        memory_service: MemoryService,
        audit_service: AuditService,
        sub_agent_service: SubAgentService,
        file_service: FileService,
        policy_service: PolicyService,
    ):
        self.runtime = runtime
        self.memory_service = memory_service
        self.audit_service = audit_service
        self.sub_agent_service = sub_agent_service
        self.file_service = file_service
        self.policy_service = policy_service
        self.intelligence = MissionExecutionIntelligence()
        self.replanner = AdaptiveReplanner()

    def _require_plan(self, record: MissionRecord) -> MissionPlan:
        if not record.plan:
            raise ValueError(f'Mission "{record.objective.id}" has no plan.')
        return record.plan

    def _template_by_capability(self, record: MissionRecord) -> dict[str, SubAgentTemplate]:
        plan = self._require_plan(record)
        templates = self.sub_agent_service.spawn_for_plan(plan)
        return {t.specialization: t for t in templates}

    def _is_ready(self, step: MissionStep, steps: list[MissionStep]) -> bool:
        if step.status in ("completed", "running", "skipped"):
            return False
        return all(
            next((s.status == "completed" for s in steps if s.id == dep_id), False)
            for dep_id in step.depends_on
        )

    def _promote_ready_steps(self, steps: list[MissionStep]) -> None:
        for step in steps:
            if self._is_ready(step, steps):
                if step.status != "ready":
                    step.status = "ready"
            elif step.status == "ready":
                step.status = "pending"

    def _select_batch(
        self,
        ready_steps: list[MissionStep],
        template_by_capability: dict[str, SubAgentTemplate],
        max_parallelism: int,
    ) -> list[MissionStep]:
        batch = []
        per_capability: dict[str, int] = {}
        
        for step in ready_steps:
            if len(batch) >= max(1, max_parallelism):
                break
            
            template = template_by_capability.get(step.capability)
            current_count = per_capability.get(step.capability, 0)
            limit = template.max_parallel_tasks if template else 1
            
            if current_count >= limit:
                continue
            
            batch.append(step)
            per_capability[step.capability] = current_count + 1
        
        return batch

    def _retry_limit(self, step: MissionStep) -> int:
        if step.stage == "preflight" or step.capability == "security":
            return 1
        if step.capability in ("software-development", "terminal", "browser", "research"):
            return 3
        return 2

    def _ordered_reports(
        self,
        record: MissionRecord,
        reports: list[StepExecutionRecord],
    ) -> list[StepExecutionRecord]:
        order = {
            step.id: index
            for index, step in enumerate(record.plan.steps if record.plan else [])
        }
        return sorted(reports, key=lambda report: order.get(report.step_id, 0))

    async def _update_workspace_context(
        self,
        record: MissionRecord,
        context: ExecutionContext,
    ) -> None:
        if not record.plan:
            return
        
        completed = [s.title for s in record.plan.steps if s.status == "completed"]
        running = [s.title for s in record.plan.steps if s.status == "running"]
        pending = [s.title for s in record.plan.steps if s.status in ("pending", "ready")]
        
        await self.file_service.update_workspace_context(
            context.workspace_root,
            record.objective.title,
            completed,
            running,
            pending,
        )

    def _append_decision_entries(self, record: MissionRecord, entries: list[dict]) -> None:
        if entries:
            record.decision_log = record.decision_log + entries

    def _append_replan_patch(self, record: MissionRecord, patch: dict | None) -> None:
        if patch:
            record.replan_history = record.replan_history + [patch]
            record.plan_version = patch.get("planVersion")
            record.replan_count = len(record.replan_history)

    async def _persist_decision_log_artifact(
        self,
        record: MissionRecord,
        context: ExecutionContext,
    ) -> MissionArtifact | None:
        decisions = record.decision_log
        replans = record.replan_history
        
        if not decisions and not replans:
            return None
        
        lines = [
            f"# Mission Decision Log: {record.objective.title}",
            "",
            f"Mission ID: {record.objective.id}",
            f"Plan version: {record.plan_version or 1}",
            f"Replans: {len(replans)}",
            "",
            "## Decisions",
        ]
        
        if decisions:
            for decision in decisions:
                lines.extend([
                    f"### {decision.get('created_at', '')} :: {decision.get('category', '')} :: {decision.get('severity', '')}",
                    f"- Scope: {decision.get('scope', '')}",
                    f'- Step: {decision.get("step_id", "N/A")}',
                    f'- Summary: {decision.get("summary", "")}',
                    f'- Reasoning: {decision.get("reasoning", "")}',
                    f'- Recommended actions: {", ".join(decision.get("recommended_actions", [])) or "none"}',
                    f'- Metadata: {json_preview(decision.get("metadata", {}), 300)}',
                    "",
                ])
        else:
            lines.append("No decisions were logged.")
        
        lines.extend(["", "## Replan History"])
        if replans:
            for patch in replans:
                lines.extend([
                    f"### v{patch.get('planVersion', 1)} :: {patch.get('triggeredByStepId', 'N/A')}",
                    f'- Summary: {patch.get("summary", "")}',
                    f'- Reason: {patch.get("reason", "")}',
                    f'- Inserted steps: {", ".join(patch.get("insertedStepIds", [])) or "none"}',
                    f'- Deferred steps: {", ".join(patch.get("deferredStepIds", [])) or "none"}',
                    "",
                ])
        else:
            lines.append("No replans were needed.")
        
        content = "\n".join(lines)
        artifact_path = await self.file_service.write_artifact(
            context.workspace_root,
            record.objective.id,
            "mission-decision-log.md",
            content,
        )
        
        return MissionArtifact(
            id=str(uuid.uuid4()),
            kind="log",
            title="Mission decision log",
            path=artifact_path,
            created_at=utc_now_iso(),
            metadata={
                "mission_id": record.objective.id,
                "decisions": len(decisions),
                "replans": len(replans),
            },
        )

    async def _persist_step_artifact(
        self,
        record: MissionRecord,
        context: ExecutionContext,
        outcome: SubAgentExecutionResult,
        report: StepExecutionRecord,
    ) -> MissionArtifact:
        diag = report.diagnostics
        
        lines = [
            f"# Step Report: {outcome.step_report.step_id}",
            "",
            f"Mission: {record.objective.title}",
            f'Capability: {outcome.run.get("capability", "unknown")}',
            f'Assignee: {outcome.run.get("templateRole", "unknown")}',
            f'Run ID: {outcome.run.get("id", "unknown")}',
            f'Status: {outcome.run.get("status", "unknown")}',
            f'Model: {outcome.run.get("provider", "")}/{outcome.run.get("model", "")}',
            "",
            "## Summary",
            outcome.step_report.summary,
            "",
            "## Verification",
            outcome.output.get("verification", {}).get("reason", "No verification"),
            "",
            "## Diagnostics",
            f"Overall score: {diag.overall_score:.2f}" if diag else "Overall score: N/A",
            f"Evidence score: {diag.evidence_score:.2f}" if diag else "Evidence score: N/A",
            f"Coverage score: {diag.coverage_score:.2f}" if diag else "Coverage score: N/A",
            f"Verification score: {diag.verification_score:.2f}" if diag else "Verification score: N/A",
            f'Failure class: {diag.failure_class if diag else "none"}',
            f'Retryable: {"yes" if diag and diag.retryable else "no"}',
            f'Escalation required: {"yes" if diag and diag.escalation_required else "no"}',
            "Missing signals:",
        ]
        
        if diag and diag.missing_signals:
            lines.extend([f"- {s}" for s in diag.missing_signals])
        else:
            lines.append("- none")
        
        lines.append("")
        lines.append("Recommended actions:")
        
        if diag and diag.recommended_actions:
            lines.extend([f"- {a}" for a in diag.recommended_actions])
        else:
            lines.append("- none")
        
        lines.extend([
            "",
            "## Final Text",
            outcome.output.get("finalText", ""),
            "",
            "## Tool Calls",
        ])
        
        tool_calls = outcome.output.get("toolCalls", [])
        if tool_calls:
            for tc in tool_calls:
                status = "ok" if tc.get("ok", True) else "failed"
                lines.append(f"- {tc.get('toolId', 'unknown')} :: {tc.get('action', '')} :: {status}")
        else:
            lines.append("- none")
        
        lines.append("")
        lines.append("## Provider Responses")
        
        for i, resp in enumerate(outcome.output.get("providerResponses", [])):
            msg = summarize_text(resp.get("message", ""), 140)
            lines.append(f"- Turn {i + 1}: {resp.get('provider', '')}/{resp.get('mode', '')} :: {msg}")
        
        content = "\n".join(lines)
        filename = f"step-{outcome.step_report.step_id}.md"
        artifact_path = await self.file_service.write_artifact(
            context.workspace_root,
            record.objective.id,
            filename,
            content,
        )
        
        return MissionArtifact(
            id=str(uuid.uuid4()),
            kind="log",
            title=f"Step report {outcome.step_report.step_id}",
            path=artifact_path,
            created_at=utc_now_iso(),
            metadata={
                "step_id": outcome.step_report.step_id,
                "run_id": outcome.run.get("id", ""),
                "tool_calls": len(tool_calls),
                "overall_score": diag.overall_score if diag else 0.0,
                "failure_class": diag.failure_class if diag else "none",
            },
        )

    async def _execute_step_with_retries(
        self,
        record: MissionRecord,
        step: MissionStep,
        template: SubAgentTemplate,
        context: ExecutionContext,
        policy_decision: PolicyDecision,
    ) -> tuple[SubAgentExecutionResult, StepExecutionDiagnostics, int]:
        limit = self._retry_limit(step)
        last_error = None
        
        for attempt in range(1, limit + 1):
            try:
                await self.audit_service.record(
                    "mission.step.attempt.started",
                    step.id,
                    "agent-orchestrator",
                    {
                        "mission_id": record.objective.id,
                        "attempt": attempt,
                        "capability": step.capability,
                    },
                )
                
                sub_agent_result = await self.sub_agent_service.run_step({
                    "mission_id": record.objective.id,
                    "objective": record.objective,
                    "plan": self._require_plan(record),
                    "step": step,
                    "template": template,
                    "context": context,
                    "auth_context": context.auth_context,
                    "attempt": attempt,
                })
                
                diagnostics = self.intelligence.assess_step(
                    step,
                    sub_agent_result.output,
                    policy_decision,
                    attempt,
                )
                
                await self.audit_service.record(
                    "mission.step.attempt.assessed",
                    step.id,
                    "agent-orchestrator",
                    {
                        "mission_id": record.objective.id,
                        "attempt": attempt,
                        "overall_score": diagnostics.overall_score,
                        "failure_class": diagnostics.failure_class,
                        "retryable": diagnostics.retryable,
                        "escalation_required": diagnostics.escalation_required,
                    },
                )
                
                quality_gate_failed = (
                    diagnostics.failure_class != "none" or len(diagnostics.missing_signals) >= 2
                )
                
                if quality_gate_failed and diagnostics.retryable and attempt < limit:
                    await self.audit_service.record(
                        "mission.step.attempt.retry_scheduled",
                        step.id,
                        "agent-orchestrator",
                        {
                            "mission_id": record.objective.id,
                            "attempt": attempt,
                            "reason": " | ".join(diagnostics.recommended_actions) or diagnostics.failure_class,
                        },
                    )
                    await sleep_ms(min(175 * attempt, 650))
                    continue
                
                if quality_gate_failed and attempt >= limit:
                    raise StepExecutionFailure(
                        step,
                        attempt,
                        f'Step "{step.id}" failed the quality gate after {attempt} attempt(s): {" ".join(diagnostics.recommended_actions)}',
                        diagnostics,
                    )
                
                return sub_agent_result, diagnostics, attempt
                
            except Exception as e:
                last_error = e
                await self.audit_service.record(
                    "mission.step.attempt.failed",
                    step.id,
                    "agent-orchestrator",
                    {
                        "mission_id": record.objective.id,
                        "attempt": attempt,
                        "error": str(e),
                    },
                )
                
                if attempt >= limit:
                    break
                
                await sleep_ms(min(150 * attempt, 500))
        
        if isinstance(last_error, StepExecutionFailure):
            raise last_error
        
        raise StepExecutionFailure(
            step,
            limit,
            (
                str(last_error)
                if last_error
                else f'Step "{step.id}" failed after {limit} attempt(s).'
            ),
            None,
        )

    async def _execute_step(
        self,
        record: MissionRecord,
        step: MissionStep,
        template: SubAgentTemplate,
        context: ExecutionContext,
    ) -> StepOutcome:
        step_started_at = utc_now_iso()
        step.status = "running"
        
        await self.audit_service.record(
            "mission.step.started",
            step.id,
            "agent-orchestrator",
            {
                "mission_id": record.objective.id,
                "capability": step.capability,
                "stage": step.stage,
            },
        )
        
        policy_decision = self.policy_service.evaluate_mission({
            **record.objective.__dict__,
            "title": f"{record.objective.title} :: {step.title}",
            "objective": f"{record.objective.objective}\n{step.description}",
        })
        
        await self.audit_service.record(
            "mission.step.policy.checked",
            step.id,
            "policy-service",
            {
                "mission_id": record.objective.id,
                "approval_required": policy_decision.approval_required,
                "risk": policy_decision.risk,
            },
        )

        runtime_preview = self.runtime.prepare_frame(
            record.objective,
            step,
            self._require_plan(record),
            template,
            context,
        )
        
        sub_agent_result, diagnostics, attempts = await self._execute_step_with_retries(
            record,
            step,
            template,
            context,
            policy_decision,
        )
        
        step.status = "completed"
        
        report = StepExecutionRecord(
            step_id=sub_agent_result.step_report.step_id,
            started_at=step_started_at,
            attempts=attempts,
            summary=sub_agent_result.step_report.summary,
            diagnostics=diagnostics,
        )
        
        artifact = await self._persist_step_artifact(record, context, sub_agent_result, report)
        
        memory_type = "long-term" if step.stage in ("verification", "delivery") else "session"
        importance = max(0.8, diagnostics.overall_score) if step.stage in ("verification", "delivery") else max(0.55, diagnostics.overall_score)
        
        await self.memory_service.remember(
            record.objective.workspace_id,
            sub_agent_result.memory_text,
            [
                step.capability,
                step.stage or "execution",
                template.role,
                diagnostics.failure_class,
            ],
            memory_type,
            importance,
        )
        
        await self.audit_service.record(
            "mission.step.completed",
            step.id,
            "agent-orchestrator",
            {
                "mission_id": record.objective.id,
                "capability": step.capability,
                "model": (
                    runtime_preview.get("model", {}).get("model", "unknown")
                    if isinstance(runtime_preview, dict)
                    else "unknown"
                ),
                "run_id": sub_agent_result.run.get("id", ""),
                "overall_score": diagnostics.overall_score,
                "failure_class": diagnostics.failure_class,
                "attempts": attempts,
            },
        )
        
        return StepOutcome(
            step=step,
            report=report,
            output=sub_agent_result.output,
            artifact=artifact,
            memory_text=sub_agent_result.memory_text,
            run_id=sub_agent_result.run.get("id", ""),
            diagnostics=diagnostics,
        )

    async def _apply_adaptive_replan(
        self,
        record: MissionRecord,
        failure: StepExecutionFailure,
        context: ExecutionContext,
    ) -> bool:
        plan = self._require_plan(record)
        current_step = next((s for s in plan.steps if s.id == failure.step.id), failure.step)
        
        replan_result = self.replanner.apply(record, {
            "step": current_step,
            "attempts": failure.attempts,
            "error_message": failure.error_message,
            "diagnostics": failure.diagnostics,
        })
        
        self._append_decision_entries(record, replan_result["decision_entries"])
        
        for entry in replan_result["decision_entries"]:
            await self.audit_service.record(
                f'mission.decision.{entry.get("category", "unknown")}',
                entry.get("step_id", record.objective.id),
                "agent-orchestrator",
                {
                    "mission_id": record.objective.id,
                    "plan_version": entry.get("plan_version", 1),
                    "severity": entry.get("severity", ""),
                    "summary": entry.get("summary", ""),
                    "reasoning": entry.get("reasoning", ""),
                },
            )
        
        if not replan_result["patched"]:
            return False
        
        if replan_result["plan"]:
            record.plan = replan_result["plan"]
        
        self._append_replan_patch(record, replan_result.get("replan_patch"))
        
        await self.audit_service.record(
            "mission.replanned",
            failure.step.id,
            "agent-orchestrator",
            {
                "mission_id": record.objective.id,
                "inserted_steps": [s.id for s in replan_result.get("remediation_steps", [])],
                "plan_version": record.plan_version or 1,
            },
        )
        
        await self._persist_decision_log_artifact(record, context)
        
        return True

    def _build_mission_report(
        self,
        record: MissionRecord,
        reports: list[StepExecutionRecord],
        artifacts: list[MissionArtifact],
    ) -> str:
        metrics = self.intelligence.build_mission_metrics(reports, artifacts, record.decision_log)
        return self.intelligence.build_mission_report(
            record,
            reports,
            artifacts,
            metrics,
            record.decision_log,
            record.replan_history,
        )

    def _sync_remaining_steps(self, record: MissionRecord, remaining_steps: set[str]) -> None:
        if not record.plan:
            return
        for step in record.plan.steps:
            if step.status in ("completed", "skipped"):
                remaining_steps.discard(step.id)
            else:
                remaining_steps.add(step.id)

    def find_step(self, record: MissionRecord, step_id: str) -> MissionStep | None:
        return next((s for s in self._require_plan(record).steps if s.id == step_id), None)

    async def execute_queued_step(
        self,
        record: MissionRecord,
        step_id: str,
        context: ExecutionContext,
    ) -> StepOutcome:
        step = self.find_step(record, step_id)
        if not step:
            raise ValueError(f'Step "{step_id}" not found for mission "{record.objective.id}".')
        
        template = self._template_by_capability(record).get(step.capability)
        if not template:
            raise ValueError(f'Missing sub-agent template for capability "{step.capability}".')
        
        return await self._execute_step(record, step, template, context)

    async def recover_failed_step(
        self,
        record: MissionRecord,
        failure: StepExecutionFailure,
        context: ExecutionContext,
    ) -> bool:
        return await self._apply_adaptive_replan(record, failure, context)

    async def finalize_distributed_execution(
        self,
        record: MissionRecord,
        context: ExecutionContext,
    ) -> MissionRunResult:
        active_execution = record.active_execution
        if not active_execution:
            raise ValueError(
                f'Mission "{record.objective.id}" has no active execution state.'
            )

        artifacts = list(active_execution.artifacts)
        ordered_reports = self._ordered_reports(record, active_execution.step_reports)

        decision_artifact = await self._persist_decision_log_artifact(record, context)
        if decision_artifact:
            artifacts.append(decision_artifact)

        metrics = self.intelligence.build_mission_metrics(
            ordered_reports,
            artifacts,
            record.decision_log,
        )
        gaps = self.intelligence.build_mission_gaps(ordered_reports)
        report_content = self._build_mission_report(record, ordered_reports, artifacts)
        report_path = await self.file_service.write_artifact(
            context.workspace_root,
            record.objective.id,
            "mission-report.md",
            report_content,
        )

        artifacts.append(
            MissionArtifact(
                id=str(uuid.uuid4()),
                kind="report",
                title="Mission report",
                path=report_path,
                created_at=utc_now_iso(),
                metadata={
                    "mission_id": record.objective.id,
                    "step_count": len(ordered_reports),
                },
            )
        )

        return MissionRunResult(
            mission_id=record.objective.id,
            status="completed",
            execution_mode="distributed",
            verification_summary=self.intelligence.build_verification_summary(
                record,
                ordered_reports,
                metrics,
            ),
            outputs=active_execution.outputs,
            memory_updates=active_execution.memory_updates,
            step_reports=ordered_reports,
            artifacts=artifacts,
            metrics={**metrics, "total_artifacts": len(artifacts)},
            gaps=gaps,
            decision_log=record.decision_log,
            started_at=active_execution.started_at,
            finished_at=utc_now_iso(),
        )

    async def execute(self, record: MissionRecord, context: ExecutionContext) -> MissionRunResult:
        started_at = utc_now_iso()
        outputs: dict[str, Any] = {}
        memory_updates: list[str] = []
        step_reports: list[StepExecutionRecord] = []
        artifacts: list[MissionArtifact] = []
        
        plan = self._require_plan(record)
        remaining_steps = {step.id for step in plan.steps}
        
        while remaining_steps:
            active_plan = self._require_plan(record)
            template_by_capability = self._template_by_capability(record)
            self._promote_ready_steps(active_plan.steps)
            self._sync_remaining_steps(record, remaining_steps)
            ready_steps = [s for s in active_plan.steps if s.status == "ready"]
            
            if not ready_steps:
                raise ValueError(
                    f'Mission "{record.objective.id}" cannot make progress because no steps are ready.'
                )
            
            batch = self._select_batch(ready_steps, template_by_capability, context.max_parallelism)
            
            await self.audit_service.record(
                "mission.batch.started",
                record.objective.id,
                "agent-orchestrator",
                {
                    "batch_size": len(batch),
                    "step_ids": [s.id for s in batch],
                },
            )
            
            batch_results = await asyncio.gather(
                *[
                    self._execute_step(record, step, template_by_capability[step.capability], context)
                    for step in batch
                ],
                return_exceptions=True,
            )
            
            replan_applied = False
            unrecoverable_failure = None
            
            for i, result in enumerate(batch_results):
                step = batch[i]
                if isinstance(result, StepOutcome):
                    outputs[step.id] = {
                        "assignee": step.assignee,
                        "run_id": result.run_id,
                        "result": result.output,
                        "payload_preview": json_preview(result.output.get("providerResponses", [])),
                    }
                    memory_updates.append(result.memory_text)
                    step_reports.append(result.report)
                    artifacts.append(result.artifact)
                    remaining_steps.discard(step.id)
                else:
                    if isinstance(result, StepExecutionFailure):
                        patched = await self._apply_adaptive_replan(record, result, context)
                        if patched:
                            replan_applied = True
                            step.status = "pending"
                            continue
                    unrecoverable_failure = result
            
            if unrecoverable_failure:
                raise unrecoverable_failure
            
            if replan_applied:
                self._sync_remaining_steps(record, remaining_steps)
                await self._update_workspace_context(record, context)
                await self.audit_service.record(
                    "mission.batch.replanned",
                    record.objective.id,
                    "agent-orchestrator",
                    {
                        "remaining_steps": len(remaining_steps),
                        "plan_version": record.plan_version or 1,
                    },
                )
                continue
            
            await self._update_workspace_context(record, context)
            await self.audit_service.record(
                "mission.batch.completed",
                record.objective.id,
                "agent-orchestrator",
                {
                    "completed_steps": [
                        batch[i].id
                        for i, r in enumerate(batch_results)
                        if isinstance(r, StepOutcome)
                    ],
                    "remaining_steps": len(remaining_steps),
                },
            )
        
        decision_artifact = await self._persist_decision_log_artifact(record, context)
        if decision_artifact:
            artifacts.append(decision_artifact)
        
        ordered_reports = self._ordered_reports(record, step_reports)
        metrics = self.intelligence.build_mission_metrics(ordered_reports, artifacts, record.decision_log)
        gaps = self.intelligence.build_mission_gaps(ordered_reports)
        report_content = self._build_mission_report(record, ordered_reports, artifacts)
        
        report_path = await self.file_service.write_artifact(
            context.workspace_root,
            record.objective.id,
            "mission-report.md",
            report_content,
        )
        
        artifacts.append(
            MissionArtifact(
                id=str(uuid.uuid4()),
                kind="report",
                title="Mission report",
                path=report_path,
                created_at=utc_now_iso(),
                metadata={
                    "mission_id": record.objective.id,
                    "step_count": len(ordered_reports),
                },
            )
        )
        
        return MissionRunResult(
            mission_id=record.objective.id,
            status="completed",
            execution_mode="local",
            verification_summary=self.intelligence.build_verification_summary(record, ordered_reports, metrics),
            outputs=outputs,
            memory_updates=memory_updates,
            step_reports=ordered_reports,
            artifacts=artifacts,
            metrics={**metrics, "total_artifacts": len(artifacts)},
            gaps=gaps,
            decision_log=record.decision_log,
            started_at=started_at,
            finished_at=utc_now_iso(),
        )
