"""Tests for POST /epics/generate.

The "provider not configured" case runs for real against this environment's
actual (unset) ANTHROPIC_API_KEY — no mocking needed. The success/failure-
after-configured cases use FakeEpicsProvider, a clearly-named test double
injected via monkeypatch — never presented as, or used as, the production
provider. Mirrors tests/test_architecture.py.
"""

import os

import pytest
from fastapi.testclient import TestClient

from app.agents.epics import provider as epics_provider_module
from app.errors import AIResponseInvalidError, ProviderRequestError
from app.schemas import ArchitectureContent, EpicContent
from main import app

client = TestClient(app)


class FakeEpicsProvider(epics_provider_module.EpicsProvider):
    """Test double only — never used outside this test file."""

    def __init__(self, content: EpicContent | None = None, error: Exception | None = None):
        self._content = content
        self._error = error

    def generate(self, architecture: ArchitectureContent) -> EpicContent:
        if self._error is not None:
            raise self._error
        assert self._content is not None
        return self._content


SAMPLE_ARCHITECTURE = {
    "overview": "A single-page app backed by a small REST API and a relational database.",
    "system_architecture": "A modular monolith: one backend service handling auth, logging, and stats.",
    "technology_stack": ["React frontend", "Node/Express API", "PostgreSQL"],
    "components": ["API service", "Auth module", "Stats module"],
    "data_model": ["Expense belongs to a Household"],
    "api_design": ["POST /expenses — log an expense"],
    "data_flows": [],
    "security": [],
    "scalability": [],
    "deployment": [],
    "tradeoffs": [],
    "assumptions": [],
    "open_questions": [],
}

SAMPLE_EPIC_CONTENT = EpicContent(
    epics=[
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
)


def test_health_still_works():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_generate_rejects_missing_architecture_with_400():
    res = client.post("/epics/generate", json={})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


def test_generate_rejects_wrong_field_type_with_400():
    res = client.post("/epics/generate", json={"architecture": {"overview": 123}})
    assert res.status_code == 400
    body = res.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert any(err["loc"] == ["body", "architecture", "overview"] for err in body["error"]["details"])


def test_generate_accepts_minimal_valid_architecture_and_reaches_the_provider_check():
    # overview and system_architecture are the only required fields on
    # ArchitectureContent (every other field defaults to an empty list) — a
    # minimal body like this is valid and should pass validation, reaching
    # the (unconfigured) provider check, not fail as a 400.
    res = client.post(
        "/epics/generate",
        json={"architecture": {"overview": "x", "system_architecture": "y"}},
    )
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "PROVIDER_NOT_CONFIGURED"


def test_generate_returns_503_when_provider_not_configured():
    # Real, unmocked: this environment genuinely has no ANTHROPIC_API_KEY.
    assert "ANTHROPIC_API_KEY" not in os.environ
    res = client.post("/epics/generate", json={"architecture": SAMPLE_ARCHITECTURE})
    assert res.status_code == 503
    body = res.json()
    assert body["error"]["code"] == "PROVIDER_NOT_CONFIGURED"
    assert "epic generation" in body["error"]["message"]


def test_generate_returns_structured_content_from_a_configured_provider(monkeypatch):
    monkeypatch.setattr(
        epics_provider_module,
        "get_provider",
        lambda: FakeEpicsProvider(content=SAMPLE_EPIC_CONTENT),
    )
    res = client.post("/epics/generate", json={"architecture": SAMPLE_ARCHITECTURE})
    assert res.status_code == 200
    body = res.json()["content"]
    assert body["epics"][0]["id"] == "EP-1"
    assert body["epics"][0]["title"] == "Expense logging"


def test_generate_surfaces_ai_response_invalid_as_502(monkeypatch):
    monkeypatch.setattr(
        epics_provider_module,
        "get_provider",
        lambda: FakeEpicsProvider(
            error=AIResponseInvalidError("the model's output did not match the schema")
        ),
    )
    res = client.post("/epics/generate", json={"architecture": SAMPLE_ARCHITECTURE})
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "AI_RESPONSE_INVALID"


def test_generate_surfaces_provider_request_error_as_502(monkeypatch):
    monkeypatch.setattr(
        epics_provider_module,
        "get_provider",
        lambda: FakeEpicsProvider(error=ProviderRequestError("rate limited")),
    )
    res = client.post("/epics/generate", json={"architecture": SAMPLE_ARCHITECTURE})
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "AI_PROVIDER_ERROR"


class TestGetProviderSelectsCorrectImplementation:
    def test_selects_gemini_when_gemini_key_is_set(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "fake-gemini-key-not-real")
        provider = epics_provider_module.get_provider()
        assert isinstance(provider, epics_provider_module.GeminiEpicsProvider)

    def test_selects_anthropic_when_only_anthropic_key_is_set(self, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-anthropic-key-not-real")
        provider = epics_provider_module.get_provider()
        assert isinstance(provider, epics_provider_module.AnthropicEpicsProvider)

    def test_prefers_gemini_when_both_keys_are_set(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "fake-gemini-key-not-real")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-anthropic-key-not-real")
        provider = epics_provider_module.get_provider()
        assert isinstance(provider, epics_provider_module.GeminiEpicsProvider)


@pytest.fixture(autouse=True)
def _no_leaked_env(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
