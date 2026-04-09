import unittest
import json
from pathlib import Path
from src.cognitive.executor import (
    MissionRecord, MissionObjective, MissionPlan, MissionStep,
    ActiveExecutionState, StepExecutionRecord, StepExecutionDiagnostics,
    MissionArtifact, utc_now_iso
)
from src.cognitive.adapters import asdict_fallback

class TestPersistence(unittest.TestCase):
    def test_deep_persistence_roundtrip(self):
        objective = MissionObjective(
            id="test-id",
            title="Test Mission",
            objective="Deep test",
            workspace_id="ws-1"
        )
        step = MissionStep(
            id="step-1",
            title="Step 1",
            description="Desc",
            capability="research",
            status="completed"
        )
        plan = MissionPlan(version=2, steps=[step])

        diag = StepExecutionDiagnostics(
            overall_score=0.95,
            failure_class="none",
            missing_signals=["signal1"],
            recommended_actions=["action1"]
        )
        report = StepExecutionRecord(
            step_id="step-1",
            started_at=utc_now_iso(),
            attempts=1,
            summary="Success",
            diagnostics=diag
        )
        artifact = MissionArtifact(
            id="art-1",
            kind="log",
            title="Artifact 1",
            path="/tmp/art1.md",
            created_at=utc_now_iso(),
            metadata={"key": "value"}
        )
        active_execution = ActiveExecutionState(
            started_at=utc_now_iso(),
            outputs={"step-1": {"ok": True}},
            memory_updates=["update 1"],
            step_reports=[report],
            artifacts=[artifact]
        )

        record = MissionRecord(
            objective=objective,
            plan=plan,
            plan_version=2,
            decision_log=[{"decision": "approve"}],
            replan_history=[{"replan": "retry"}],
            replan_count=1,
            active_execution=active_execution
        )

        # Serialize
        serialized = asdict_fallback(record)
        self.assertIsInstance(serialized, dict)
        self.assertEqual(serialized["objective"]["id"], "test-id")
        self.assertEqual(len(serialized["active_execution"]["step_reports"]), 1)
        self.assertEqual(serialized["active_execution"]["step_reports"][0]["diagnostics"]["overall_score"], 0.95)

        # Deserialize
        deserialized = MissionRecord.from_dict(serialized)

        self.assertEqual(deserialized.objective.id, record.objective.id)
        self.assertEqual(deserialized.plan.version, record.plan.version)
        self.assertEqual(len(deserialized.plan.steps), 1)
        self.assertEqual(deserialized.plan.steps[0].id, "step-1")

        self.assertIsNotNone(deserialized.active_execution)
        self.assertEqual(len(deserialized.active_execution.step_reports), 1)

        deserialized_report = deserialized.active_execution.step_reports[0]
        self.assertEqual(deserialized_report.step_id, "step-1")
        self.assertIsInstance(deserialized_report.diagnostics, StepExecutionDiagnostics)
        self.assertEqual(deserialized_report.diagnostics.overall_score, 0.95)
        self.assertEqual(deserialized_report.diagnostics.missing_signals, ["signal1"])

        self.assertEqual(len(deserialized.active_execution.artifacts), 1)
        deserialized_art = deserialized.active_execution.artifacts[0]
        self.assertIsInstance(deserialized_art, MissionArtifact)
        self.assertEqual(deserialized_art.id, "art-1")
        self.assertEqual(deserialized_art.metadata, {"key": "value"})

if __name__ == "__main__":
    unittest.main()
