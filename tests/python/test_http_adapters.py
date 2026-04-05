import unittest
from unittest.mock import MagicMock, patch
from src.cognitive.adapters import HttpAuditService, HttpMemoryService, HttpSubAgentService, HttpRuntimeService
from src.cognitive.executor import MissionObjective, MissionStep, MissionPlan, SubAgentTemplate, ExecutionContext

class TestHttpAdapters(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.api_url = "http://api.test"
        self.token = "test-token"
        self.auth_context = {"user": "test-user"}

    @patch("urllib.request.urlopen")
    async def test_http_audit_service_record(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.status = 204
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpAuditService(
            api_url=self.api_url,
            internal_token=self.token,
            service_name="test-service",
            auth_context=self.auth_context
        )

        await service.record("test.event", "entity-1", "src-service", {"foo": "bar"})

        mock_urlopen.assert_called_once()
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_full_url(), "http://api.test/internal/audit")
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(req.headers["X-jeanbot-internal-token"], self.token)

    @patch("urllib.request.urlopen")
    async def test_http_memory_service_remember(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.status = 204
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpMemoryService(
            api_url=self.api_url,
            internal_token=self.token,
            service_name="test-service"
        )

        await service.remember("ws-1", "some text", ["tag1"], "session", 0.9)

        mock_urlopen.assert_called_once()
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_full_url(), "http://api.test/internal/memory/workspaces/ws-1/remember")

    @patch("urllib.request.urlopen")
    async def test_http_runtime_service_execute(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.read.return_value = b'{"status": "ok"}'
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpRuntimeService(
            api_url=self.api_url,
            internal_token=self.token,
            service_name="test-service"
        )

        res = await service.execute_task({"task": "do something"})
        self.assertEqual(res["status"], "ok")

    @patch("urllib.request.urlopen")
    async def test_http_subagent_service_run_step(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.read.return_value = b'{"startedAt": "now", "attempts": 1, "summary": "done", "diagnostics": {"overall_score": 1.0}, "run": {}, "output": {}, "memoryText": "mem"}'
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpSubAgentService(
            api_url=self.api_url,
            internal_token=self.token,
            service_name="test-service"
        )

        step = MissionStep(id="s1", title="T", description="D", capability="C")
        params = {"step": step}

        res = await service.run_step(params)
        self.assertEqual(res.step_report.step_id, "s1")
        self.assertEqual(res.memory_text, "mem")
