from __future__ import annotations

import json
import unittest
from unittest.mock import MagicMock, patch
from src.cognitive.adapters import (
    HttpAuditService,
    HttpMemoryService,
    HttpRuntimeService,
    HttpSubAgentService,
    HttpPolicyService,
)
from src.cognitive.executor import (
    MissionObjective,
    MissionStep,
    MissionPlan,
    SubAgentTemplate,
    ExecutionContext,
)


class HttpAdaptersTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.api_url = "http://test-api"
        self.token = "test-token"
        self.auth_context = {"user": "test-user"}

    @patch("urllib.request.urlopen")
    async def test_http_audit_service_record(self, mock_urlopen):
        # Setup mock response
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({"ok": True}).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        service = HttpAuditService(api_url=self.api_url, token=self.token)
        await service.record("test.event", "entity-1", "test-service", {"foo": "bar"})

        # Verify request
        mock_urlopen.assert_called_once()
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.full_url, f"{self.api_url}/internal/audit")
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(req.headers["X-jeanbot-internal-token"], self.token)

        payload = json.loads(req.data.decode("utf-8"))
        self.assertEqual(payload["event"], "test.event")
        self.assertEqual(payload["entityId"], "entity-1")

    @patch("urllib.request.urlopen")
    async def test_http_memory_service_remember(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({"ok": True}).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        service = HttpMemoryService(api_url=self.api_url, token=self.token)
        await service.remember("ws-1", "test text", ["tag1"], "session", 0.9)

        mock_urlopen.assert_called_once()
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.full_url, f"{self.api_url}/internal/memory/workspaces/ws-1/remember")

        payload = json.loads(req.data.decode("utf-8"))
        self.assertEqual(payload["text"], "test text")
        self.assertEqual(payload["importance"], 0.9)

    @patch("urllib.request.urlopen")
    async def test_http_runtime_service_execute(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({"status": "completed"}).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        service = HttpRuntimeService(api_url=self.api_url, token=self.token)
        result = await service.execute_task({"task": "do something"})

        self.assertEqual(result["status"], "completed")
        mock_urlopen.assert_called_once()
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.full_url, f"{self.api_url}/internal/runtime/execute")

    @patch("urllib.request.urlopen")
    async def test_http_sub_agent_service_run_step(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({
            "summary": "Step completed",
            "diagnostics": {"overallScore": 0.95},
            "run": {"id": "run-1"},
            "output": {"finalText": "Done"},
            "memoryText": "Memory updated"
        }).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        service = HttpSubAgentService(api_url=self.api_url, token=self.token)

        objective = MissionObjective(id="m-1", title="M", objective="O", workspace_id="ws-1")
        step = MissionStep(id="s-1", title="S", description="D", capability="res")
        template = SubAgentTemplate(specialization="res", role="r", provider="p", model="m")

        params = {
            "mission_id": "m-1",
            "objective": objective,
            "step": step,
            "template": template,
            "auth_context": self.auth_context
        }

        result = await service.run_step(params)

        self.assertEqual(result.step_report.summary, "Step completed")
        self.assertEqual(result.step_report.diagnostics.overall_score, 0.95)
        self.assertEqual(result.run["id"], "run-1")

        mock_urlopen.assert_called_once()
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.full_url, f"{self.api_url}/api/runtime/execute")
        self.assertIn("X-jeanbot-auth-context", req.headers)

    @patch("urllib.request.urlopen")
    async def test_http_policy_service_evaluate(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({
            "approvalRequired": True,
            "risk": "high"
        }).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        service = HttpPolicyService(api_url=self.api_url, token=self.token)
        decision = await service.evaluate_mission({"objective": "danger"})

        self.assertTrue(decision.approval_required)
        self.assertEqual(decision.risk, "high")
        mock_urlopen.assert_called_once()
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.full_url, f"{self.api_url}/internal/policy/evaluate")


if __name__ == "__main__":
    unittest.main()
