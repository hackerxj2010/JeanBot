from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.cognitive.cli import main as cli_main
from src.cognitive.service import MissionExecutorService
from src.cognitive.adapters import (
    HttpAuditService,
    HttpMemoryService,
    HttpPolicyService,
    HttpRuntimeService,
    HttpSubAgentService,
    LocalAuditService,
)


class MissionExecutorServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_execute_payload_persists_run_summary(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            service = MissionExecutorService(workspace_root=tmpdir)
            payload = {
                "workspace_id": "workspace-1",
                "title": "Python Service Mission",
                "objective": "Run through the Python mission service.",
                "steps": [
                    {
                        "id": "step-1",
                        "title": "Research",
                        "description": "Gather context",
                        "capability": "research",
                        "depends_on": [],
                    },
                    {
                        "id": "step-2",
                        "title": "Build",
                        "description": "Produce output",
                        "capability": "software-development",
                        "depends_on": ["step-1"],
                    },
                ],
            }

            result = await service.execute_payload(payload)

            self.assertEqual(result.status, "completed")
            run_path = Path(tmpdir) / ".jeanbot" / "missions" / result.mission_id / "mission-run.json"
            self.assertTrue(run_path.exists())
            run_data = json.loads(run_path.read_text(encoding="utf-8"))
            self.assertEqual(run_data["result"]["status"], "completed")
            self.assertEqual(run_data["memory_summary"]["memory_count"], 2)

    async def test_finalize_distributed_payload_uses_active_execution(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            service = MissionExecutorService(workspace_root=tmpdir)
            payload = {
                "id": "mission-dist-1",
                "workspace_id": "workspace-1",
                "title": "Distributed Finalize",
                "objective": "Finalize active execution state.",
                "plan_version": 2,
                "steps": [
                    {
                        "id": "step-a",
                        "title": "A",
                        "description": "A",
                        "capability": "research",
                        "depends_on": [],
                    },
                    {
                        "id": "step-b",
                        "title": "B",
                        "description": "B",
                        "capability": "verification",
                        "depends_on": ["step-a"],
                    },
                ],
                "active_execution": {
                    "started_at": "2026-03-13T10:00:00+00:00",
                    "outputs": {"step-a": {"ok": True}},
                    "memory_updates": ["memory"],
                    "step_reports": [
                        {
                            "step_id": "step-b",
                            "started_at": "2026-03-13T10:00:02+00:00",
                            "attempts": 1,
                            "summary": "b",
                            "diagnostics": {"overall_score": 1.0},
                        },
                        {
                            "step_id": "step-a",
                            "started_at": "2026-03-13T10:00:01+00:00",
                            "attempts": 1,
                            "summary": "a",
                            "diagnostics": {"overall_score": 1.0},
                        },
                    ],
                    "artifacts": [],
                },
            }

            result = await service.finalize_distributed_payload(payload)

            self.assertEqual(result.execution_mode, "distributed")
            self.assertEqual([report.step_id for report in result.step_reports], ["step-a", "step-b"])

    async def test_build_bundle_switches_to_http_adapters(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            service = MissionExecutorService(workspace_root=tmpdir)
            payload = {
                "workspace_id": "workspace-http",
                "title": "HTTP Mission",
                "objective": "Test HTTP adapter switching.",
            }

            with patch.dict(os.environ, {"JEANBOT_SERVICE_MODE": "http", "JEANBOT_API_URL": "http://api:8080"}):
                bundle = service.build_bundle(payload)
                self.assertIsInstance(bundle.audit_service, HttpAuditService)
                self.assertIsInstance(bundle.memory_service, HttpMemoryService)
                self.assertIsInstance(bundle.policy_service, HttpPolicyService)
                self.assertIsInstance(bundle.runtime_service, HttpRuntimeService)
                self.assertIsInstance(bundle.subagent_service, HttpSubAgentService)
                self.assertEqual(bundle.audit_service.api_url, "http://api:8080")

            with patch.dict(os.environ, {"JEANBOT_SERVICE_MODE": "local"}):
                bundle = service.build_bundle(payload)
                self.assertIsInstance(bundle.audit_service, LocalAuditService)


class MissionExecutorCliTests(unittest.TestCase):
    def test_cli_write_template_and_execute(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            workspace = Path(tmpdir) / "workspace"
            mission_file = Path(tmpdir) / "mission.json"

            exit_code = cli_main(["write-template", "--output", str(mission_file)])
            self.assertEqual(exit_code, 0)
            self.assertTrue(mission_file.exists())

            exit_code = cli_main(
                [
                    "execute",
                    "--mission-file",
                    str(mission_file),
                    "--workspace-root",
                    str(workspace),
                ]
            )
            self.assertEqual(exit_code, 0)
            mission_root = Path(workspace) / ".jeanbot" / "missions"
            self.assertTrue(mission_root.exists())


if __name__ == "__main__":
    unittest.main()
