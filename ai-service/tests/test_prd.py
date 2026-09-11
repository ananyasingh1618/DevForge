"""Tests for POST /prd/generate.

The "provider not configured" case runs for real against this environment's
actual (unset) ANTHROPIC_API_KEY — no mocking needed. The success/failure-
after-configured cases use FakePrdProvider, a clearly-named test double
injected via monkeypatch — never presented as, or used as, the production
provider. Mirrors tests/test_requirements.py.
"""

import os

import pytest
from fastapi.testclient import TestClient

from app.agents.prd import provider as prd_provider_module
from app.errors import AIResponseInvalidError, ProviderRequestError
from app.schemas import PrdContent, RequirementsContent
from main import app

client = TestClient(app)


class FakePrdProvider(prd_provider_module.PrdProvider):
    """Test double only — never used outside this test file."""

    def __init__(self, content: PrdContent | None = None, error: Exception | None = None):
        self._content = content
        self._error = error

    def generate(self, requirements: RequirementsContent) -> PrdContent:
        if self._error is not None:
            raise self._error
        assert self._content is not None
        return self._content


SAMPLE_REQUIREMENTS = {
    "project_summary": "A tool that tracks coffee consumption during code reviews.",
    "users": ["Developers who review code"],
    "functional_requirements": [
        {
            "id": "FR-1",
            "title": "Log a coffee event",
            "description": "A user can log a cup of coffee tied to a review.",
            "priority": "high",
            "source": "stated",
            "acceptance_criteria": ["Logging a cup persists it with a timestamp"],
        }
    ],
    "non_functional_requirements": [],
    "constraints": [],
    "assumptions": [],
    "open_questions": [],
}

SAMPLE_PRD_CONTENT = PrdContent(
    overview="A workspace tool that helps developers track coffee consumption during code reviews.",
    problem_statement="Developers have no way to correlate coffee intake with review activity.",
    goals=["Make it effortless to log a cup during a review"],
    personas=["A developer doing code reviews throughout the day"],
    functional_requirements=["Log a coffee event tied to a specific review"],
    non_functional_requirements=[],
    user_workflows=["A developer opens a review, logs a cup, continues reviewing"],
    edge_cases=["Logging a cup with no active review"],
    success_criteria=["Cups logged per week trend upward"],
    constraints=[],
    assumptions=["Single-user, no team accounts needed yet"],
    open_questions=["Should decaf count separately from regular coffee?"],
)


def test_health_still_works():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_generate_rejects_missing_requirements_with_400():
    res = client.post("/prd/generate", json={})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


def test_generate_rejects_wrong_field_type_with_400():
    res = client.post("/prd/generate", json={"requirements": {"project_summary": 123}})
    assert res.status_code == 400
    body = res.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert any(
        err["loc"] == ["body", "requirements", "project_summary"] for err in body["error"]["details"]
    )


def test_generate_accepts_minimal_valid_requirements_and_reaches_the_provider_check():
    # project_summary is the only required field on RequirementsContent (every
    # other field defaults to an empty list) — a minimal body like this is
    # valid and should pass validation, reaching the (unconfigured) provider
    # check, not fail as a 400.
    res = client.post("/prd/generate", json={"requirements": {"project_summary": "x"}})
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "PROVIDER_NOT_CONFIGURED"


def test_generate_returns_503_when_provider_not_configured():
    # Real, unmocked: this environment genuinely has no ANTHROPIC_API_KEY.
    assert "ANTHROPIC_API_KEY" not in os.environ
    res = client.post("/prd/generate", json={"requirements": SAMPLE_REQUIREMENTS})
    assert res.status_code == 503
    body = res.json()
    assert body["error"]["code"] == "PROVIDER_NOT_CONFIGURED"
    assert "PRD generation" in body["error"]["message"]


def test_generate_returns_structured_content_from_a_configured_provider(monkeypatch):
    monkeypatch.setattr(
        prd_provider_module,
        "get_provider",
        lambda: FakePrdProvider(content=SAMPLE_PRD_CONTENT),
    )
    res = client.post("/prd/generate", json={"requirements": SAMPLE_REQUIREMENTS})
    assert res.status_code == 200
    body = res.json()["content"]
    assert body["overview"] == SAMPLE_PRD_CONTENT.overview
    assert body["functional_requirements"] == SAMPLE_PRD_CONTENT.functional_requirements
    assert body["open_questions"] == SAMPLE_PRD_CONTENT.open_questions


def test_generate_surfaces_ai_response_invalid_as_502(monkeypatch):
    monkeypatch.setattr(
        prd_provider_module,
        "get_provider",
        lambda: FakePrdProvider(
            error=AIResponseInvalidError("the model's output did not match the schema")
        ),
    )
    res = client.post("/prd/generate", json={"requirements": SAMPLE_REQUIREMENTS})
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "AI_RESPONSE_INVALID"


def test_generate_surfaces_provider_request_error_as_502(monkeypatch):
    monkeypatch.setattr(
        prd_provider_module,
        "get_provider",
        lambda: FakePrdProvider(error=ProviderRequestError("rate limited")),
    )
    res = client.post("/prd/generate", json={"requirements": SAMPLE_REQUIREMENTS})
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "AI_PROVIDER_ERROR"


@pytest.fixture(autouse=True)
def _no_leaked_env(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
