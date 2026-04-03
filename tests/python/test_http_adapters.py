import unittest
from unittest.mock import MagicMock, patch
import json
import base64
from io import BytesIO
from src.cognitive.adapters import (
    HttpAuditService,
    HttpMemoryService,
    HttpAgentRuntimeService,
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
        self.base_url = "http://api.test"
        self.token = "test-token"
        self.audit_service = HttpAuditService(self.base_url, self.token)
        self.memory_service = HttpMemoryService(self.base_url, self.token)
        self.runtime_service = HttpAgentRuntimeService(self.base_url, self.token)
        self.subagent_service = HttpSubAgentService(self.base_url, self.token)

    @patch("urllib.request.urlopen")
    async def test_audit_record(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"ok": True}).encode("utf-8")
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        await self.audit_service.record("test.event", "entity-1", "test-service", {"foo": "bar"})

        self.assertTrue(mock_urlopen.called)
        args, kwargs = mock_urlopen.call_args
        req = args[0]
        self.assertEqual(req.full_url, f"{self.base_url}/internal/audit")
        self.assertEqual(req.get_header("X-jeanbot-internal-token"), self.token)
        body = json.loads(req.data)
        self.assertEqual(body["event"], "test.event")

    @patch("urllib.request.urlopen")
    async def test_memory_remember(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"ok": True}).encode("utf-8")
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        await self.memory_service.remember("ws-1", "some text", ["tag1"], "session", 0.9)

        self.assertTrue(mock_urlopen.called)
        args, kwargs = mock_urlopen.call_args
        req = args[0]
        self.assertEqual(req.full_url, f"{self.base_url}/internal/memory/workspaces/ws-1/remember")
        body = json.loads(req.data)
        self.assertEqual(body["text"], "some text")

    @patch("urllib.request.urlopen")
    async def test_runtime_execute_task(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"status": "completed"}).encode("utf-8")
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        res = await self.runtime_service.execute_task({"task": "do something"})

        self.assertEqual(res["status"], "completed")
        self.assertTrue(mock_urlopen.called)
        args, _ = mock_urlopen.call_args
        req = args[0]
        self.assertEqual(req.full_url, f"{self.base_url}/internal/runtime/execute")

    @patch("urllib.request.urlopen")
    async def test_subagent_run_step(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "summary": "Step done",
            "run": {"id": "run-1"},
            "output": {"finalText": "Result text"},
            "memoryText": "Memory text",
            "diagnostics": {"overallScore": 0.95}
        }).encode("utf-8")
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        objective = MissionObjective(id="m-1", title="M1", objective="Obj", workspace_id="ws-1")
        step = MissionStep(id="s-1", title="S1", description="Desc", capability="research")

        res = await self.subagent_service.run_step({
            "objective": objective,
            "step": step,
            "auth_context": {"user": "test-user"}
        })

        self.assertEqual(res.step_report.summary, "Step done")
        self.assertEqual(res.memory_text, "Memory text")
        self.assertEqual(res.step_report.diagnostics.overall_score, 0.95)

        self.assertTrue(mock_urlopen.called)
        args, _ = mock_urlopen.call_args
        req = args[0]
        self.assertEqual(req.full_url, f"{self.base_url}/api/runtime/execute")

        auth_header = req.get_header("X-jeanbot-auth-context")
        self.assertIsNotNone(auth_header)
        decoded_auth = json.loads(base64.b64decode(auth_header).decode("utf-8"))
        self.assertEqual(decoded_auth["user"], "test-user")

if __name__ == "__main__":
    unittest.main()
