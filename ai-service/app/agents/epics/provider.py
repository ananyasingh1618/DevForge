"""Provider abstraction for epic generation.

`EpicsProvider` is the seam a test double sits behind (see ai-service/tests/),
structured the same way as ArchitectureProvider — a separate ABC, not a
shared generic one, since the input/output shapes genuinely differ (a
structured ArchitectureContent in, a structured EpicContent out). Two real
implementations exist: GeminiEpicsProvider and AnthropicEpicsProvider —
provider selection (app/lib/provider_config.resolve_llm_provider) and the
actual structured-output call/error-mapping (app/lib/structured_llm) are
shared across every agent; only the system prompt and the input-formatting
are specific to this one. No fallback fabricates a result.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import anthropic
from google import genai

from app.lib.provider_config import resolve_llm_provider
from app.lib.structured_llm import call_anthropic_structured, call_gemini_structured
from app.schemas import ArchitectureContent, EpicContent

ANTHROPIC_MODEL = "claude-opus-5"
GEMINI_MODEL = "gemini-3.6-flash"
MAX_OUTPUT_TOKENS = 8000

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


def _user_content(architecture: ArchitectureContent) -> str:
    architecture_json = architecture.model_dump_json(indent=2)
    return "Here is the project's structured architecture (JSON). Generate epics from it:\n\n" + architecture_json


class EpicsProvider(ABC):
    @abstractmethod
    def generate(self, architecture: ArchitectureContent) -> EpicContent: ...


class AnthropicEpicsProvider(EpicsProvider):
    def __init__(self, api_key: str, model: str = ANTHROPIC_MODEL) -> None:
        self._client = anthropic.Anthropic(api_key=api_key)
        self._model = model

    def generate(self, architecture: ArchitectureContent) -> EpicContent:
        return call_anthropic_structured(
            client=self._client,
            model=self._model,
            system_prompt=SYSTEM_PROMPT,
            user_content=_user_content(architecture),
            response_model=EpicContent,
            max_tokens=MAX_OUTPUT_TOKENS,
            invalid_response_detail=(
                "the model's output could not be parsed as valid JSON matching the "
                "expected epic schema"
            ),
        )


class GeminiEpicsProvider(EpicsProvider):
    def __init__(self, api_key: str, model: str = GEMINI_MODEL) -> None:
        self._client = genai.Client(api_key=api_key)
        self._model = model

    def generate(self, architecture: ArchitectureContent) -> EpicContent:
        return call_gemini_structured(
            client=self._client,
            model=self._model,
            system_prompt=SYSTEM_PROMPT,
            user_content=_user_content(architecture),
            response_model=EpicContent,
            max_tokens=MAX_OUTPUT_TOKENS,
            invalid_response_detail=(
                "the model's output could not be parsed as valid JSON matching the "
                "expected epic schema"
            ),
        )


def get_provider() -> EpicsProvider:
    provider_name, api_key = resolve_llm_provider("epic generation")
    if provider_name == "gemini":
        return GeminiEpicsProvider(api_key=api_key)
    return AnthropicEpicsProvider(api_key=api_key)
