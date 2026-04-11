import unittest
from unittest.mock import patch, MagicMock
from src.cognitive.adapters import HttpAuditService, HttpMemoryService, HttpRuntimeService, HttpSubAgentService
from src.cognitive.executor import MissionObjective, MissionStep, MissionPlan, SubAgentTemplate, ExecutionContext

class TestHttpAdapters(unittest.IsolatedAsyncioTestCase):
    @patch("urllib.request.urlopen")
    async def test_http_audit_service_record(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = b"{}"
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpAuditService(base_url="http://test-api", token="test-token")
        await service.record("test.event", "entity-1", "test-service", {"foo": "bar"})

        self.assertTrue(mock_urlopen.called)
        args, kwargs = mock_urlopen.call_args
        req = args[0]
        self.assertEqual(req.get_full_url(), "http://test-api/internal/audit")
        self.assertEqual(req.get_header("X-jeanbot-internal-token"), "test-token")

    @patch("urllib.request.urlopen")
    async def test_http_memory_service_remember(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = b"{}"
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpMemoryService(base_url="http://test-api", token="test-token")
        await service.remember("ws-1", "important info", ["tag1"], "long-term", 0.9)

        self.assertTrue(mock_urlopen.called)
        args, kwargs = mock_urlopen.call_args
        req = args[0]
        self.assertEqual(req.get_full_url(), "http://test-api/internal/memory/workspaces/ws-1/remember")

    @patch("urllib.request.urlopen")
    async def test_http_runtime_service_execute(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = b'{"status": "ok"}'
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpRuntimeService(base_url="http://test-api", token="test-token")
        result = await service.execute_task({"task": "do something", "auth_context": {"user": "test"}})

        self.assertEqual(result, {"status": "ok"})
        self.assertTrue(mock_urlopen.called)
        req = mock_urlopen.call_args[0][0]
        # Case insensitive check for headers
        headers = {k.lower(): v for k, v in req.headers.items()}
        self.assertIn("x-jeanbot-auth-context", headers)

    @patch("src.cognitive.adapters.HttpRuntimeService.execute_task")
    async def test_http_subagent_service_run_step(self, mock_execute_task):
        mock_execute_task.return_value = {
            "finalText": "step completed",
            "toolCalls": [],
            "verification": {"ok": True, "reason": "verified"}
        }

        runtime = HttpRuntimeService()
        service = HttpSubAgentService(runtime=runtime)

        objective = MissionObjective(id="m1", title="M1", objective="Obj", workspace_id="ws1")
        step = MissionStep(id="s1", title="S1", description="D1", capability="research")
        plan = MissionPlan(steps=[step])
        template = SubAgentTemplate(specialization="research", role="researcher")
        context = ExecutionContext(workspace_root="/tmp")

        params = {
            "mission_id": "m1",
            "objective": objective,
            "plan": plan,
            "step": step,
            "template": template,
            "context": context,
            "auth_context": {"token": "abc"}
        }

        result = await service.run_step(params)
        self.assertEqual(result.run["status"], "completed")
        self.assertEqual(result.output["finalText"], "step completed")

        # Verify auth_context was passed
        mock_execute_task.assert_called_once()
        sent_request = mock_execute_task.call_args[0][0]
        self.assertEqual(sent_request["auth_context"], {"token": "abc"})

if __name__ == "__main__":
    unittest.main()
