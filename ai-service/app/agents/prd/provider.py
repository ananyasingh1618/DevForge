"""Provider abstraction for PRD generation.

`PrdProvider` is the seam a test double sits behind (see ai-service/tests/),
structured the same way as RequirementsProvider — a separate ABC, not a
shared generic one, since the input/output shapes genuinely differ (a
structured RequirementsContent in, a structured PrdContent out). Two real
implementations exist: GeminiPrdProvider and AnthropicPrdProvider — provider
selection (app/lib/provider_config.resolve_llm_provider) and the actual
structured-output call/error-mapping (app/lib/structured_llm) are shared
across every agent; only the system prompt and the input-formatting are
specific to this one. No fallback fabricates a result.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import anthropic
from google import genai

from app.lib.provider_config import resolve_llm_provider
from app.lib.structured_llm import call_anthropic_structured, call_gemini_structured
from app.schemas import PrdContent, RequirementsContent

ANTHROPIC_MODEL = "claude-opus-5"
GEMINI_MODEL = "gemini-3.6-flash"
MAX_OUTPUT_TOKENS = 8000

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


def _user_content(requirements: RequirementsContent) -> str:
    requirements_json = requirements.model_dump_json(indent=2)
    return (
        "Here is the project's structured requirements (JSON). "
        "Synthesize a PRD from it:\n\n" + requirements_json
    )


class PrdProvider(ABC):
    @abstractmethod
    def generate(self, requirements: RequirementsContent) -> PrdContent: ...


class AnthropicPrdProvider(PrdProvider):
    def __init__(self, api_key: str, model: str = ANTHROPIC_MODEL) -> None:
        self._client = anthropic.Anthropic(api_key=api_key)
        self._model = model

    def generate(self, requirements: RequirementsContent) -> PrdContent:
        return call_anthropic_structured(
            client=self._client,
            model=self._model,
            system_prompt=SYSTEM_PROMPT,
            user_content=_user_content(requirements),
            response_model=PrdContent,
            max_tokens=MAX_OUTPUT_TOKENS,
            invalid_response_detail=(
                "the model's output could not be parsed as valid JSON matching the "
                "expected PRD schema"
            ),
        )


class GeminiPrdProvider(PrdProvider):
    def __init__(self, api_key: str, model: str = GEMINI_MODEL) -> None:
        self._client = genai.Client(api_key=api_key)
        self._model = model

    def generate(self, requirements: RequirementsContent) -> PrdContent:
        return call_gemini_structured(
            client=self._client,
            model=self._model,
            system_prompt=SYSTEM_PROMPT,
            user_content=_user_content(requirements),
            response_model=PrdContent,
            max_tokens=MAX_OUTPUT_TOKENS,
            invalid_response_detail=(
                "the model's output could not be parsed as valid JSON matching the "
                "expected PRD schema"
            ),
        )


def get_provider() -> PrdProvider:
    provider_name, api_key = resolve_llm_provider("PRD generation")
    if provider_name == "gemini":
        return GeminiPrdProvider(api_key=api_key)
    return AnthropicPrdProvider(api_key=api_key)
