"""The one piece of provider setup that's genuinely identical across every
agent: read a provider's API key at call time (not import time, so the
service still starts and serves /health with no key configured) and raise a
typed, feature-specific error if it's missing. Each agent's own provider.py
still owns everything domain-specific (the ABC, the real implementation, the
system prompt) — this only factors out what would otherwise be copy-pasted
between them.
"""

import os

from app.errors import ProviderNotConfiguredError


def get_anthropic_api_key(feature: str) -> str:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ProviderNotConfiguredError(feature)
    return api_key


def get_voyage_api_key(feature: str) -> str:
    api_key = os.environ.get("VOYAGE_API_KEY")
    if not api_key:
        raise ProviderNotConfiguredError(
            feature, env_var="VOYAGE_API_KEY", provider_name="No embedding provider"
        )
    return api_key
