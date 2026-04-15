import unittest
from unittest.mock import MagicMock, patch
from src.cognitive.adapters import (
    HttpRuntimeService,
    HttpAuditService,
    HttpMemoryService,
    HttpFileService,
    HttpBrowserService,
    HttpTerminalService,
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
        self.token = "test-token"
        self.runtime = HttpRuntimeService(api_url=self.api_url, token=self.token)

    @patch("src.cognitive.adapters.httpx.AsyncClient.post")
    async def test_runtime_execute_task(self, mock_post):
        mock_response = MagicMock()
        mock_response.json.return_value = {"ok": True, "finalText": "test output"}
        mock_response.raise_for_status = MagicMock()
        mock_post.return_value = mock_response

        res = await self.runtime.execute_task({"test": "payload"})
        self.assertTrue(res["ok"])
        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        self.assertEqual(args[0], f"{self.api_url}/internal/runtime/execute")
        self.assertEqual(kwargs["json"], {"test": "payload"})

    @patch("src.cognitive.adapters.httpx.AsyncClient.post")
    async def test_audit_record(self, mock_post):
        mock_response = MagicMock()
        mock_response.json.return_value = {"ok": True}
        mock_post.return_value = mock_response

        audit = HttpAuditService(api_url=self.api_url, token=self.token)
        await audit.record("test_event", "entity_1", "test_service", {"foo": "bar"})

        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        self.assertEqual(args[0], f"{self.api_url}/api/audit/record")
        self.assertEqual(kwargs["json"]["kind"], "test_event")

    @patch("src.cognitive.adapters.httpx.AsyncClient.post")
    async def test_memory_remember(self, mock_post):
        mock_response = MagicMock()
        mock_response.json.return_value = {"ok": True}
        mock_post.return_value = mock_response

        memory = HttpMemoryService(api_url=self.api_url, token=self.token)
        await memory.remember("ws_1", "some text", ["tag1"], "session", 0.9)

        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        self.assertEqual(args[0], f"{self.api_url}/api/memory/remember")
        self.assertEqual(kwargs["json"]["workspaceId"], "ws_1")

    @patch("src.cognitive.adapters.httpx.AsyncClient.post")
    async def test_file_write_artifact(self, mock_post):
        mock_response = MagicMock()
        mock_response.json.return_value = {"path": "/tmp/artifact.md"}
        mock_post.return_value = mock_response

        file_svc = HttpFileService(api_url=self.api_url, token=self.token)
        path = await file_svc.write_artifact("root", "mission_1", "test.md", "content")

        self.assertEqual(path, "/tmp/artifact.md")
        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        self.assertEqual(kwargs["json"]["toolId"], "filesystem.artifact.write")

    @patch("src.cognitive.adapters.httpx.AsyncClient.post")
    async def test_browser_navigate(self, mock_post):
        mock_response = MagicMock()
        mock_response.json.return_value = {"sessionId": "session_1"}
        mock_post.return_value = mock_response

        browser = HttpBrowserService(api_url=self.api_url, token=self.token)
        res = await browser.navigate("ws_1", "https://example.com")

        self.assertEqual(res["sessionId"], "session_1")
        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        self.assertEqual(args[0], f"{self.api_url}/api/browser/navigate")

    @patch("src.cognitive.adapters.httpx.AsyncClient.post")
    async def test_terminal_run(self, mock_post):
        mock_response = MagicMock()
        mock_response.json.return_value = {"output": "hello"}
        mock_post.return_value = mock_response

        terminal = HttpTerminalService(api_url=self.api_url, token=self.token)
        res = await terminal.run("ws_1", "echo hello")

        self.assertEqual(res["output"], "hello")
        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        self.assertEqual(args[0], f"{self.api_url}/api/terminal/run")

    @patch("src.cognitive.adapters.httpx.AsyncClient.post")
    async def test_subagent_run_step(self, mock_post):
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "finalText": "step completed",
            "toolCalls": [],
            "verification": {"ok": True, "reason": "success"},
        }
        mock_post.return_value = mock_response

        subagent_svc = HttpSubAgentService(runtime=self.runtime)

        objective = MissionObjective("id_1", "title_1", "objective_1", "ws_1")
        step = MissionStep("step_1", "title_s1", "desc_s1", "research")
        plan = MissionPlan(1, [step])
        template = SubAgentTemplate("research", "strategist")
        context = ExecutionContext("root")

        res = await subagent_svc.run_step({
            "mission_id": "mission_1",
            "objective": objective,
            "plan": plan,
            "step": step,
            "template": template,
            "context": context,
            "attempt": 1,
        })

        self.assertEqual(res.step_report.summary, "step completed")
        self.assertEqual(res.run["status"], "completed")
        mock_post.assert_called_once()


if __name__ == "__main__":
    unittest.main()
