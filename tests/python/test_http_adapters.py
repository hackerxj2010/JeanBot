import unittest
import urllib.error
from unittest.mock import patch, MagicMock
import json
import base64
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
        self.auth_token = "test-token"
        self.auth_context = {"user_id": "user-123"}
        self.service_name = "test-service"

    @patch("urllib.request.urlopen")
    async def test_http_audit_service_record(self, mock_urlopen):
        # Mock response
        mock_response = MagicMock()
        mock_response.read.return_value = b"{}"
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpAuditService(
            api_url=self.api_url,
            auth_token=self.auth_token,
            service_name=self.service_name,
            auth_context=self.auth_context,
        )

        await service.record("test.event", "entity-1", "src-service", {"foo": "bar"})

        # Verify request
        args, _ = mock_urlopen.call_args
        request = args[0]
        self.assertEqual(request.get_full_url(), f"{self.api_url}/internal/audit")
        self.assertEqual(request.get_method(), "POST")

        # Verify headers
        self.assertEqual(request.get_header("Content-type"), "application/json")
        self.assertEqual(request.get_header("X-jeanbot-internal-service"), self.service_name)
        self.assertEqual(request.get_header("X-jeanbot-internal-token"), self.auth_token)

        auth_context_header = request.get_header("X-jeanbot-auth-context")
        decoded_context = json.loads(base64.b64decode(auth_context_header).decode())
        self.assertEqual(decoded_context, self.auth_context)

        # Verify body
        body = json.loads(request.data.decode())
        self.assertEqual(body["event"], "test.event")
        self.assertEqual(body["entityId"], "entity-1")
        self.assertEqual(body["service"], "src-service")
        self.assertEqual(body["data"], {"foo": "bar"})

    @patch("urllib.request.urlopen")
    async def test_http_memory_service_remember(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = b"{}"
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpMemoryService(
            api_url=self.api_url,
            auth_token=self.auth_token,
            service_name=self.service_name,
        )

        await service.remember("ws-1", "some text", ["tag1"], "session", 0.9)

        args, _ = mock_urlopen.call_args
        request = args[0]
        self.assertEqual(request.get_full_url(), f"{self.api_url}/internal/memory/workspaces/ws-1/remember")

        body = json.loads(request.data.decode())
        self.assertEqual(body["text"], "some text")
        self.assertEqual(body["tags"], ["tag1"])
        self.assertEqual(body["memoryType"], "session")
        self.assertEqual(body["importance"], 0.9)

    @patch("urllib.request.urlopen")
    def test_http_runtime_service_prepare_frame(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"frame": "data"}).encode()
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpRuntimeService(
            api_url=self.api_url,
            auth_token=self.auth_token,
            service_name=self.service_name,
        )

        objective = MissionObjective(id="m1", title="T1", objective="O1", workspace_id="w1")
        step = MissionStep(id="s1", title="S1", description="D1", capability="C1")
        plan = MissionPlan(version=1, steps=[step])
        template = SubAgentTemplate(specialization="C1", role="R1")
        context = ExecutionContext(workspace_root="/tmp")

        res = service.prepare_frame(objective, step, plan, template, context)

        self.assertEqual(res, {"frame": "data"})
        args, _ = mock_urlopen.call_args
        request = args[0]
        self.assertEqual(request.get_full_url(), f"{self.api_url}/internal/runtime/frame")

    @patch("urllib.request.urlopen")
    async def test_http_subagent_service_run_step(self, mock_urlopen):
        mock_response = MagicMock()
        response_data = {
            "step_report": {
                "step_id": "s1",
                "started_at": "now",
                "attempts": 1,
                "summary": "done",
                "diagnostics": {"overall_score": 1.0}
            },
            "run": {"id": "r1"},
            "output": {"finalText": "out"},
            "memory_text": "mem"
        }
        mock_response.read.return_value = json.dumps(response_data).encode()
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpSubAgentService(
            api_url=self.api_url,
            auth_token=self.auth_token,
            service_name=self.service_name,
        )

        res = await service.run_step({"step_id": "s1"})

        self.assertEqual(res.step_report.step_id, "s1")
        self.assertEqual(res.memory_text, "mem")
        self.assertEqual(res.step_report.diagnostics.overall_score, 1.0)

    @patch("urllib.request.urlopen")
    async def test_http_service_error_handling(self, mock_urlopen):
        # Mock HTTP Error
        mock_error = urllib.error.HTTPError(
            url=f"{self.api_url}/foo",
            code=500,
            msg="Internal Server Error",
            hdrs={},
            fp=MagicMock()
        )
        mock_error.fp.read.return_value = json.dumps({"message": "Server exploded"}).encode()
        mock_urlopen.side_effect = mock_error

        service = HttpAuditService(
            api_url=self.api_url,
            auth_token=self.auth_token,
            service_name=self.service_name,
        )

        with self.assertRaisesRegex(RuntimeError, "HTTP 500 from test-service: Server exploded"):
            await service.record("event", "id", "svc", {})

if __name__ == "__main__":
    unittest.main()
