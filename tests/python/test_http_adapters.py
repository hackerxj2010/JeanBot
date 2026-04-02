import json
import unittest
from unittest.mock import MagicMock, patch

from src.cognitive.adapters import HttpAuditService, HttpMemoryService, HttpSubAgentService
from src.cognitive.executor import MissionPlan, MissionStep


class TestHttpAdapters(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.api_url = "http://localhost:8080"
        self.internal_token = "test-token"

    @patch("urllib.request.urlopen")
    async def test_http_audit_service_record(self, mock_urlopen):
        # Mock successful response
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"ok": True}).encode("utf-8")
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpAuditService(api_url=self.api_url, internal_token=self.internal_token)
        await service.record("test.event", "entity-1", "test-service", {"foo": "bar"})

        self.assertTrue(mock_urlopen.called)
        args, kwargs = mock_urlopen.call_args
        request = args[0]
        self.assertEqual(request.get_full_url(), f"{self.api_url}/internal/audit")
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.get_header("X-jeanbot-internal-token"), self.internal_token)

        body = json.loads(request.data.decode("utf-8"))
        self.assertEqual(body["event"], "test.event")
        self.assertEqual(body["entityId"], "entity-1")

    @patch("urllib.request.urlopen")
    async def test_http_memory_service_remember(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"ok": True}).encode("utf-8")
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpMemoryService(api_url=self.api_url, internal_token=self.internal_token)
        await service.remember("ws-1", "test text", ["tag1"], "session", 0.8)

        self.assertTrue(mock_urlopen.called)
        args, _ = mock_urlopen.call_args
        request = args[0]
        self.assertEqual(
            request.get_full_url(), f"{self.api_url}/internal/memory/workspaces/ws-1/remember"
        )

        body = json.loads(request.data.decode("utf-8"))
        self.assertEqual(body["text"], "test text")
        self.assertEqual(body["importance"], 0.8)

    @patch("urllib.request.urlopen")
    async def test_http_subagent_service_run_step_success(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "stepReport": {
                "stepId": "step-1",
                "startedAt": "2026-03-12T12:00:00Z",
                "attempts": 1,
                "summary": "Completed",
                "diagnostics": {"overall_score": 0.9, "failure_class": "none"}
            },
            "run": {"id": "run-1"},
            "output": {"finalText": "Done"},
            "memoryText": "Mem"
        }).encode("utf-8")
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpSubAgentService(api_url=self.api_url, internal_token=self.internal_token)
        step = MissionStep(id="step-1", title="T", description="D", capability="research")
        result = await service.run_step({"step": step, "auth_context": {"userId": "u1"}})

        self.assertEqual(result.step_report.step_id, "step-1")
        self.assertEqual(result.output["finalText"], "Done")
        self.assertEqual(result.memory_text, "Mem")

        args, _ = mock_urlopen.call_args
        request = args[0]
        self.assertEqual(request.get_full_url(), f"{self.api_url}/api/runtime/execute")
        # Header keys in urllib.request.Request might be normalized
        headers = {k.lower(): v for k, v in request.headers.items()}
        self.assertIn("x-jeanbot-internal-auth-context", headers)

    @patch("urllib.request.urlopen")
    async def test_http_subagent_service_fallback(self, mock_urlopen):
        # Mock failure
        mock_urlopen.side_effect = Exception("API Down")

        service = HttpSubAgentService(api_url=self.api_url, internal_token=self.internal_token)
        step = MissionStep(id="step-1", title="T", description="D", capability="research")

        # Should fallback to DeterministicSubAgentService
        result = await service.run_step({"step": step, "template": MagicMock(tool_ids=[])})

        self.assertEqual(result.step_report.step_id, "step-1")
        self.assertEqual(result.run["status"], "completed")
