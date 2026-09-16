"""The one piece of provider setup that's genuinely identical across every
agent: read a provider's API key at call time (not import time, so the
service still starts and serves /health with no key configured) and raise a
typed, feature-specific error if it's missing. Each agent's own provider.py
still owns everything domain-specific (the ABC, the real implementations, the
system prompt) — this only factors out what would otherwise be copy-pasted
between them.

`resolve_llm_provider()` additionally owns the one piece of *provider
selection* policy shared by every text-generation agent (requirements, prd,
architecture, epics, tasks, qa, review — everything that calls an LLM for
structured text output; the embeddings agent is unrelated and still only
ever uses Voyage): Gemini is preferred whenever `GEMINI_API_KEY` is set,
since it has a genuinely free tier and needs no paid account to try —
Anthropic remains fully supported as an explicit opt-in for anyone who sets
`ANTHROPIC_API_KEY` instead (or additionally; Gemini still wins if both are
set — set only `ANTHROPIC_API_KEY` to use Anthropic). Neither is hardcoded
as "the" provider anywhere else — every agent's `get_provider()` calls this
one function and branches on the name it returns.
"""

import os
from typing import Literal

from app.errors import ProviderNotConfiguredError

LlmProviderName = Literal["gemini", "anthropic"]


def get_anthropic_api_key(feature: str) -> str:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ProviderNotConfiguredError(feature)
    return api_key


def get_gemini_api_key(feature: str) -> str:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ProviderNotConfiguredError(
            feature, env_var="GEMINI_API_KEY", provider_name="No LLM provider"
        )
    return api_key


def get_voyage_api_key(feature: str) -> str:
    api_key = os.environ.get("VOYAGE_API_KEY")
    if not api_key:
        raise ProviderNotConfiguredError(
            feature, env_var="VOYAGE_API_KEY", provider_name="No embedding provider"
        )
    return api_key


def resolve_llm_provider(feature: str) -> tuple[LlmProviderName, str]:
    """Returns (provider_name, api_key) for whichever LLM provider is
    actually configured, read fresh from the environment on every call (not
    cached at import time) so tests and a running process both see a
    just-changed environment immediately. Raises ProviderNotConfiguredError,
    naming both env vars, only when neither is set."""
    gemini_key = os.environ.get("GEMINI_API_KEY")
    if gemini_key:
        return "gemini", gemini_key
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if anthropic_key:
        return "anthropic", anthropic_key
    raise ProviderNotConfiguredError(
        feature,
        env_var="GEMINI_API_KEY or ANTHROPIC_API_KEY",
        provider_name="No LLM provider",
    )
