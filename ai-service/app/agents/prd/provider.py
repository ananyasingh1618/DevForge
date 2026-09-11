"""Provider abstraction for PRD generation.

`PrdProvider` is the seam a test double sits behind (see ai-service/tests/),
structured the same way as RequirementsProvider — a separate ABC, not a
shared generic one, since the input/output shapes genuinely differ (a
structured RequirementsContent in, a structured PrdContent out). What
*is* shared, concretely: reading ANTHROPIC_API_KEY and raising
ProviderNotConfiguredError (app/lib/provider_config.py), and the same
typed-exception-to-ProviderRequestError chain. Only one real implementation
exists: AnthropicPrdProvider, using Claude (claude-opus-5) via structured
outputs. No fallback fabricates a result.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import anthropic

from app.errors import AIResponseInvalidError, ProviderRequestError
from app.lib.provider_config import get_anthropic_api_key
from app.schemas import PrdContent, RequirementsContent

MODEL = "claude-opus-5"

SYSTEM_PROMPT = """You are the PRD-generation agent for DevForge, an AI software engineering \
workspace. Given a project's structured requirements (already analyzed: functional and \
non-functional requirements, constraints, assumptions, open questions), synthesize a proper \
Product Requirements Document — do not simply restate the requirements list.

Rules:
- "overview": 2-4 sentences framing the problem and the proposed solution together, in your \
own words, not copied from the requirements' project summary.
- "problem_statement": the underlying problem this project solves, stated plainly.
- "goals": what success looks like, as outcomes, not features.
- "personas": who uses this and why, synthesized from the requirements' "users" list and the \
functional requirements — brief persona-style descriptions, not a bare list of role names.
- "functional_requirements" / "non_functional_requirements": a PRD-level synthesis (prose \
bullet points, not the same rigid per-item structure the input requirements use) — group, \
summarize, and prioritize; do not just copy titles verbatim.
- "user_workflows": key end-to-end scenarios a user goes through, inferred from the \
functional requirements.
- "edge_cases": failure modes and unusual situations genuinely worth calling out — grounded \
in the given requirements/constraints, not invented for volume.
- "success_criteria": concrete, measurable signals that the product is working.
- "constraints" / "assumptions" / "open_questions": carry forward and sharpen the input's own \
constraints/assumptions/open questions where they still apply; add new ones only if the PRD \
synthesis genuinely surfaces them.
- Do not invent business/domain details beyond what the given requirements support."""


class PrdProvider(ABC):
    @abstractmethod
    def generate(self, requirements: RequirementsContent) -> PrdContent: ...


class AnthropicPrdProvider(PrdProvider):
    def __init__(self, api_key: str, model: str = MODEL) -> None:
        self._client = anthropic.Anthropic(api_key=api_key)
        self._model = model

    def generate(self, requirements: RequirementsContent) -> PrdContent:
        requirements_json = requirements.model_dump_json(indent=2)
        try:
            response = self._client.messages.parse(
                model=self._model,
                max_tokens=8000,
                system=SYSTEM_PROMPT,
                messages=[
                    {
                        "role": "user",
                        "content": (
                            "Here is the project's structured requirements (JSON). "
                            "Synthesize a PRD from it:\n\n" + requirements_json
                        ),
                    }
                ],
                output_format=PrdContent,
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
                "expected PRD schema"
            )

        return response.parsed_output


def get_provider() -> PrdProvider:
    api_key = get_anthropic_api_key("PRD generation")
    return AnthropicPrdProvider(api_key=api_key)
