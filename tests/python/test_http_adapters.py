from __future__ import annotations

import json
import unittest
from unittest.mock import MagicMock, patch
import urllib.error

from src.cognitive.adapters import (
    HttpAuditService,
    HttpMemoryService,
    HttpSubAgentService,
)
from src.cognitive.executor import (
    MissionObjective,
    MissionPlan,
    MissionStep,
    SubAgentTemplate,
)


class HttpAdapterTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.api_url = "http://api.test"
        self.internal_token = "test-token"

    @patch("urllib.request.urlopen")
    async def test_http_audit_service_records_event(self, mock_urlopen):
        # Setup mock
        mock_response = MagicMock()
        mock_response.status = 204
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpAuditService(self.api_url, self.internal_token)
        await service.record("test.event", "entity-1", "test-service", {"foo": "bar"})

        # Verify request
        args, kwargs = mock_urlopen.call_args
        req = args[0]
        self.assertEqual(req.full_url, f"{self.api_url}/internal/audit")
        self.assertEqual(req.get_header("X-jeanbot-internal-token"), self.internal_token)

        body = json.loads(req.data.decode("utf-8"))
        self.assertEqual(body["event"], "test.event")
        self.assertEqual(body["data"]["foo"], "bar")

    @patch("urllib.request.urlopen")
    async def test_http_memory_service_remembers(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.status = 204
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpMemoryService(self.api_url, self.internal_token)
        await service.remember("ws-1", "some memory", ["tag1"], "session", 0.9)

        args, kwargs = mock_urlopen.call_args
        req = args[0]
        self.assertEqual(req.full_url, f"{self.api_url}/internal/memory/workspaces/ws-1/remember")

        body = json.loads(req.data.decode("utf-8"))
        self.assertEqual(body["text"], "some memory")
        self.assertEqual(body["importance"], 0.9)

    @patch("urllib.request.urlopen")
    async def test_http_subagent_service_runs_step(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.read.return_value = json.dumps({
            "step_report": {
                "step_id": "step-1",
                "started_at": "2026-03-13T12:00:00",
                "attempts": 1,
                "summary": "Step completed successfully",
                "diagnostics": {
                    "overall_score": 0.95,
                    "failure_class": "none",
                    "retryable": False
                }
            },
            "run": {"id": "run-1"},
            "output": {"finalText": "success"},
            "memory_text": "step 1 finished"
        }).encode("utf-8")
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpSubAgentService(self.api_url, self.internal_token)
        params = {
            "step": MissionStep("step-1", "Title", "Desc", "research"),
            "template": SubAgentTemplate("research", "researcher"),
            "auth_context": {"user": "test-user"}
        }

        result = await service.run_step(params)

        self.assertEqual(result.step_report.step_id, "step-1")
        self.assertEqual(result.step_report.diagnostics.overall_score, 0.95)
        self.assertEqual(result.output["finalText"], "success")

        # Verify auth context header
        args, kwargs = mock_urlopen.call_args
        req = args[0]
        self.assertIsNotNone(req.get_header("X-jeanbot-auth-context"))

    @patch("urllib.request.urlopen")
    async def test_http_subagent_service_falls_back_on_error(self, mock_urlopen):
        # Simulate API error
        mock_urlopen.side_effect = Exception("API Down")

        service = HttpSubAgentService(self.api_url, self.internal_token)
        params = {
            "step": MissionStep("step-1", "Title", "Desc", "research"),
            "template": SubAgentTemplate("research", "researcher"),
        }

        # Should NOT raise exception, but fallback to deterministic
        result = await service.run_step(params)

        self.assertEqual(result.step_report.step_id, "step-1")
        # Deterministic output usually starts with "[role]"
        self.assertIn("[researcher]", result.output["finalText"])


if __name__ == "__main__":
    unittest.main()
