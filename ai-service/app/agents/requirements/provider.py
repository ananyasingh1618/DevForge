"""Provider abstraction for requirements analysis.

`RequirementsProvider` is the seam a test double sits behind (see
ai-service/tests/), and where a second real provider would be added later
without touching the router. Only one real implementation exists:
AnthropicRequirementsProvider, using Claude (claude-opus-5) via structured
outputs (Pydantic `output_format`). There is no fallback that fabricates a
result — every failure path (no key configured, provider error, invalid
output) raises a typed error instead.
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod

import anthropic

from app.errors import (
    AIResponseInvalidError,
    ProviderNotConfiguredError,
    ProviderRequestError,
)
from app.schemas import RequirementsContent

MODEL = "claude-opus-5"

SYSTEM_PROMPT = """You are the requirements-analysis agent for DevForge, an AI software \
engineering workspace. Given a free-form project idea, produce a structured requirements \
analysis.

Rules:
- Distinguish explicitly between what the user actually stated in the idea text \
("source": "stated") and what you inferred or added because it's reasonable but wasn't \
said ("source": "inferred"). Do not mark something "stated" unless it is genuinely present \
in the idea text.
- Separate functional requirements (what the system does) from non-functional requirements \
(performance, security, reliability, usability, etc.).
- Give every requirement a stable id ("FR-1", "FR-2", ... for functional; "NFR-1", "NFR-2", \
... for non-functional), a clear title, a one- or two-sentence description, a priority \
(high/medium/low), and concrete, testable acceptance criteria.
- List open questions genuinely worth asking the user, not filler.
- Keep the project summary to 2-4 sentences.
- Do not invent business/domain details that were not stated and are not reasonable, \
low-risk inferences a competent engineer would make from the idea alone."""


class RequirementsProvider(ABC):
    @abstractmethod
    def analyze(self, idea: str) -> RequirementsContent: ...


class AnthropicRequirementsProvider(RequirementsProvider):
    def __init__(self, api_key: str, model: str = MODEL) -> None:
        self._client = anthropic.Anthropic(api_key=api_key)
        self._model = model

    def analyze(self, idea: str) -> RequirementsContent:
        try:
            response = self._client.messages.parse(
                model=self._model,
                max_tokens=8000,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": idea}],
                output_format=RequirementsContent,
            )
        except anthropic.BadRequestError as e:
            raise ProviderRequestError(f"The AI provider rejected the request: {e.message}") from e
        except anthropic.AuthenticationError as e:
            raise ProviderRequestError(
                f"Authentication with the AI provider failed: {e.message}"
            ) from e
        except anthropic.PermissionDeniedError as e:
            raise ProviderRequestError(
                f"The AI provider denied access to this model: {e.message}"
            ) from e
        except anthropic.NotFoundError as e:
            raise ProviderRequestError(f"The AI provider model was not found: {e.message}") from e
        except anthropic.RateLimitError as e:
            raise ProviderRequestError(f"The AI provider rate-limited this request: {e.message}") from e
        except anthropic.APIStatusError as e:
            raise ProviderRequestError(f"The AI provider returned an error: {e.message}") from e
        except anthropic.APIConnectionError as e:
            raise ProviderRequestError(f"Could not reach the AI provider: {e}") from e

        if response.parsed_output is None:
            raise AIResponseInvalidError(
                "the model's output could not be parsed as valid JSON matching the "
                "expected requirements schema"
            )

        return response.parsed_output


def get_provider() -> RequirementsProvider:
    """Reads ANTHROPIC_API_KEY at call time (not import time), so the
    service still starts and serves /health with no key configured."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ProviderNotConfiguredError()
    return AnthropicRequirementsProvider(api_key=api_key)
