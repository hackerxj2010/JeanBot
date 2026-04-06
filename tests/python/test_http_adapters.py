from __future__ import annotations

import json
import unittest
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError
from io import BytesIO

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
        self.auth_context = {"userId": "user-1"}

    @patch("urllib.request.urlopen")
    async def test_http_audit_service_record(self, mock_urlopen):
        # Setup mock response
        mock_response = MagicMock()
        mock_response.read.return_value = b'{"ok": true}'
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpAuditService(self.api_url, self.internal_token)
        await service.record("test.event", "entity-1", "test-service", {"foo": "bar"})

        # Verify call
        args, kwargs = mock_urlopen.call_args
        req = args[0]
        self.assertEqual(req.get_full_url(), "http://api.test/internal/audit")
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(req.headers["X-jeanbot-internal-token"], "test-token")

        body = json.loads(req.data.decode())
        self.assertEqual(body["event"], "test.event")
        self.assertEqual(body["entityId"], "entity-1")

    @patch("urllib.request.urlopen")
    async def test_http_memory_service_remember(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = b'{"ok": true}'
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpMemoryService(self.api_url, self.internal_token)
        await service.remember("ws-1", "some text", ["tag1"], "long-term", 0.9)

        args, kwargs = mock_urlopen.call_args
        req = args[0]
        self.assertEqual(req.get_full_url(), "http://api.test/internal/memory/workspaces/ws-1/remember")

        body = json.loads(req.data.decode())
        self.assertEqual(body["text"], "some text")
        self.assertEqual(body["importance"], 0.9)

    @patch("urllib.request.urlopen")
    async def test_http_runtime_service_execute(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = b'{"status": "completed"}'
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpRuntimeService(self.api_url, self.internal_token)
        res = await service.execute_task({"task": "do something"})

        self.assertEqual(res["status"], "completed")
        args, kwargs = mock_urlopen.call_args
        req = args[0]
        self.assertEqual(req.get_full_url(), "http://api.test/internal/runtime/execute")

    @patch("urllib.request.urlopen")
    async def test_http_subagent_service_run_step(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = b'{"status": "completed", "verification_summary": "Done", "run": {"id": "run-1"}}'
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpSubAgentService(self.api_url, self.internal_token)

        objective = MissionObjective("m-1", "Title", "Objective", "ws-1")
        step = MissionStep("s-1", "Step Title", "Step Desc", "research")
        template = SubAgentTemplate("research", "researcher", "anthropic", "claude-3")

        params = {
            "objective": objective,
            "step": step,
            "template": template,
            "auth_context": self.auth_context
        }

        result = await service.run_step(params)

        self.assertEqual(result.run["id"], "run-1")
        self.assertEqual(result.step_report.summary, "Done")

        args, kwargs = mock_urlopen.call_args
        req = args[0]
        self.assertEqual(req.get_full_url(), "http://api.test/api/runtime/execute")
        self.assertIn("X-jeanbot-auth-context", req.headers)

    @patch("urllib.request.urlopen")
    async def test_http_error_handling(self, mock_urlopen):
        # Setup mock for HTTPError
        mock_urlopen.side_effect = HTTPError(
            "http://api.test/fail", 400, "Bad Request", {}, BytesIO(b'{"error": "specific error"}')
        )

        service = HttpAuditService(self.api_url, self.internal_token)
        with self.assertRaisesRegex(RuntimeError, "specific error"):
            await service.record("event", "id", "svc", {})

if __name__ == "__main__":
    unittest.main()
