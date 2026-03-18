from __future__ import annotations

import json
import unittest
from unittest.mock import MagicMock, patch

from src.cognitive.adapters import (
    HttpAuditService,
    HttpMemoryService,
    HttpFileService,
    HttpPolicyService,
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


class MockResponse:
    def __init__(self, data, status=200):
        self.data = data
        self.status = status

    def read(self):
        return json.dumps(self.data).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


class HttpAdapterTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.api_url = "http://test-api"
        self.token = "test-token"
        self.auth_context = {"userId": "user-1"}

    @patch("urllib.request.urlopen")
    async def test_http_audit_service(self, mock_urlopen):
        mock_urlopen.return_value = MockResponse({"ok": True})
        service = HttpAuditService(api_url=self.api_url, internal_token=self.token)

        await service.record("test.event", "entity-1", "test-service", {"foo": "bar"})

        mock_urlopen.assert_called_once()
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_full_url(), "http://test-api/internal/audit/record")
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(req.headers["X-jeanbot-internal-token"], self.token)

    @patch("urllib.request.urlopen")
    async def test_http_memory_service_remember(self, mock_urlopen):
        mock_urlopen.return_value = MockResponse({"id": "mem-1"})
        service = HttpMemoryService(api_url=self.api_url, internal_token=self.token)

        await service.remember("ws-1", "some text", ["tag1"], "long-term", 0.9)

        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_full_url(), "http://test-api/internal/memory/workspaces/ws-1/remember")
        body = json.loads(req.data.decode("utf-8"))
        self.assertEqual(body["text"], "some text")
        self.assertEqual(body["scope"], "long-term")

    @patch("urllib.request.urlopen")
    async def test_http_memory_service_search(self, mock_urlopen):
        mock_urlopen.return_value = MockResponse({
            "results": [
                {
                    "text": "found text",
                    "tags": ["t1"],
                    "importance": 0.8,
                    "metadata": {"scope": "session"}
                }
            ]
        })
        service = HttpMemoryService(api_url=self.api_url, internal_token=self.token)

        results = await service.search("ws-1", "query")

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].text, "found text")
        self.assertEqual(results[0].memory_type, "session")

    @patch("urllib.request.urlopen")
    async def test_http_file_service_artifact(self, mock_urlopen):
        mock_urlopen.return_value = MockResponse({"path": "/path/to/artifact"})
        service = HttpFileService(api_url=self.api_url, internal_token=self.token)

        path = await service.write_artifact("root", "mission-1", "file.txt", "content")

        self.assertEqual(path, "/path/to/artifact")
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_full_url(), "http://test-api/internal/files/artifact")

    @patch("urllib.request.urlopen")
    async def test_http_policy_service(self, mock_urlopen):
        mock_urlopen.return_value = MockResponse({
            "approvalRequired": True,
            "risk": "high"
        })
        service = HttpPolicyService(api_url=self.api_url, internal_token=self.token)

        decision = service.evaluate_mission({"objective": "danger"})

        self.assertTrue(decision.approval_required)
        self.assertEqual(decision.risk, "high")

    @patch("urllib.request.urlopen")
    async def test_http_runtime_service(self, mock_urlopen):
        mock_urlopen.return_value = MockResponse({"finalText": "done"})
        service = HttpRuntimeService(api_url=self.api_url, internal_token=self.token)

        res = await service.execute_task({"request": "execute"})

        self.assertEqual(res["finalText"], "done")
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_full_url(), "http://test-api/internal/runtime/execute")

    @patch("urllib.request.urlopen")
    async def test_http_subagent_service_spawn(self, mock_urlopen):
        mock_urlopen.return_value = MockResponse([
            {
                "specialization": "research",
                "role": "researcher",
                "provider": "anthropic",
                "model": "claude",
                "toolIds": ["search"],
                "maxParallelTasks": 2
            }
        ])
        service = HttpSubAgentService(api_url=self.api_url, internal_token=self.token)

        plan = MissionPlan(steps=[MissionStep(id="s1", title="T", description="D", capability="research")])
        templates = service.spawn_for_plan(plan)

        self.assertEqual(len(templates), 1)
        self.assertEqual(templates[0].specialization, "research")
        self.assertEqual(templates[0].role, "researcher")

    @patch("urllib.request.urlopen")
    async def test_http_subagent_service_run(self, mock_urlopen):
        mock_urlopen.return_value = MockResponse({
            "stepReport": {
                "stepId": "s1",
                "startedAt": "now",
                "attempts": 1,
                "summary": "ok",
                "diagnostics": {
                    "overallScore": 1.0,
                    "evidenceScore": 1.0,
                    "coverageScore": 1.0,
                    "verificationScore": 1.0,
                    "failureClass": "none",
                    "retryable": False,
                    "escalationRequired": False,
                    "missingSignals": [],
                    "recommendedActions": []
                }
            },
            "run": {"id": "r1"},
            "output": {"finalText": "done"},
            "memory_text": "mem"
        })
        service = HttpSubAgentService(api_url=self.api_url, internal_token=self.token)

        objective = MissionObjective(id="m1", title="T", objective="O", workspace_id="w1")
        step = MissionStep(id="s1", title="T", description="D", capability="research")
        template = SubAgentTemplate(specialization="research", role="researcher")
        context = ExecutionContext(workspace_root=".")

        result = await service.run_step({
            "mission_id": "m1",
            "objective": objective,
            "plan": MissionPlan(steps=[step]),
            "step": step,
            "template": template,
            "context": context
        })

        self.assertEqual(result.step_report.summary, "ok")
        self.assertEqual(result.run["id"], "r1")


if __name__ == "__main__":
    unittest.main()
