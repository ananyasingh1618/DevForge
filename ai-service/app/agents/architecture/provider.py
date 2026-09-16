"""Provider abstraction for architecture generation.

`ArchitectureProvider` is the seam a test double sits behind (see
ai-service/tests/), structured the same way as PrdProvider — a separate ABC,
not a shared generic one, since the input/output shapes genuinely differ (a
structured PrdContent in, a structured ArchitectureContent out). Two real
implementations exist: GeminiArchitectureProvider and
AnthropicArchitectureProvider — provider selection
(app/lib/provider_config.resolve_llm_provider) and the actual
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
from app.schemas import ArchitectureContent, PrdContent

ANTHROPIC_MODEL = "claude-opus-5"
GEMINI_MODEL = "gemini-3.8-flash"
MAX_OUTPUT_TOKENS = 8000

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


def _user_content(prd: PrdContent) -> str:
    prd_json = prd.model_dump_json(indent=2)
    return "Here is the project's structured PRD (JSON). Generate a technical architecture from it:\n\n" + prd_json


class ArchitectureProvider(ABC):
    @abstractmethod
    def generate(self, prd: PrdContent) -> ArchitectureContent: ...


class AnthropicArchitectureProvider(ArchitectureProvider):
    def __init__(self, api_key: str, model: str = ANTHROPIC_MODEL) -> None:
        self._client = anthropic.Anthropic(api_key=api_key)
        self._model = model

    def generate(self, prd: PrdContent) -> ArchitectureContent:
        return call_anthropic_structured(
            client=self._client,
            model=self._model,
            system_prompt=SYSTEM_PROMPT,
            user_content=_user_content(prd),
            response_model=ArchitectureContent,
            max_tokens=MAX_OUTPUT_TOKENS,
            invalid_response_detail=(
                "the model's output could not be parsed as valid JSON matching the "
                "expected architecture schema"
            ),
        )


class GeminiArchitectureProvider(ArchitectureProvider):
    def __init__(self, api_key: str, model: str = GEMINI_MODEL) -> None:
        self._client = genai.Client(api_key=api_key)
        self._model = model

    def generate(self, prd: PrdContent) -> ArchitectureContent:
        return call_gemini_structured(
            client=self._client,
            model=self._model,
            system_prompt=SYSTEM_PROMPT,
            user_content=_user_content(prd),
            response_model=ArchitectureContent,
            max_tokens=MAX_OUTPUT_TOKENS,
            invalid_response_detail=(
                "the model's output could not be parsed as valid JSON matching the "
                "expected architecture schema"
            ),
        )


def get_provider() -> ArchitectureProvider:
    provider_name, api_key = resolve_llm_provider("architecture generation")
    if provider_name == "gemini":
        return GeminiArchitectureProvider(api_key=api_key)
    return AnthropicArchitectureProvider(api_key=api_key)
