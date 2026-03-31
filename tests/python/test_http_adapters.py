import unittest
from unittest.mock import patch, MagicMock
from src.cognitive.adapters import HttpAuditService, HttpMemoryService, HttpSubAgentService
from src.cognitive.executor import MissionObjective, MissionStep, MissionPlan, SubAgentTemplate, ExecutionContext

class TestHttpAdapters(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.api_url = "http://localhost:8080"
        self.token = "test-token"
        self.audit_service = HttpAuditService(api_url=self.api_url, service_token=self.token)
        self.memory_service = HttpMemoryService(api_url=self.api_url, service_token=self.token)
        self.subagent_service = HttpSubAgentService(api_url=self.api_url, service_token=self.token)

    @patch("urllib.request.urlopen")
    async def test_audit_record(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = b'{"ok": true}'
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        await self.audit_service.record("test.event", "entity-1", "test-service", {"foo": "bar"})

        mock_urlopen.assert_called_once()
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_full_url(), f"{self.api_url}/internal/audit")
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(req.headers["X-jeanbot-internal-token"], self.token)

    @patch("urllib.request.urlopen")
    async def test_memory_remember(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = b'{"ok": true}'
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        await self.memory_service.remember("ws-1", "test memory", ["tag1"], "session", 0.9)

        mock_urlopen.assert_called_once()
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_full_url(), f"{self.api_url}/internal/memory/workspaces/ws-1/remember")
        self.assertEqual(req.get_method(), "POST")

    @patch("urllib.request.urlopen")
    async def test_subagent_run_step(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = b'{"id": "run-1", "output": {"finalText": "hello"}}'
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        objective = MissionObjective(id="m-1", title="M1", objective="O1", workspace_id="ws-1")
        step = MissionStep(id="s-1", title="S1", description="D1", capability="research")
        template = SubAgentTemplate(specialization="research", role="researcher", provider="anthropic", model="claude-3")
        context = ExecutionContext(workspace_root="/tmp")

        params = {
            "objective": objective,
            "step": step,
            "template": template,
            "context": context,
            "attempt": 1
        }

        result = await self.subagent_service.run_step(params)

        self.assertEqual(result.run["id"], "run-1")
        self.assertEqual(result.output["finalText"], "hello")
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_full_url(), f"{self.api_url}/api/runtime/execute")

if __name__ == "__main__":
    unittest.main()
