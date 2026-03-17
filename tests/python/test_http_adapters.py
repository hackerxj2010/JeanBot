from __future__ import annotations

import json
import unittest
from unittest.mock import MagicMock, patch
from src.cognitive.adapters import (
    HttpAuditService,
    HttpMemoryService,
    HttpFileService,
    HttpRuntimeService,
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
        self.api_url = "http://localhost:8080/api"
        self.internal_token = "test-token"
        self.auth_context = {"userId": "user-1", "workspaceIds": ["ws-1"]}

    @patch("urllib.request.urlopen")
    @patch("urllib.request.Request")
    async def test_http_audit_service_record(self, mock_request, mock_urlopen):
        service = HttpAuditService(
            api_url=self.api_url,
            internal_token=self.internal_token,
            auth_context=self.auth_context,
        )

        mock_response = MagicMock()
        mock_response.read.return_value = b"{}"
        mock_urlopen.return_value.__enter__.return_value = mock_response

        await service.record("test.event", "entity-1", "actor-1", {"key": "value"})

        mock_request.assert_called_once()
        args, kwargs = mock_request.call_args
        self.assertEqual(args[0], f"{self.api_url}/internal/audit")
        self.assertEqual(kwargs["method"], "POST")

        payload = json.loads(kwargs["data"].decode("utf-8"))
        self.assertEqual(payload["kind"], "test.event")
        self.assertEqual(payload["entityId"], "entity-1")

        self.assertIn("x-jeanbot-internal-token", kwargs["headers"])
        self.assertIn("x-jeanbot-auth-context", kwargs["headers"])

    @patch("urllib.request.urlopen")
    @patch("urllib.request.Request")
    async def test_http_memory_service_remember(self, mock_request, mock_urlopen):
        service = HttpMemoryService(
            api_url=self.api_url,
            internal_token=self.internal_token,
            auth_context=self.auth_context,
        )

        mock_response = MagicMock()
        mock_response.read.return_value = b"{}"
        mock_urlopen.return_value.__enter__.return_value = mock_response

        await service.remember("ws-1", "some text", ["tag1"], "long-term", 0.9)

        mock_request.assert_called_once()
        self.assertEqual(mock_request.call_args[0][0], f"{self.api_url}/internal/memory/workspaces/ws-1/remember")

        payload = json.loads(mock_request.call_args[1]["data"].decode("utf-8"))
        self.assertEqual(payload["text"], "some text")
        self.assertEqual(payload["scope"], "long-term")

    @patch("urllib.request.urlopen")
    @patch("urllib.request.Request")
    async def test_http_file_service_write_artifact(self, mock_request, mock_urlopen):
        service = HttpFileService(
            api_url=self.api_url,
            internal_token=self.internal_token,
            auth_context=self.auth_context,
        )

        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"payload": {"absolutePath": "/abs/path/art.md"}}).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_response

        path = await service.write_artifact("root", "mission-1", "art.md", "content")

        self.assertEqual(path, "/abs/path/art.md")
        mock_request.assert_called_once()
        payload = json.loads(mock_request.call_args[1]["data"].decode("utf-8"))
        self.assertEqual(payload["toolId"], "filesystem.artifact.write")
        self.assertEqual(payload["payload"]["content"], "content")

    @patch("urllib.request.urlopen")
    @patch("urllib.request.Request")
    async def test_http_runtime_service_execute_task(self, mock_request, mock_urlopen):
        service = HttpRuntimeService(
            api_url=self.api_url,
            internal_token=self.internal_token,
            auth_context=self.auth_context,
        )

        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"status": "completed"}).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_response

        result = service.execute_task({"some": "request"})

        self.assertEqual(result["status"], "completed")
        mock_request.assert_called_once_with(
            f"{self.api_url}/internal/runtime/execute",
            data=json.dumps({"some": "request"}).encode("utf-8"),
            headers=service._headers(),
            method="POST"
        )

if __name__ == "__main__":
    unittest.main()
