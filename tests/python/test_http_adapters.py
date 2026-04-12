from __future__ import annotations

import json
import unittest
from unittest.mock import MagicMock, patch

from src.cognitive.adapters import (
    HttpAuditService,
    HttpBrowserService,
    HttpFileService,
    HttpMemoryService,
    HttpPolicyService,
    HttpRuntimeService,
    HttpSubAgentService,
    HttpTerminalService,
)
from src.cognitive.executor import (
    ExecutionContext,
    MissionObjective,
    MissionPlan,
    MissionStep,
    SubAgentTemplate,
)


class HttpAdapterTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.api_url = "http://test-api"
        self.token = "test-token"
        self.auth_context = {"userId": "user-1", "workspaceIds": ["ws-1"]}

    @patch("urllib.request.urlopen")
    async def test_http_audit_service_record(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"ok": True}).encode("utf-8")
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpAuditService(api_url=self.api_url, internal_token=self.token)
        await service.record("test.event", "entity-1", "test-service", {"foo": "bar"})

        self.assertTrue(mock_urlopen.called)
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_full_url(), f"{self.api_url}/api/audit")
        self.assertEqual(req.get_header("X-jeanbot-internal-token"), self.token)

        payload = json.loads(req.data.decode("utf-8"))
        self.assertEqual(payload["kind"], "test.event")
        self.assertEqual(payload["entityId"], "entity-1")

    @patch("urllib.request.urlopen")
    async def test_http_memory_service_remember(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"id": "mem-1"}).encode("utf-8")
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpMemoryService(api_url=self.api_url, internal_token=self.token)
        await service.remember("ws-1", "test text", ["tag1"], "long-term", 0.9)

        self.assertTrue(mock_urlopen.called)
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_full_url(), f"{self.api_url}/api/workspaces/ws-1/memory")

        payload = json.loads(req.data.decode("utf-8"))
        self.assertEqual(payload["text"], "test text")
        self.assertEqual(payload["scope"], "long-term")

    @patch("urllib.request.urlopen")
    async def test_http_runtime_service_execute(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"finalText": "done"}).encode("utf-8")
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpRuntimeService(api_url=self.api_url, internal_token=self.token)
        request = {"objective": {"id": "m1"}, "authContext": self.auth_context}
        result = service.execute_task(request)

        self.assertEqual(result["finalText"], "done")
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_full_url(), f"{self.api_url}/api/runtime/execute")
        self.assertIsNotNone(req.get_header("X-jeanbot-auth-context"))

    @patch("urllib.request.urlopen")
    async def test_http_subagent_service_run_step(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"finalText": "step done", "id": "r1"}).encode(
            "utf-8"
        )
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpSubAgentService(api_url=self.api_url, internal_token=self.token)
        objective = MissionObjective(id="m1", title="T", objective="O", workspace_id="ws-1")
        step = MissionStep(id="s1", title="S", description="D", capability="research")

        params = {"objective": objective, "step": step, "auth_context": self.auth_context}
        result = await service.run_step(params)

        self.assertEqual(result.step_report.summary, "step done")
        self.assertEqual(result.run["id"], "r1")

        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_full_url(), f"{self.api_url}/api/runtime/execute")

    @patch("urllib.request.urlopen")
    async def test_http_browser_service_navigate(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"sessionId": "s1"}).encode("utf-8")
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpBrowserService(api_url=self.api_url, internal_token=self.token)
        result = await service.navigate("ws-1", "http://example.com")

        self.assertEqual(result["sessionId"], "s1")
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_full_url(), f"{self.api_url}/api/browser/navigate")

    @patch("urllib.request.urlopen")
    async def test_http_terminal_service_run(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"stdout": "ok"}).encode("utf-8")
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpTerminalService(api_url=self.api_url, internal_token=self.token)
        result = await service.run("ws-1", "ls", "/app")

        self.assertEqual(result["stdout"], "ok")
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_full_url(), f"{self.api_url}/api/terminal/run")

    @patch("urllib.request.urlopen")
    async def test_http_file_service_write_artifact(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"payload": {"path": "/tmp/art.md"}}).encode(
            "utf-8"
        )
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        service = HttpFileService(api_url=self.api_url, internal_token=self.token)
        path = await service.write_artifact("ws-1", "m1", "art.md", "content")

        self.assertEqual(path, "/tmp/art.md")
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_full_url(), f"{self.api_url}/api/tools/execute")


if __name__ == "__main__":
    unittest.main()
