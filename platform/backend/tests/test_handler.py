from unittest.mock import Mock

from app import pipeline, router
from app.handler import lambda_handler


def test_worker_event_calls_pipeline_without_http_routing(monkeypatch):
    run = Mock(return_value=None)
    route = Mock(side_effect=AssertionError("Worker event must not route HTTP"))
    monkeypatch.setattr(pipeline, "run", run)
    monkeypatch.setattr(router, "route", route)
    assert lambda_handler({"worker": "run", "run_id": "research-id"}, None) is None
    run.assert_called_once_with("research-id")
    route.assert_not_called()
