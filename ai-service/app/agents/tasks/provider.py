"""Provider abstraction for task generation.

`TasksProvider` is the seam a test double sits behind (see ai-service/tests/),
structured the same way as EpicsProvider — a separate ABC, not a shared
generic one, since the input/output shapes genuinely differ (a structured
EpicContent in, a structured TaskContent out). Two real implementations
exist: GeminiTasksProvider and AnthropicTasksProvider — provider selection
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
from app.schemas import EpicContent, TaskContent

ANTHROPIC_MODEL = "claude-opus-5"
GEMINI_MODEL = "gemini-3.8-flash"
MAX_OUTPUT_TOKENS = 8000

SYSTEM_PROMPT = """You are the task-generation agent for DevForge, an AI software engineering \
workspace. Given a project's structured epics (already broken down: id, title, description, \
objective, business value, scope, acceptance criteria, dependencies, related components), \
break each epic's scope into concrete, actionable development tasks.

Rules:
- "id": a stable short id per task, e.g. "T-1", "T-2", unique within the response.
- "title": short, specific, actionable (what a developer would pick up and do).
- "description": what the task involves, in prose.
- "type": "feature" for new functionality, "bug" only if the given epics describe a defect to \
fix, "chore" for setup/infra/non-functional work — pick the type that best matches the task's \
actual nature, don't default to "feature" for everything.
- "priority": "high", "medium", or "low", grounded in the source epic's own priority signals \
(business value, dependencies) — not arbitrary.
- "acceptance_criteria": concrete, checkable conditions for this task being done.
- "dependencies": ids of other tasks in this same response that must complete first, if any.
- "epic_id": must be exactly one of the given epics' "id" values — never invent an epic id.
- "related_component": a single architecture component name from the source epic's own \
"related_components", if applicable — leave empty if none applies.
- "estimated_complexity": "small", "medium", or "large" — a coarse, defensible estimate, not \
a precise story-point count.
- "suggested_order": an integer giving this task's suggested position in an implementation \
sequence across the *entire* response (not per-epic), respecting the declared dependencies.
- Stay within each source epic's stated scope — do not invent work outside what the epic \
describes."""


def _user_content(epics: EpicContent) -> str:
    epics_json = epics.model_dump_json(indent=2)
    return "Here are the project's structured epics (JSON). Generate tasks from them:\n\n" + epics_json


class TasksProvider(ABC):
    @abstractmethod
    def generate(self, epics: EpicContent) -> TaskContent: ...


class AnthropicTasksProvider(TasksProvider):
    def __init__(self, api_key: str, model: str = ANTHROPIC_MODEL) -> None:
        self._client = anthropic.Anthropic(api_key=api_key)
        self._model = model

    def generate(self, epics: EpicContent) -> TaskContent:
        return call_anthropic_structured(
            client=self._client,
            model=self._model,
            system_prompt=SYSTEM_PROMPT,
            user_content=_user_content(epics),
            response_model=TaskContent,
            max_tokens=MAX_OUTPUT_TOKENS,
            invalid_response_detail=(
                "the model's output could not be parsed as valid JSON matching the "
                "expected task schema"
            ),
        )


class GeminiTasksProvider(TasksProvider):
    def __init__(self, api_key: str, model: str = GEMINI_MODEL) -> None:
        self._client = genai.Client(api_key=api_key)
        self._model = model

    def generate(self, epics: EpicContent) -> TaskContent:
        return call_gemini_structured(
            client=self._client,
            model=self._model,
            system_prompt=SYSTEM_PROMPT,
            user_content=_user_content(epics),
            response_model=TaskContent,
            max_tokens=MAX_OUTPUT_TOKENS,
            invalid_response_detail=(
                "the model's output could not be parsed as valid JSON matching the "
                "expected task schema"
            ),
        )


def get_provider() -> TasksProvider:
    provider_name, api_key = resolve_llm_provider("task generation")
    if provider_name == "gemini":
        return GeminiTasksProvider(api_key=api_key)
    return AnthropicTasksProvider(api_key=api_key)
