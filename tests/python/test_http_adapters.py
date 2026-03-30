from __future__ import annotations

import json
import os
import unittest
from unittest.mock import patch

from src.cognitive.service import MissionExecutorService
from src.cognitive.adapters import HttpAuditService, HttpPolicyService, LocalAuditService


class HttpAdapterSwitchingTests(unittest.IsolatedAsyncioTestCase):
    def test_instantiates_local_adapters_by_default(self):
        with patch.dict(os.environ, {"JEANBOT_SERVICE_MODE": "local"}):
            service = MissionExecutorService(workspace_root="/tmp")
            bundle = service.build_bundle({
                "workspace_id": "ws-1",
                "title": "Test",
                "objective": "Test",
            })
            self.assertIsInstance(bundle.audit_service, LocalAuditService)

    def test_instantiates_http_adapters_when_configured(self):
        with patch.dict(os.environ, {
            "JEANBOT_SERVICE_MODE": "http",
            "JEANBOT_API_URL": "http://api.test",
            "INTERNAL_SERVICE_TOKEN": "secret-token"
        }):
            service = MissionExecutorService(workspace_root="/tmp")
            bundle = service.build_bundle({
                "workspace_id": "ws-1",
                "title": "Test",
                "objective": "Test",
                "auth_context": {"userId": "user-1"}
            })
            self.assertIsInstance(bundle.audit_service, HttpAuditService)
            self.assertEqual(bundle.audit_service.api_url, "http://api.test")
            self.assertEqual(bundle.audit_service.service_token, "secret-token")
            # Check auth context b64
            self.assertIsNotNone(bundle.audit_service.auth_context_b64)

    @patch("urllib.request.urlopen")
    async def test_http_audit_service_record(self, mock_urlopen):
        mock_response = mock_urlopen.return_value.__enter__.return_value
        mock_response.status = 204

        service = HttpAuditService(api_url="http://api.test", service_token="token", service_name="test")
        await service.record("event", "entity", "service", {"data": "value"})

        mock_urlopen.assert_called()
        args, _ = mock_urlopen.call_args
        req = args[0]
        self.assertEqual(req.get_full_url(), "http://api.test/internal/audit")
        self.assertEqual(req.get_method(), "POST")

    @patch("urllib.request.urlopen")
    def test_http_policy_service_evaluate(self, mock_urlopen):
        mock_response = mock_urlopen.return_value.__enter__.return_value
        mock_response.status = 200
        mock_response.read.return_value = json.dumps({"approval_required": True, "risk": "high"}).encode("utf-8")

        service = HttpPolicyService(api_url="http://api.test", service_token="token", service_name="test")
        decision = service.evaluate_mission({"objective": "test"})

        self.assertTrue(decision.approval_required)
        self.assertEqual(decision.risk, "high")


if __name__ == "__main__":
    unittest.main()
