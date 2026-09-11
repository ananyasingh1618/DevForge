"""Tests for POST /requirements/analyze.

The "provider not configured" cases run for real against this environment's
actual (unset) ANTHROPIC_API_KEY — no mocking needed, since that is genuinely
this environment's current state. The success/failure-after-configured cases
use FakeRequirementsProvider, a clearly-named test double injected via
monkeypatch — never presented as, or used as, the production provider.
"""

import os

import pytest
from fastapi.testclient import TestClient

from app.agents.requirements import provider as provider_module
from app.errors import AIResponseInvalidError, ProviderRequestError
from app.schemas import RequirementItem, RequirementsContent
from main import app

client = TestClient(app)


class FakeRequirementsProvider(provider_module.RequirementsProvider):
    """Test double only — never used outside this test file."""

    def __init__(self, content: RequirementsContent | None = None, error: Exception | None = None):
        self._content = content
        self._error = error

    def analyze(self, idea: str) -> RequirementsContent:
        if self._error is not None:
            raise self._error
        assert self._content is not None
        return self._content


SAMPLE_CONTENT = RequirementsContent(
    project_summary="A tool that tracks coffee consumption during code reviews.",
    users=["Developers who review code"],
    functional_requirements=[
        RequirementItem(
            id="FR-1",
            title="Log a coffee event",
            description="A user can log a cup of coffee tied to a review.",
            priority="high",
            source="stated",
            acceptance_criteria=["Logging a cup persists it with a timestamp"],
        )
    ],
    non_functional_requirements=[],
    constraints=[],
    assumptions=["Single-user, no team accounts needed yet"],
    open_questions=["Should decaf count separately from regular coffee?"],
)


def test_health_still_works():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_analyze_rejects_short_idea_with_400():
    res = client.post("/requirements/analyze", json={"idea": "short"})
    assert res.status_code == 400
    body = res.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert any(err["loc"] == ["body", "idea"] for err in body["error"]["details"])


def test_analyze_rejects_missing_idea_with_400():
    res = client.post("/requirements/analyze", json={})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


def test_analyze_returns_503_when_provider_not_configured():
    # Real, unmocked: this environment genuinely has no ANTHROPIC_API_KEY.
    assert "ANTHROPIC_API_KEY" not in os.environ
    res = client.post(
        "/requirements/analyze",
        json={"idea": "A tool that tracks coffee consumption during code reviews."},
    )
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "PROVIDER_NOT_CONFIGURED"


def test_analyze_returns_structured_content_from_a_configured_provider(monkeypatch):
    monkeypatch.setattr(
        provider_module, "get_provider", lambda: FakeRequirementsProvider(content=SAMPLE_CONTENT)
    )
    res = client.post(
        "/requirements/analyze",
        json={"idea": "A tool that tracks coffee consumption during code reviews."},
    )
    assert res.status_code == 200
    body = res.json()["content"]
    assert body["project_summary"] == SAMPLE_CONTENT.project_summary
    assert body["functional_requirements"][0]["id"] == "FR-1"
    assert body["functional_requirements"][0]["source"] == "stated"


def test_analyze_surfaces_ai_response_invalid_as_502(monkeypatch):
    monkeypatch.setattr(
        provider_module,
        "get_provider",
        lambda: FakeRequirementsProvider(
            error=AIResponseInvalidError("the model's output did not match the schema")
        ),
    )
    res = client.post(
        "/requirements/analyze",
        json={"idea": "A tool that tracks coffee consumption during code reviews."},
    )
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "AI_RESPONSE_INVALID"


def test_analyze_surfaces_provider_request_error_as_502(monkeypatch):
    monkeypatch.setattr(
        provider_module,
        "get_provider",
        lambda: FakeRequirementsProvider(error=ProviderRequestError("rate limited")),
    )
    res = client.post(
        "/requirements/analyze",
        json={"idea": "A tool that tracks coffee consumption during code reviews."},
    )
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "AI_PROVIDER_ERROR"


@pytest.fixture(autouse=True)
def _no_leaked_env(monkeypatch):
    # Belt-and-suspenders: make sure no test accidentally leaves a fake key
    # behind for a later test in the same process.
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
