from __future__ import annotations

import unittest

from src.cognitive.executor import (
    ActiveExecutionState,
    ExecutionContext,
    MissionArtifact,
    MissionExecutor,
    MissionObjective,
    MissionPlan,
    MissionRecord,
    MissionStep,
    PolicyDecision,
    StepExecutionDiagnostics,
    StepExecutionFailure,
    StepExecutionRecord,
    SubAgentExecutionResult,
    SubAgentTemplate,
)


class StubRuntimeService:
    def __init__(self, model_name: str = "glm-5:cloud"):
        self.model_name = model_name
        self.calls: list[tuple[str, str]] = []

    def prepare_frame(self, objective, step, plan, template, context):
        self.calls.append((objective.id, step.id))
        return {"model": {"model": self.model_name}}

    def execute_task(self, request):
        raise NotImplementedError


class StubAuditService:
    def __init__(self):
        self.events: list[dict] = []

    async def record(self, event: str, entity_id: str, service: str, data: dict):
        self.events.append(
            {
                "event": event,
                "entity_id": entity_id,
                "service": service,
                "data": data,
            }
        )


class StubMemoryService:
    def __init__(self):
        self.records: list[dict] = []

    async def remember(
        self,
        workspace_id: str,
        text: str,
        tags: list[str],
        memory_type: str,
        importance: float,
    ):
        self.records.append(
            {
                "workspace_id": workspace_id,
                "text": text,
                "tags": tags,
                "memory_type": memory_type,
                "importance": importance,
            }
        )


class StubFileService:
    def __init__(self):
        self.context_updates: list[dict] = []
        self.artifacts: list[dict] = []

    async def update_workspace_context(
        self,
        workspace_root: str,
        mission_title: str,
        completed_steps: list[str],
        running_steps: list[str],
        pending_steps: list[str],
    ):
        self.context_updates.append(
            {
                "workspace_root": workspace_root,
                "mission_title": mission_title,
                "completed_steps": completed_steps,
                "running_steps": running_steps,
                "pending_steps": pending_steps,
            }
        )

    async def write_artifact(
        self,
        workspace_root: str,
        mission_id: str,
        filename: str,
        content: str,
    ) -> str:
        path = f"{workspace_root}/{mission_id}/{filename}"
        self.artifacts.append({"path": path, "content": content})
        return path


class StubPolicyService:
    def evaluate_mission(self, mission_data: dict) -> PolicyDecision:
        return PolicyDecision(approval_required=False, risk="low")


class StubSubAgentService:
    def __init__(self, fail_steps: set[str] | None = None):
        self.fail_steps = fail_steps or set()
        self.attempts: dict[str, int] = {}

    def spawn_for_plan(self, plan: MissionPlan) -> list[SubAgentTemplate]:
        capabilities = {step.capability for step in plan.steps}
        return [
            SubAgentTemplate(
                specialization=capability,
                role=f"{capability}-agent",
                provider="ollama",
                model="glm-5:cloud",
                tool_ids=["read_file"],
                max_parallel_tasks=2,
            )
            for capability in capabilities
        ]

    async def run_step(self, params: dict) -> SubAgentExecutionResult:
        step: MissionStep = params["step"]
        self.attempts[step.id] = self.attempts.get(step.id, 0) + 1
        if step.id in self.fail_steps:
            raise RuntimeError(f"step {step.id} exploded")

        return SubAgentExecutionResult(
            step_report=StepExecutionRecord(
                step_id=step.id,
                started_at="2026-03-13T00:00:00",
                summary=f"summary for {step.id}",
            ),
            run={
                "id": f"run-{step.id}",
                "capability": step.capability,
                "templateRole": f"{step.capability}-agent",
                "status": "completed",
                "provider": "ollama",
                "model": "glm-5:cloud",
            },
            output={
                "finalText": f"final output for {step.id}",
                "verification": {"passed": True, "reason": "ok"},
                "toolCalls": [{"toolId": "read_file", "action": "read", "ok": True}],
                "providerResponses": [
                    {
                        "provider": "ollama",
                        "mode": "live",
                        "message": f"provider response for {step.id}",
                    }
                ],
            },
            memory_text=f"memory for {step.id}",
        )


