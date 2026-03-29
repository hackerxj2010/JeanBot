import unittest
import base64
import json
from unittest.mock import patch, MagicMock
from src.cognitive.adapters import HttpAuditService, HttpMemoryService, HttpRuntimeService, HttpSubAgentService
from src.cognitive.executor import MissionObjective, MissionStep, MissionPlan, SubAgentTemplate, ExecutionContext

class TestHttpAdapters(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.api_url = "http://localhost:8080"
        self.internal_token = "test-token"

    @patch("urllib.request.urlopen")
    async def test_http_audit_service_record(self, mock_urlopen):
        service = HttpAuditService(api_url=self.api_url, internal_token=self.internal_token)
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.read.return_value = b'{"ok": true}'
        mock_urlopen.return_value.__enter__.return_value = mock_response

        await service.record("test.event", "entity-1", "test-service", {"foo": "bar"})

        mock_urlopen.assert_called_once()
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_full_url(), "http://localhost:8080/internal/audit")
        self.assertEqual(req.get_method(), "POST")
        # urllib.request.Request headers are case-insensitive but stored with capitalized keys
        headers = {k.lower(): v for k, v in req.headers.items()}
        self.assertEqual(headers["x-jeanbot-internal-token"], "test-token")

    @patch("urllib.request.urlopen")
    async def test_http_memory_service_remember(self, mock_urlopen):
        service = HttpMemoryService(api_url=self.api_url, internal_token=self.internal_token)
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.read.return_value = b'{"ok": true}'
        mock_urlopen.return_value.__enter__.return_value = mock_response

        await service.remember("ws-1", "test text", ["tag1"], "session", 0.5)

        mock_urlopen.assert_called_once()
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_full_url(), "http://localhost:8080/internal/memory/workspaces/ws-1/remember")

    @patch("urllib.request.urlopen")
    async def test_http_subagent_service_run_step(self, mock_urlopen):
        service = HttpSubAgentService(api_url=self.api_url, internal_token=self.internal_token)
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.read.return_value = b'{"finalText": "success", "verification": {"passed": true}, "provider": "test-p", "model": "test-m"}'
        mock_urlopen.return_value.__enter__.return_value = mock_response

        objective = MissionObjective(id="m1", title="T", objective="O", workspace_id="ws1")
        step = MissionStep(id="s1", title="ST", description="SD", capability="research")
        plan = MissionPlan(version=1, steps=[step])
        template = SubAgentTemplate(specialization="research", role="researcher")
        context = ExecutionContext(workspace_root=".")

        auth_context = {"workspaceIds": ["ws1"]}
        params = {
            "objective": objective,
            "step": step,
            "plan": plan,
            "template": template,
            "context": context,
            "auth_context": auth_context
        }

        result = await service.run_step(params)

        self.assertEqual(result.output["finalText"], "success")
        self.assertEqual(result.step_report.diagnostics.failure_class, "none")

        req = mock_urlopen.call_args[0][0]
        headers = {k.lower(): v for k, v in req.headers.items()}
        self.assertIn("x-jeanbot-auth-context", headers)

        decoded_auth = json.loads(base64.b64decode(headers["x-jeanbot-auth-context"]).decode())
        self.assertEqual(decoded_auth, auth_context)

if __name__ == "__main__":
    unittest.main()
