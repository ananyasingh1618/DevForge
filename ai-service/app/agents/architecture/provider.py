"""Provider abstraction for architecture generation.

`ArchitectureProvider` is the seam a test double sits behind (see
ai-service/tests/), structured the same way as PrdProvider — a separate ABC,
not a shared generic one, since the input/output shapes genuinely differ (a
structured PrdContent in, a structured ArchitectureContent out). What *is*
shared, concretely: reading ANTHROPIC_API_KEY and raising
ProviderNotConfiguredError (app/lib/provider_config.py), and the same
typed-exception-to-ProviderRequestError chain. Only one real implementation
exists: AnthropicArchitectureProvider, using Claude (claude-opus-5) via
structured outputs. No fallback fabricates a result.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import anthropic

from app.errors import AIResponseInvalidError, ProviderRequestError
from app.lib.provider_config import get_anthropic_api_key
from app.schemas import ArchitectureContent, PrdContent

MODEL = "claude-opus-5"

SYSTEM_PROMPT = """You are the architecture-generation agent for DevForge, an AI software \
engineering workspace. Given a project's structured PRD (already synthesized: overview, \
problem statement, goals, personas, functional and non-functional requirements, user \
workflows, edge cases, success criteria, constraints, assumptions, open questions), produce a \
technical architecture proposal for building it.

Rules:
- "overview": 2-4 sentences framing the proposed architecture and the reasoning behind its \
overall shape, in your own words.
- "system_architecture": the overall architectural pattern/style (e.g. monolith, modular \
monolith, microservices, event-driven) and how the major pieces fit together, in prose.
- "technology_stack": concrete technology choices, each with a brief rationale grounded in the \
PRD's functional/non-functional requirements — do not pick technologies the PRD gives no \
basis for.
- "components": the major components/services and each one's responsibility.
- "data_model": the key entities and how they relate to each other.
- "api_design": the key API contracts/patterns the system will expose.
- "data_flows": how data moves through the system for the PRD's key user workflows.
- "security": concrete security measures relevant to this system's requirements.
- "scalability": scalability considerations relevant to this system's expected usage.
- "deployment": a deployment/infrastructure approach appropriate to this system's scale and \
constraints.
- "tradeoffs": the significant architectural tradeoffs made and why, grounded in the PRD's own \
constraints and goals.
- "assumptions" / "open_questions": carry forward and sharpen the PRD's own constraints/ \
assumptions/open questions where they still apply to architecture decisions; add new ones only \
if the architecture synthesis genuinely surfaces them.
- Do not invent technology choices, integrations, or infrastructure unsupported by the given \
PRD's stated requirements, constraints, and assumptions."""


class ArchitectureProvider(ABC):
    @abstractmethod
    def generate(self, prd: PrdContent) -> ArchitectureContent: ...


class AnthropicArchitectureProvider(ArchitectureProvider):
    def __init__(self, api_key: str, model: str = MODEL) -> None:
        self._client = anthropic.Anthropic(api_key=api_key)
        self._model = model

    def generate(self, prd: PrdContent) -> ArchitectureContent:
        prd_json = prd.model_dump_json(indent=2)
        try:
            response = self._client.messages.parse(
                model=self._model,
                max_tokens=8000,
                system=SYSTEM_PROMPT,
                messages=[
                    {
                        "role": "user",
                        "content": (
                            "Here is the project's structured PRD (JSON). "
                            "Generate a technical architecture from it:\n\n" + prd_json
                        ),
                    }
                ],
                output_format=ArchitectureContent,
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
                "expected architecture schema"
            )

        return response.parsed_output


def get_provider() -> ArchitectureProvider:
    api_key = get_anthropic_api_key("architecture generation")
    return AnthropicArchitectureProvider(api_key=api_key)
