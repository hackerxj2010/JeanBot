import unittest
import asyncio
from unittest.mock import patch, MagicMock
from src.cognitive.adapters import (
    HttpAuditService,
    HttpMemoryService,
    HttpFileService,
    HttpPolicyService,
    HttpBrowserService,
    HttpTerminalService,
    HttpSubAgentService,
    HttpRuntimeService
)
from src.cognitive.executor import MissionObjective, MissionStep, MissionPlan, SubAgentTemplate, ExecutionContext

class TestHttpAdapters(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.api_url = "http://test-api"
        self.token = "test-token"

    @patch("httpx.AsyncClient.post")
    async def test_http_audit_service(self, mock_post):
        mock_post.return_value = MagicMock(status_code=200)
        mock_post.return_value.json.return_value = {"status": "ok"}

        service = HttpAuditService(api_url=self.api_url, token=self.token)
        await service.record("test.event", "entity-1", "test-service", {"foo": "bar"})

        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        self.assertEqual(kwargs["json"]["kind"], "test.event")
        self.assertEqual(kwargs["json"]["entityId"], "entity-1")

    @patch("httpx.AsyncClient.post")
    async def test_http_memory_service(self, mock_post):
        mock_post.return_value = MagicMock(status_code=200)
        mock_post.return_value.json.return_value = {"status": "ok"}

        service = HttpMemoryService(api_url=self.api_url, token=self.token)
        await service.remember("ws-1", "some text", ["tag1"], "session", 0.9)

        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        self.assertEqual(kwargs["json"]["workspaceId"], "ws-1")
        self.assertEqual(kwargs["json"]["text"], "some text")

    @patch("httpx.AsyncClient.post")
    async def test_http_file_service(self, mock_post):
        mock_post.return_value = MagicMock(status_code=200)
        mock_post.return_value.json.return_value = {"path": "artifacts/m1/f1.txt"}

        service = HttpFileService(api_url=self.api_url, token=self.token)
        path = await service.write_artifact("root", "m1", "f1.txt", "content")

        self.assertEqual(path, "artifacts/m1/f1.txt")
        mock_post.assert_called_once()

    @patch("httpx.AsyncClient.post")
    async def test_http_browser_service(self, mock_post):
        mock_post.return_value = MagicMock(status_code=200)
        mock_post.return_value.json.return_value = {"status": "navigated"}

        service = HttpBrowserService(api_url=self.api_url, token=self.token)
        result = await service.navigate("https://example.com")

        self.assertEqual(result["status"], "navigated")
        mock_post.assert_called_once()

    @patch("httpx.AsyncClient.post")
    async def test_http_terminal_service(self, mock_post):
        mock_post.return_value = MagicMock(status_code=200)
        mock_post.return_value.json.return_value = {"stdout": "hello"}

        service = HttpTerminalService(api_url=self.api_url, token=self.token)
        result = await service.run("echo hello")

        self.assertEqual(result["stdout"], "hello")
        mock_post.assert_called_once()

    @patch("httpx.AsyncClient.post")
    async def test_http_sub_agent_service(self, mock_post):
        mock_post.return_value = MagicMock(status_code=200)
        mock_post.return_value.json.return_value = {
            "finalText": "done",
            "toolCalls": [],
            "verification": {"ok": True, "reason": "success"}
        }

        runtime = HttpRuntimeService(api_url=self.api_url, token=self.token)
        service = HttpSubAgentService(api_url=self.api_url, token=self.token, runtime=runtime)

        objective = MissionObjective("m1", "title", "obj", "ws1")
        step = MissionStep("s1", "title", "desc", "research")
        plan = MissionPlan(1, [step])
        template = SubAgentTemplate("research", "strategist")
        context = ExecutionContext("root")

        result = await service.run_step({
            "mission_id": "m1",
            "objective": objective,
            "plan": plan,
            "step": step,
            "template": template,
            "context": context
        })

        self.assertEqual(result.output["finalText"], "done")
        self.assertTrue(result.output["verification"]["passed"])

if __name__ == "__main__":
    unittest.main()
