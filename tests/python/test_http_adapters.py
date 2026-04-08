import json
import unittest
from unittest.mock import MagicMock, patch
from src.cognitive.adapters import (
    HttpAuditService,
    HttpMemoryService,
    HttpRuntimeService,
    HttpSubAgentService,
)
from src.cognitive.executor import (
    MissionObjective,
    MissionStep,
    MissionPlan,
    SubAgentTemplate,
    ExecutionContext,
)

class TestHttpAdapters(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.api_url = "http://api.test"
        self.token = "test-token"

    @patch("urllib.request.urlopen")
    async def test_http_audit_service_record(self, mock_urlopen):
        # Setup mock response
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"status": "ok"}).encode("utf-8")
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpAuditService(self.api_url, self.token)
        await service.record("test.event", "entity-1", "test-service", {"foo": "bar"})

        self.assertTrue(mock_urlopen.called)
        args, kwargs = mock_urlopen.call_args
        req = args[0]
        self.assertEqual(req.get_full_url(), "http://api.test/internal/audit")
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(req.get_header("X-jeanbot-internal-token"), "test-token")

    @patch("urllib.request.urlopen")
    async def test_http_memory_service_remember(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"status": "ok"}).encode("utf-8")
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpMemoryService(self.api_url, self.token)
        await service.remember("ws-1", "test memory", ["tag1"], "session", 0.5)

        self.assertTrue(mock_urlopen.called)
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_full_url(), "http://api.test/internal/memory/workspaces/ws-1/remember")

    @patch("urllib.request.urlopen")
    async def test_http_runtime_service_execute_task(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"output": "test-output"}).encode("utf-8")
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpRuntimeService(self.api_url, self.token)
        result = await service.execute_task({"task": "do something"})

        self.assertEqual(result["output"], "test-output")
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_full_url(), "http://api.test/internal/runtime/execute")

    @patch("urllib.request.urlopen")
    async def test_http_sub_agent_service_run_step(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "summary": "Step completed",
            "diagnostics": {
                "overall_score": 0.9,
                "failure_class": "none",
                "retryable": False
            },
            "run": {"id": "run-1"},
            "output": {"text": "hello"},
            "memoryText": "remembered hello"
        }).encode("utf-8")
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpSubAgentService(self.api_url, self.token)
        step = MissionStep(id="step-1", title="Step 1", description="", capability="research")
        params = {"step": step, "template": {}, "attempt": 1}

        result = await service.run_step(params)

        self.assertEqual(result.step_report.summary, "Step completed")
        self.assertEqual(result.run["id"], "run-1")
        self.assertEqual(result.memory_text, "remembered hello")
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_full_url(), "http://api.test/api/runtime/execute")

if __name__ == "__main__":
    unittest.main()
