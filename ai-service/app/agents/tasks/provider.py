"""Provider abstraction for task generation.

`TasksProvider` is the seam a test double sits behind (see ai-service/tests/),
structured the same way as EpicsProvider — a separate ABC, not a shared
generic one, since the input/output shapes genuinely differ (a structured
EpicContent in, a structured TaskContent out). What *is* shared, concretely:
reading ANTHROPIC_API_KEY and raising ProviderNotConfiguredError
(app/lib/provider_config.py), and the same typed-exception-to-
ProviderRequestError chain. Only one real implementation exists:
AnthropicTasksProvider, using Claude (claude-opus-5) via structured outputs.
No fallback fabricates a result.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import anthropic

from app.errors import AIResponseInvalidError, ProviderRequestError
from app.lib.provider_config import get_anthropic_api_key
from app.schemas import EpicContent, TaskContent

MODEL = "claude-opus-5"

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


class TasksProvider(ABC):
    @abstractmethod
    def generate(self, epics: EpicContent) -> TaskContent: ...


class AnthropicTasksProvider(TasksProvider):
    def __init__(self, api_key: str, model: str = MODEL) -> None:
        self._client = anthropic.Anthropic(api_key=api_key)
        self._model = model

    def generate(self, epics: EpicContent) -> TaskContent:
        epics_json = epics.model_dump_json(indent=2)
        try:
            response = self._client.messages.parse(
                model=self._model,
                max_tokens=8000,
                system=SYSTEM_PROMPT,
                messages=[
                    {
                        "role": "user",
                        "content": (
                            "Here are the project's structured epics (JSON). "
                            "Generate tasks from them:\n\n" + epics_json
                        ),
                    }
                ],
                output_format=TaskContent,
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
                "expected task schema"
            )

        return response.parsed_output


def get_provider() -> TasksProvider:
    api_key = get_anthropic_api_key("task generation")
    return AnthropicTasksProvider(api_key=api_key)
