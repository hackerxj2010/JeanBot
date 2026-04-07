import json
import unittest
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError
import io

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
        self.api_url = "http://localhost:8080"
        self.internal_token = "test-token"
        self.auth_context = {"userId": "user-1"}

    @patch("urllib.request.urlopen")
    async def test_http_audit_service_record(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = b'{"ok": true}'
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpAuditService(
            api_url=self.api_url,
            internal_token=self.internal_token,
            auth_context=self.auth_context,
        )
        await service.record("test.event", "entity-1", "test-service", {"foo": "bar"})

        self.assertTrue(mock_urlopen.called)
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_full_url(), f"{self.api_url}/internal/audit")
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(req.headers["X-jeanbot-internal-token"], self.internal_token)
        self.assertIn("X-jeanbot-auth-context", req.headers)

    @patch("urllib.request.urlopen")
    async def test_http_memory_service_remember(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = b'{"ok": true}'
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpMemoryService(
            api_url=self.api_url,
            internal_token=self.internal_token,
            auth_context=self.auth_context,
        )
        await service.remember("ws-1", "test text", ["tag1"], "session", 0.9)

        self.assertTrue(mock_urlopen.called)
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(
            req.get_full_url(), f"{self.api_url}/internal/memory/workspaces/ws-1/remember"
        )

    @patch("urllib.request.urlopen")
    async def test_http_agent_runtime_service_execute(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = b'{"status": "completed"}'
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpAgentRuntimeService(
            api_url=self.api_url,
            internal_token=self.internal_token,
            auth_context=self.auth_context,
        )
        result = await service.execute_task({"objective": "test"})

        self.assertEqual(result["status"], "completed")
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_full_url(), f"{self.api_url}/internal/runtime/execute")

    @patch("urllib.request.urlopen")
    async def test_http_sub_agent_service_run_step(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "run": {"id": "run-1"},
            "output": {"finalText": "done"},
            "summary": "step done"
        }).encode()
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpSubAgentService(
            api_url=self.api_url,
            internal_token=self.internal_token,
            auth_context=self.auth_context,
        )

        objective = MissionObjective(id="m-1", title="M1", objective="Obj", workspace_id="ws-1")
        step = MissionStep(id="s-1", title="S1", description="D1", capability="research")
        template = SubAgentTemplate(specialization="research", role="researcher")
        context = ExecutionContext(workspace_root="/tmp")

        result = await service.run_step({
            "objective": objective,
            "step": step,
            "template": template,
            "context": context
        })

        self.assertEqual(result.run["id"], "run-1")
        self.assertEqual(result.output["finalText"], "done")
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_full_url(), f"{self.api_url}/api/runtime/execute")

    @patch("urllib.request.urlopen")
    async def test_http_error_handling(self, mock_urlopen):
        # Create a mock HTTPError
        fp = io.BytesIO(b'{"error": "something went wrong"}')
        mock_urlopen.side_effect = HTTPError(
            url=f"{self.api_url}/internal/audit",
            code=400,
            msg="Bad Request",
            hdrs={},
            fp=fp
        )

        service = HttpAuditService(
            api_url=self.api_url,
            internal_token=self.internal_token,
        )

        with self.assertRaises(RuntimeError) as cm:
            await service.record("event", "id", "service", {})

        self.assertIn("HTTP Error 400: something went wrong", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
