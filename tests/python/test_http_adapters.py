import unittest
import json
import os
import base64
from unittest.mock import MagicMock, patch
from src.cognitive.adapters import (
    HttpBaseService,
    HttpRuntimeService,
    HttpSubAgentService,
    HttpBrowserService,
    HttpTerminalService,
    HttpFileService,
    HttpAuditService,
    HttpMemoryService,
    asdict_fallback
)
from src.cognitive.executor import (
    MissionObjective,
    MissionStep,
    MissionPlan,
    SubAgentTemplate,
    ExecutionContext,
    ActiveExecutionState,
    MissionRecord
)

class TestHttpAdapters(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.base_url = "http://api.test"
        self.token = "test-token"
        self.http_base = HttpBaseService(self.base_url, self.token)

    @patch("httpx.AsyncClient.post")
    async def test_http_base_post(self, mock_post):
        mock_response = MagicMock()
        mock_response.json.return_value = {"status": "ok"}
        mock_response.raise_for_status = MagicMock()
        mock_post.return_value = mock_response

        payload = {"data": "test"}
        auth_context = {"user": "jules"}
        result = await self.http_base.post("/test-path", "test-service", payload, auth_context=auth_context)

        self.assertEqual(result, {"status": "ok"})
        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        self.assertEqual(kwargs["json"], payload)
        headers = kwargs["headers"]
        self.assertEqual(headers["x-jeanbot-internal-service"], "test-service")
        self.assertEqual(headers["x-jeanbot-internal-token"], self.token)
        self.assertTrue("x-jeanbot-auth-context" in headers)

        auth_decoded = json.loads(base64.b64decode(headers["x-jeanbot-auth-context"]).decode())
        self.assertEqual(auth_decoded, auth_context)

    @patch("src.cognitive.adapters.HttpBaseService.post")
    async def test_http_runtime_service(self, mock_post):
        mock_post.return_value = {"finalText": "done", "toolCalls": []}
        runtime = HttpRuntimeService(http_base=self.http_base)

        result = await runtime.execute_task({"task": "test"})
        self.assertEqual(result["finalText"], "done")
        mock_post.assert_called_once_with("/internal/runtime/execute", "agent-orchestrator", {"task": "test"}, timeout=300.0)

    @patch("src.cognitive.adapters.HttpRuntimeService.execute_task")
    async def test_http_subagent_service_run_step(self, mock_execute):
        mock_execute.return_value = {
            "finalText": "step done",
            "toolCalls": [],
            "verification": {"ok": True, "reason": "verified"}
        }
        runtime = HttpRuntimeService(http_base=self.http_base)
        subagent = HttpSubAgentService(runtime=runtime)

        objective = MissionObjective(id="m1", title="T", objective="O", workspace_id="w1")
        step = MissionStep(id="s1", title="ST", description="SD", capability="research")
        plan = MissionPlan(steps=[step])
        template = SubAgentTemplate(specialization="research", role="researcher")
        context = ExecutionContext(workspace_root=".")

        params = {
            "mission_id": "m1",
            "objective": objective,
            "plan": plan,
            "step": step,
            "template": template,
            "context": context
        }

        result = await subagent.run_step(params)
        self.assertEqual(result.output["finalText"], "step done")
        self.assertTrue(result.step_report.diagnostics.overall_score > 0)

    @patch("src.cognitive.adapters.HttpBaseService.post")
    async def test_http_browser_service(self, mock_post):
        browser = HttpBrowserService(http_base=self.http_base)

        mock_post.return_value = {"ok": True}
        await browser.navigate("m1", "http://google.com")
        mock_post.assert_called_with("/api/browser/navigate", "browser-service", {"missionId": "m1", "url": "http://google.com"})

        mock_post.return_value = {"screenshotPath": "/tmp/s.png"}
        path = await browser.capture("m1")
        self.assertEqual(path, "/tmp/s.png")

    @patch("src.cognitive.adapters.HttpBaseService.post")
    async def test_http_terminal_service(self, mock_post):
        terminal = HttpTerminalService(http_base=self.http_base)
        mock_post.return_value = {"stdout": "hello"}

        result = await terminal.run("m1", "echo hello")
        self.assertEqual(result["stdout"], "hello")
        mock_post.assert_called_with("/api/terminal/run", "terminal-service", {"missionId": "m1", "command": "echo hello", "cwd": None})

    @patch("src.cognitive.adapters.HttpBaseService.post")
    async def test_http_file_service(self, mock_post):
        file_service = HttpFileService(http_base=self.http_base)

        mock_post.return_value = {"path": "/tmp/art.txt"}
        path = await file_service.write_artifact(".", "m1", "art.txt", "content")
        self.assertEqual(path, "/tmp/art.txt")

        mock_post.return_value = {"state": {"plan_version": 2}}
        state = await file_service.load_mission_state("m1")
        self.assertEqual(state["plan_version"], 2)

    def test_asdict_fallback(self):
        obj = MissionObjective(id="m1", title="T", objective="O", workspace_id="w1")
        d = asdict_fallback(obj)
        self.assertEqual(d["id"], "m1")

        from pathlib import Path
        p = Path("/tmp/test")
        self.assertEqual(asdict_fallback(p), "/tmp/test")

if __name__ == "__main__":
    unittest.main()
