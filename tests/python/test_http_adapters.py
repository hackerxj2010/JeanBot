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
        self.internal_token = "test-token"
        self.service_name = "test-service"
        self.common_args = {
            "api_url": self.api_url,
            "internal_token": self.internal_token,
            "service_name": self.service_name,
        }

    @patch("urllib.request.urlopen")
    async def test_http_audit_service_record(self, mock_urlopen):
        # Setup mock response
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"status": "ok"}).encode()
        mock_urlopen.return_value = mock_response

        service = HttpAuditService(**self.common_args)
        await service.record("test.event", "entity-1", "service-1", {"key": "value"})

        # Verify request
        self.assertTrue(mock_urlopen.called)
        args, kwargs = mock_urlopen.call_args
        req = args[0]
        self.assertEqual(req.full_url, "http://api.test/internal/audit")
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(req.get_header("X-jeanbot-internal-token"), "test-token")

        body = json.loads(req.data.decode())
        self.assertEqual(body["event"], "test.event")
        self.assertEqual(body["entityId"], "entity-1")

    @patch("urllib.request.urlopen")
    async def test_http_memory_service_remember(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"status": "ok"}).encode()
        mock_urlopen.return_value = mock_response

        service = HttpMemoryService(**self.common_args)
        await service.remember("ws-1", "test memory", ["tag1"], "long-term", 0.9)

        args, _ = mock_urlopen.call_args
        req = args[0]
        self.assertEqual(req.full_url, "http://api.test/internal/memory/workspaces/ws-1/remember")

        body = json.loads(req.data.decode())
        self.assertEqual(body["text"], "test memory")
        self.assertEqual(body["importance"], 0.9)

    @patch("urllib.request.urlopen")
    async def test_http_runtime_service_execute_task(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"result": "success"}).encode()
        mock_urlopen.return_value = mock_response

        service = HttpRuntimeService(**self.common_args)
        result = await service.execute_task({"task": "data"})

        self.assertEqual(result["result"], "success")
        args, _ = mock_urlopen.call_args
        req = args[0]
        self.assertEqual(req.full_url, "http://api.test/internal/runtime/execute")

    @patch("urllib.request.urlopen")
    async def test_http_subagent_service_run_step(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "summary": "step completed",
            "run": {"id": "run-1"},
            "output": {"finalText": "done", "verification": {"passed": True}},
            "memoryText": "remember this",
            "diagnostics": {"overallScore": 0.95, "failureClass": "none"}
        }).encode()
        mock_urlopen.return_value = mock_response

        service = HttpSubAgentService(**self.common_args)

        objective = MissionObjective(id="m1", title="M1", objective="Obj", workspace_id="ws-1")
        step = MissionStep(id="s1", title="S1", description="D1", capability="research")
        template = SubAgentTemplate(specialization="research", role="researcher")
        context = ExecutionContext(workspace_root="/tmp")

        params = {
            "objective": objective,
            "step": step,
            "template": template,
            "context": context,
            "attempt": 1
        }

        result = await service.run_step(params)

        self.assertEqual(result.step_report.summary, "step completed")
        self.assertEqual(result.step_report.diagnostics.overall_score, 0.95)

        args, _ = mock_urlopen.call_args
        req = args[0]
        self.assertEqual(req.full_url, "http://api.test/api/runtime/execute")

        body = json.loads(req.data.decode())
        self.assertEqual(body["workspaceId"], "ws-1")
        self.assertEqual(body["capability"], "research")

if __name__ == "__main__":
    unittest.main()
