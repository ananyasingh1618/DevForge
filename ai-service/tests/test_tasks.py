"""Tests for POST /tasks/generate.

The "provider not configured" case runs for real against this environment's
actual (unset) ANTHROPIC_API_KEY — no mocking needed. The success/failure-
after-configured cases use FakeTasksProvider, a clearly-named test double
injected via monkeypatch — never presented as, or used as, the production
provider. Mirrors tests/test_epics.py.
"""

import os

import pytest
from fastapi.testclient import TestClient

from app.agents.tasks import provider as tasks_provider_module
from app.errors import AIResponseInvalidError, ProviderRequestError
from app.schemas import EpicContent, TaskContent
from main import app

client = TestClient(app)


class FakeTasksProvider(tasks_provider_module.TasksProvider):
    """Test double only — never used outside this test file."""

    def __init__(self, content: TaskContent | None = None, error: Exception | None = None):
        self._content = content
        self._error = error

    def generate(self, epics: EpicContent) -> TaskContent:
        if self._error is not None:
            raise self._error
        assert self._content is not None
        return self._content


SAMPLE_EPICS = {
    "epics": [
        {
            "id": "EP-1",
            "title": "Expense logging",
            "description": "Let users log expenses against weekly categories.",
            "objective": "Users can record an expense in under 10 seconds.",
            "business_value": "Core value proposition of the app.",
            "scope": "Expense creation and category assignment only.",
            "acceptance_criteria": ["A logged expense persists with a timestamp"],
            "dependencies": [],
            "related_components": ["API service"],
        }
    ]
}

SAMPLE_TASK_CONTENT = TaskContent(
    tasks=[
        {
            "id": "T-1",
            "title": "Add POST /expenses endpoint",
            "description": "Create an endpoint that persists a new expense.",
            "type": "feature",
            "priority": "high",
            "acceptance_criteria": ["Posting a valid expense returns 201"],
            "dependencies": [],
            "epic_id": "EP-1",
            "related_component": "API service",
            "estimated_complexity": "small",
            "suggested_order": 1,
        }
    ]
)


def test_health_still_works():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_generate_rejects_missing_epics_with_400():
    res = client.post("/tasks/generate", json={})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


def test_generate_rejects_wrong_field_type_with_400():
    res = client.post("/tasks/generate", json={"epics": {"epics": "not-a-list"}})
    assert res.status_code == 400
    body = res.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert any(err["loc"] == ["body", "epics", "epics"] for err in body["error"]["details"])


def test_generate_accepts_minimal_valid_epics_and_reaches_the_provider_check():
    # EpicContent.epics defaults to an empty list, so {"epics": {}} is a
    # minimal-but-valid body that should pass validation, reaching the
    # (unconfigured) provider check, not fail as a 400.
    res = client.post("/tasks/generate", json={"epics": {}})
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "PROVIDER_NOT_CONFIGURED"


def test_generate_returns_503_when_provider_not_configured():
    # Real, unmocked: this environment genuinely has no ANTHROPIC_API_KEY.
    assert "ANTHROPIC_API_KEY" not in os.environ
    res = client.post("/tasks/generate", json={"epics": SAMPLE_EPICS})
    assert res.status_code == 503
    body = res.json()
    assert body["error"]["code"] == "PROVIDER_NOT_CONFIGURED"
    assert "task generation" in body["error"]["message"]


def test_generate_returns_structured_content_from_a_configured_provider(monkeypatch):
    monkeypatch.setattr(
        tasks_provider_module,
        "get_provider",
        lambda: FakeTasksProvider(content=SAMPLE_TASK_CONTENT),
    )
    res = client.post("/tasks/generate", json={"epics": SAMPLE_EPICS})
    assert res.status_code == 200
    body = res.json()["content"]
    assert body["tasks"][0]["id"] == "T-1"
    assert body["tasks"][0]["epic_id"] == "EP-1"


def test_generate_surfaces_ai_response_invalid_as_502(monkeypatch):
    monkeypatch.setattr(
        tasks_provider_module,
        "get_provider",
        lambda: FakeTasksProvider(
            error=AIResponseInvalidError("the model's output did not match the schema")
        ),
    )
    res = client.post("/tasks/generate", json={"epics": SAMPLE_EPICS})
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "AI_RESPONSE_INVALID"


def test_generate_surfaces_provider_request_error_as_502(monkeypatch):
    monkeypatch.setattr(
        tasks_provider_module,
        "get_provider",
        lambda: FakeTasksProvider(error=ProviderRequestError("rate limited")),
    )
    res = client.post("/tasks/generate", json={"epics": SAMPLE_EPICS})
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "AI_PROVIDER_ERROR"


@pytest.fixture(autouse=True)
def _no_leaked_env(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