class MissionExecutorTests(unittest.IsolatedAsyncioTestCase):
    def build_executor(self, fail_steps: set[str] | None = None):
        runtime = StubRuntimeService()
        memory = StubMemoryService()
        audit = StubAuditService()
        file_service = StubFileService()
        subagents = StubSubAgentService(fail_steps=fail_steps)
        executor = MissionExecutor(
            runtime=runtime,
            memory_service=memory,
            audit_service=audit,
            sub_agent_service=subagents,
            file_service=file_service,
            policy_service=StubPolicyService(),
        )
        return executor, runtime, memory, audit, file_service, subagents

    async def test_execute_records_runtime_preview_model(self):
        executor, runtime, memory, audit, _, _ = self.build_executor()
        objective = MissionObjective(
            id="mission-1",
            title="Mission One",
            objective="Do the work",
            workspace_id="workspace-1",
        )
        plan = MissionPlan(
            version=1,
            steps=[
                MissionStep(
                    id="step-1",
                    title="Research",
                    description="Gather evidence",
                    capability="research",
                )
            ],
        )
        record = MissionRecord(objective=objective, plan=plan, plan_version=1)
        context = ExecutionContext(workspace_root="workspace/root")

        result = await executor.execute(record, context)

        self.assertEqual(result.status, "completed")
        self.assertEqual(runtime.calls, [("mission-1", "step-1")])
        self.assertEqual(len(memory.records), 1)

        completed_event = next(
            event for event in audit.events if event["event"] == "mission.step.completed"
        )
        self.assertEqual(completed_event["data"]["model"], "glm-5:cloud")

    async def test_finalize_distributed_execution_orders_reports(self):
        executor, _, _, _, file_service, _ = self.build_executor()
        objective = MissionObjective(
            id="mission-2",
            title="Mission Two",
            objective="Finish distributed work",
            workspace_id="workspace-1",
        )
        plan = MissionPlan(
            version=3,
            steps=[
                MissionStep(
                    id="step-a",
                    title="First",
                    description="first",
                    capability="research",
                ),
                MissionStep(
                    id="step-b",
                    title="Second",
                    description="second",
                    capability="browser",
                ),
            ],
        )
        record = MissionRecord(
            objective=objective,
            plan=plan,
            plan_version=3,
            active_execution=ActiveExecutionState(
                started_at="2026-03-13T12:00:00",
                outputs={"step-a": {"result": "a"}, "step-b": {"result": "b"}},
                memory_updates=["memory a", "memory b"],
                step_reports=[
                    StepExecutionRecord(
                        step_id="step-b",
                        started_at="2026-03-13T12:00:05",
                        attempts=1,
                        summary="b summary",
                        diagnostics=StepExecutionDiagnostics(overall_score=1.0),
                    ),
                    StepExecutionRecord(
                        step_id="step-a",
                        started_at="2026-03-13T12:00:01",
                        attempts=1,
                        summary="a summary",
                        diagnostics=StepExecutionDiagnostics(overall_score=1.0),
                    ),
                ],
                artifacts=[
                    MissionArtifact(
                        id="artifact-1",
                        kind="log",
                        title="existing artifact",
                        path="workspace/root/mission-2/existing.md",
                        created_at="2026-03-13T12:00:10",
                    )
                ],
            ),
        )

        result = await executor.finalize_distributed_execution(
            record,
            ExecutionContext(workspace_root="workspace/root"),
        )

        self.assertEqual(result.execution_mode, "distributed")
        self.assertEqual([report.step_id for report in result.step_reports], ["step-a", "step-b"])
        self.assertEqual(result.started_at, "2026-03-13T12:00:00")
        self.assertTrue(
            any(artifact["path"].endswith("mission-report.md") for artifact in file_service.artifacts)
        )

    async def test_step_failure_uses_string_error_message(self):
        executor, _, _, _, _, _ = self.build_executor(fail_steps={"step-err"})
        objective = MissionObjective(
            id="mission-3",
            title="Mission Three",
            objective="Fail cleanly",
            workspace_id="workspace-1",
        )
        plan = MissionPlan(
            version=1,
            steps=[
                MissionStep(
                    id="step-err",
                    title="Explode",
                    description="explode",
                    capability="research",
                )
            ],
        )
        record = MissionRecord(objective=objective, plan=plan, plan_version=1)

        with self.assertRaises(StepExecutionFailure) as captured:
            await executor.execute(record, ExecutionContext(workspace_root="workspace/root"))

        self.assertIn("step step-err exploded", captured.exception.error_message)


if __name__ == "__main__":
    unittest.main()
