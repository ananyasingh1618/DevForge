"""Tests for the shared LLM-provider-selection policy
(app/lib/provider_config.resolve_llm_provider): Gemini is preferred whenever
GEMINI_API_KEY is set (it has a genuinely free tier), Anthropic is used when
only ANTHROPIC_API_KEY is set, and a typed ProviderNotConfiguredError is
raised — naming both env vars — when neither is set. Every agent's own
get_provider() delegates to this one function, so this is the single place
that policy is verified, rather than seven copies of the same assertion.
"""

import pytest

from app.errors import ProviderNotConfiguredError
from app.lib.provider_config import get_gemini_api_key, resolve_llm_provider


class TestResolveLlmProvider:
    def test_prefers_gemini_when_gemini_key_is_set(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "fake-gemini-key")
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        provider_name, api_key = resolve_llm_provider("requirements analysis")
        assert provider_name == "gemini"
        assert api_key == "fake-gemini-key"

    def test_prefers_gemini_even_when_both_keys_are_set(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "fake-gemini-key")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-anthropic-key")
        provider_name, api_key = resolve_llm_provider("requirements analysis")
        assert provider_name == "gemini"
        assert api_key == "fake-gemini-key"

    def test_falls_back_to_anthropic_when_only_anthropic_key_is_set(self, monkeypatch):
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-anthropic-key")
        provider_name, api_key = resolve_llm_provider("requirements analysis")
        assert provider_name == "anthropic"
        assert api_key == "fake-anthropic-key"

    def test_raises_provider_not_configured_when_neither_key_is_set(self, monkeypatch):
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        with pytest.raises(ProviderNotConfiguredError) as exc_info:
            resolve_llm_provider("requirements analysis")
        assert exc_info.value.code == "PROVIDER_NOT_CONFIGURED"
        assert "GEMINI_API_KEY" in exc_info.value.message
        assert "ANTHROPIC_API_KEY" in exc_info.value.message

    def test_reads_the_environment_fresh_on_every_call(self, monkeypatch):
        # Not cached at import time — a key set after the module was
        # imported must still be picked up (matters for a live process
        # whose env doesn't change, but is exactly what makes each test in
        # this file independent of import order too).
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        with pytest.raises(ProviderNotConfiguredError):
            resolve_llm_provider("requirements analysis")

        monkeypatch.setenv("GEMINI_API_KEY", "now-set")
        provider_name, api_key = resolve_llm_provider("requirements analysis")
        assert provider_name == "gemini"
        assert api_key == "now-set"


class TestGetGeminiApiKey:
    def test_returns_the_key_when_set(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "fake-gemini-key")
        assert get_gemini_api_key("requirements analysis") == "fake-gemini-key"

    def test_raises_provider_not_configured_when_unset(self, monkeypatch):
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        with pytest.raises(ProviderNotConfiguredError) as exc_info:
            get_gemini_api_key("requirements analysis")
        assert exc_info.value.code == "PROVIDER_NOT_CONFIGURED"
        assert "GEMINI_API_KEY" in exc_info.value.message


@pytest.fixture(autouse=True)
def _no_leaked_env(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
