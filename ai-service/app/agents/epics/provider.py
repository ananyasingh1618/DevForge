"""Provider abstraction for epic generation.

`EpicsProvider` is the seam a test double sits behind (see ai-service/tests/),
structured the same way as ArchitectureProvider — a separate ABC, not a
shared generic one, since the input/output shapes genuinely differ (a
structured ArchitectureContent in, a structured EpicContent out). What *is*
shared, concretely: reading ANTHROPIC_API_KEY and raising
ProviderNotConfiguredError (app/lib/provider_config.py), and the same
typed-exception-to-ProviderRequestError chain. Only one real implementation
exists: AnthropicEpicsProvider, using Claude (claude-opus-5) via structured
outputs. No fallback fabricates a result.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import anthropic

from app.errors import AIResponseInvalidError, ProviderRequestError
from app.lib.provider_config import get_anthropic_api_key
from app.schemas import ArchitectureContent, EpicContent

MODEL = "claude-opus-5"

SYSTEM_PROMPT = """You are the epic-generation agent for DevForge, an AI software engineering \
workspace. Given a project's structured technical architecture (already designed: overview, \
system architecture, technology stack, components, data model, API design, data flows, \
security, scalability, deployment, tradeoffs, assumptions, open questions), break the work of \
building it into a set of epics — large, cohesive units of work.

Rules:
- "id": a stable short id per epic, e.g. "EP-1", "EP-2", unique within the response.
- "title": short, specific to what this epic delivers.
- "description": what this epic covers, in prose.
- "objective": the concrete outcome this epic achieves.
- "business_value": why this epic matters, grounded in the architecture's own goals and \
tradeoffs — do not invent value propositions the given architecture doesn't support.
- "scope": what is and is not included in this epic, to keep epics non-overlapping.
- "acceptance_criteria": concrete, checkable conditions for this epic being done.
- "dependencies": ids of other epics in this same response that must complete first, if any.
- "related_components": names of components from the given architecture's own "components" \
list that this epic touches — do not invent components the architecture doesn't list.
- Epics should be cohesive and non-overlapping, together covering the architecture's \
components and workflows without duplicating scope across epics.
- Do not invent technology choices, components, or requirements beyond what the given \
architecture supports."""


class EpicsProvider(ABC):
    @abstractmethod
    def generate(self, architecture: ArchitectureContent) -> EpicContent: ...


class AnthropicEpicsProvider(EpicsProvider):
    def __init__(self, api_key: str, model: str = MODEL) -> None:
        self._client = anthropic.Anthropic(api_key=api_key)
        self._model = model

    def generate(self, architecture: ArchitectureContent) -> EpicContent:
        architecture_json = architecture.model_dump_json(indent=2)
        try:
            response = self._client.messages.parse(
                model=self._model,
                max_tokens=8000,
                system=SYSTEM_PROMPT,
                messages=[
                    {
                        "role": "user",
                        "content": (
                            "Here is the project's structured architecture (JSON). "
                            "Generate epics from it:\n\n" + architecture_json
                        ),
                    }
                ],
                output_format=EpicContent,
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
                "expected epic schema"
            )

        return response.parsed_output


def get_provider() -> EpicsProvider:
    api_key = get_anthropic_api_key("epic generation")
    return AnthropicEpicsProvider(api_key=api_key)
