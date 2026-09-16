"""Tests for POST /architecture/generate.

The "provider not configured" case runs for real against this environment's
actual (unset) ANTHROPIC_API_KEY — no mocking needed. The success/failure-
after-configured cases use FakeArchitectureProvider, a clearly-named test
double injected via monkeypatch — never presented as, or used as, the
production provider. Mirrors tests/test_prd.py.
"""

import os

import pytest
from fastapi.testclient import TestClient

from app.agents.architecture import provider as architecture_provider_module
from app.errors import AIResponseInvalidError, ProviderRequestError
from app.schemas import ArchitectureContent, PrdContent
from main import app

client = TestClient(app)


class FakeArchitectureProvider(architecture_provider_module.ArchitectureProvider):
    """Test double only — never used outside this test file."""

    def __init__(self, content: ArchitectureContent | None = None, error: Exception | None = None):
        self._content = content
        self._error = error

    def generate(self, prd: PrdContent) -> ArchitectureContent:
        if self._error is not None:
            raise self._error
        assert self._content is not None
        return self._content


SAMPLE_PRD = {
    "overview": "A workspace tool that helps developers track coffee consumption during code reviews.",
    "problem_statement": "Developers have no way to correlate coffee intake with review activity.",
    "goals": ["Make it effortless to log a cup during a review"],
    "personas": ["A developer doing code reviews throughout the day"],
    "functional_requirements": ["Log a coffee event tied to a specific review"],
    "non_functional_requirements": [],
    "user_workflows": ["A developer opens a review, logs a cup, continues reviewing"],
    "edge_cases": ["Logging a cup with no active review"],
    "success_criteria": ["Cups logged per week trend upward"],
    "constraints": [],
    "assumptions": ["Single-user, no team accounts needed yet"],
    "open_questions": ["Should decaf count separately from regular coffee?"],
}

SAMPLE_ARCHITECTURE_CONTENT = ArchitectureContent(
    overview="A single-page app backed by a small REST API and a relational database.",
    system_architecture="A modular monolith: one backend service handling auth, logging, and stats.",
    technology_stack=["React frontend", "Node/Express API", "PostgreSQL"],
    components=["API service — validates and persists coffee events"],
    data_model=["CoffeeEvent belongs to a Review"],
    api_design=["POST /events — log a coffee event"],
    data_flows=["User logs a cup -> API validates -> persisted -> stats recomputed"],
    security=["Session-based auth on every write"],
    scalability=["Single instance sufficient at current scale"],
    deployment=["Single Docker Compose stack"],
    tradeoffs=["Chose a monolith over microservices given the small scope"],
    assumptions=["Single-user, no team accounts needed yet"],
    open_questions=["Should decaf count separately from regular coffee?"],
)


def test_health_still_works():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_generate_rejects_missing_prd_with_400():
    res = client.post("/architecture/generate", json={})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


def test_generate_rejects_wrong_field_type_with_400():
    res = client.post("/architecture/generate", json={"prd": {"overview": 123}})
    assert res.status_code == 400
    body = res.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert any(err["loc"] == ["body", "prd", "overview"] for err in body["error"]["details"])


def test_generate_accepts_minimal_valid_prd_and_reaches_the_provider_check():
    # overview and problem_statement are the only required fields on
    # PrdContent (every other field defaults to an empty list) — a minimal
    # body like this is valid and should pass validation, reaching the
    # (unconfigured) provider check, not fail as a 400.
    res = client.post(
        "/architecture/generate",
        json={"prd": {"overview": "x", "problem_statement": "y"}},
    )
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "PROVIDER_NOT_CONFIGURED"


def test_generate_returns_503_when_provider_not_configured():
    # Real, unmocked: this environment genuinely has no ANTHROPIC_API_KEY.
    assert "ANTHROPIC_API_KEY" not in os.environ
    res = client.post("/architecture/generate", json={"prd": SAMPLE_PRD})
    assert res.status_code == 503
    body = res.json()
    assert body["error"]["code"] == "PROVIDER_NOT_CONFIGURED"
    assert "architecture generation" in body["error"]["message"]


def test_generate_returns_structured_content_from_a_configured_provider(monkeypatch):
    monkeypatch.setattr(
        architecture_provider_module,
        "get_provider",
        lambda: FakeArchitectureProvider(content=SAMPLE_ARCHITECTURE_CONTENT),
    )
    res = client.post("/architecture/generate", json={"prd": SAMPLE_PRD})
    assert res.status_code == 200
    body = res.json()["content"]
    assert body["overview"] == SAMPLE_ARCHITECTURE_CONTENT.overview
    assert body["technology_stack"] == SAMPLE_ARCHITECTURE_CONTENT.technology_stack
    assert body["open_questions"] == SAMPLE_ARCHITECTURE_CONTENT.open_questions


def test_generate_surfaces_ai_response_invalid_as_502(monkeypatch):
    monkeypatch.setattr(
        architecture_provider_module,
        "get_provider",
        lambda: FakeArchitectureProvider(
            error=AIResponseInvalidError("the model's output did not match the schema")
        ),
    )
    res = client.post("/architecture/generate", json={"prd": SAMPLE_PRD})
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "AI_RESPONSE_INVALID"


def test_generate_surfaces_provider_request_error_as_502(monkeypatch):
    monkeypatch.setattr(
        architecture_provider_module,
        "get_provider",
        lambda: FakeArchitectureProvider(error=ProviderRequestError("rate limited")),
    )
    res = client.post("/architecture/generate", json={"prd": SAMPLE_PRD})
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "AI_PROVIDER_ERROR"


class TestGetProviderSelectsCorrectImplementation:
    def test_selects_gemini_when_gemini_key_is_set(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "fake-gemini-key-not-real")
        provider = architecture_provider_module.get_provider()
        assert isinstance(provider, architecture_provider_module.GeminiArchitectureProvider)

    def test_selects_anthropic_when_only_anthropic_key_is_set(self, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-anthropic-key-not-real")
        provider = architecture_provider_module.get_provider()
        assert isinstance(provider, architecture_provider_module.AnthropicArchitectureProvider)

    def test_prefers_gemini_when_both_keys_are_set(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "fake-gemini-key-not-real")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-anthropic-key-not-real")
        provider = architecture_provider_module.get_provider()
        assert isinstance(provider, architecture_provider_module.GeminiArchitectureProvider)


@pytest.fixture(autouse=True)
def _no_leaked_env(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
