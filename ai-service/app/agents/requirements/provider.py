"""Provider abstraction for requirements analysis.

`RequirementsProvider` is the seam a test double sits behind (see
ai-service/tests/), and where a second real provider was added without
touching the router. Two real implementations exist: GeminiRequirementsProvider
(Gemini, via the google-genai SDK's structured output) and
AnthropicRequirementsProvider (Claude, via Anthropic's structured outputs) —
both go through the same Pydantic RequirementsContent schema, so a caller
never sees a difference in shape regardless of which provider answered.
get_provider() picks between them via provider_config.resolve_llm_provider():
Gemini is preferred whenever GEMINI_API_KEY is set (it has a genuinely free
tier), Anthropic is used when only ANTHROPIC_API_KEY is set. There is no
fallback that fabricates a result — every failure path (no key configured,
provider error, invalid output) raises a typed error instead.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import anthropic
from google import genai

from app.lib.provider_config import resolve_llm_provider
from app.lib.structured_llm import call_anthropic_structured, call_gemini_structured
from app.schemas import RequirementsContent

ANTHROPIC_MODEL = "claude-opus-5"
GEMINI_MODEL = "gemini-3.8-flash"
MAX_OUTPUT_TOKENS = 8000

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
- List the user roles this system serves in "users" (e.g. "Admin", "End customer") — every \
role you name should actually be used by at least one requirement below.
- List short, user-facing feature names in "features" (e.g. "Email notifications", \
"CSV export") — distinct from the detailed functional-requirement items above; a feature \
name is a few words, not a full requirement description. Every feature should be traceable \
to at least one functional requirement.
- List concrete project/technical/product risks in "risks" (e.g. "Third-party payment \
provider outage would block checkout", "Scope is ambiguous around multi-tenant support") — \
these are risks to flag and manage, not questions to ask the user.
- List open questions genuinely worth asking the user in "open_questions" — distinct from \
risks; a risk is something that could go wrong, an open question is something you need the \
user to clarify.
- Keep the project summary to 2-4 sentences.
- Do not invent business/domain details that were not stated and are not reasonable, \
low-risk inferences a competent engineer would make from the idea alone."""


class RequirementsProvider(ABC):
    @abstractmethod
    def analyze(self, idea: str) -> RequirementsContent: ...


class AnthropicRequirementsProvider(RequirementsProvider):
    def __init__(self, api_key: str, model: str = ANTHROPIC_MODEL) -> None:
        self._client = anthropic.Anthropic(api_key=api_key)
        self._model = model

    def analyze(self, idea: str) -> RequirementsContent:
        return call_anthropic_structured(
            client=self._client,
            model=self._model,
            system_prompt=SYSTEM_PROMPT,
            user_content=idea,
            response_model=RequirementsContent,
            max_tokens=MAX_OUTPUT_TOKENS,
            invalid_response_detail=(
                "the model's output could not be parsed as valid JSON matching the "
                "expected requirements schema"
            ),
        )


class GeminiRequirementsProvider(RequirementsProvider):
    def __init__(self, api_key: str, model: str = GEMINI_MODEL) -> None:
        self._client = genai.Client(api_key=api_key)
        self._model = model

    def analyze(self, idea: str) -> RequirementsContent:
        return call_gemini_structured(
            client=self._client,
            model=self._model,
            system_prompt=SYSTEM_PROMPT,
            user_content=idea,
            response_model=RequirementsContent,
            max_tokens=MAX_OUTPUT_TOKENS,
            invalid_response_detail=(
                "the model's output could not be parsed as valid JSON matching the "
                "expected requirements schema"
            ),
        )


def get_provider() -> RequirementsProvider:
    provider_name, api_key = resolve_llm_provider("requirements analysis")
    if provider_name == "gemini":
        return GeminiRequirementsProvider(api_key=api_key)
    return AnthropicRequirementsProvider(api_key=api_key)
