"""Shared structured-output call helpers for both supported LLM providers
(Anthropic and Gemini). Every agent's provider.py (requirements, prd,
architecture, epics, tasks, qa, review) previously copy-pasted the same
~25-line Anthropic try/except block; this factors out exactly that — and its
new Gemini equivalent — so there is one tested implementation of each
provider's error mapping, not seven. Each agent still owns everything
domain-specific: its own system prompt, its own Pydantic response schema,
how it builds the user-facing content string from its own inputs, and
constructing its own client (so a test can substitute a fake client onto a
provider instance before calling it, exactly as agents already did before
Gemini support existed — see e.g. tests/test_qa.py's
`provider._client = _FakeAnthropicClient(...)` pattern, unchanged by this
refactor).

Neither function fabricates a result on any failure path — a missing/
invalid response always raises AIResponseInvalidError, and any provider-side
failure (auth, rate limit, bad request, unreachable) always raises
ProviderRequestError. There is no silent fallback from one provider to the
other inside a single call: which provider is used is decided once, before
either of these is called, by provider_config.resolve_llm_provider().
"""

from __future__ import annotations

import time
from typing import TypeVar

import anthropic
from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types
from pydantic import BaseModel

from app.errors import AIResponseInvalidError, ProviderRequestError

T = TypeVar("T", bound=BaseModel)

# Gemini's free-tier flash models genuinely return a transient 503
# "currently experiencing high demand" ServerError under real load —
# observed live, not hypothetical (Google's own message: "Spikes in demand
# are usually temporary. Please try again later."). A short, bounded retry
# for exactly this one error shape turns a real but transient capacity blip
# into a normal, successful response instead of surfacing it to the user on
# the first try. Nothing else is retried here — a 4xx ClientError (bad
# request, auth, rate limit) is never transient in the same way and is
# still raised immediately.
GEMINI_SERVER_ERROR_RETRIES = 2
GEMINI_SERVER_ERROR_BACKOFF_SECONDS = (1, 2)

# Bug found live (Phase "Gemini workflow" verification): without an explicit
# per-call timeout, a single generate_content() call has no bound at all —
# under real degraded conditions it can hang well past the Node API's own
# 60s fetch timeout (api/src/lib/aiServiceClient.ts), which then aborts and
# reports a misleading AI_SERVICE_UNREACHABLE even though ai-service was
# still working, not actually unreachable. A 25s per-call timeout keeps a
# single attempt bounded; combined with the bounded retry above, the
# worst case (25s + 1s + 25s + 2s + 25s = 78s) still fits comfortably
# under aiServiceClient.ts's increased LLM-call timeout (100s — see its own
# comment on why it differs from the default 60s).
GEMINI_HTTP_TIMEOUT_MS = 25_000


def call_anthropic_structured(
    *,
    client: anthropic.Anthropic,
    model: str,
    system_prompt: str,
    user_content: str,
    response_model: type[T],
    max_tokens: int,
    invalid_response_detail: str,
) -> T:
    try:
        response = client.messages.parse(
            model=model,
            max_tokens=max_tokens,
            system=system_prompt,
            messages=[{"role": "user", "content": user_content}],
            output_format=response_model,
        )
    except anthropic.BadRequestError as e:
        raise ProviderRequestError(f"The AI provider rejected the request: {e.message}") from e
    except anthropic.AuthenticationError as e:
        raise ProviderRequestError(f"Authentication with the AI provider failed: {e.message}") from e
    except anthropic.PermissionDeniedError as e:
        raise ProviderRequestError(f"The AI provider denied access to this model: {e.message}") from e
    except anthropic.NotFoundError as e:
        raise ProviderRequestError(f"The AI provider model was not found: {e.message}") from e
    except anthropic.RateLimitError as e:
        raise ProviderRequestError(f"The AI provider rate-limited this request: {e.message}") from e
    except anthropic.APIStatusError as e:
        raise ProviderRequestError(f"The AI provider returned an error: {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise ProviderRequestError(f"Could not reach the AI provider: {e}") from e

    if response.parsed_output is None:
        raise AIResponseInvalidError(invalid_response_detail)

    return response.parsed_output


def call_gemini_structured(
    *,
    client: genai.Client,
    model: str,
    system_prompt: str,
    user_content: str,
    response_model: type[T],
    max_tokens: int,
    invalid_response_detail: str,
) -> T:
    response = None
    last_server_error: genai_errors.ServerError | None = None
    for attempt in range(GEMINI_SERVER_ERROR_RETRIES + 1):
        try:
            response = client.models.generate_content(
                model=model,
                contents=user_content,
                config=genai_types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    response_mime_type="application/json",
                    response_schema=response_model,
                    max_output_tokens=max_tokens,
                    http_options=genai_types.HttpOptions(timeout=GEMINI_HTTP_TIMEOUT_MS),
                ),
            )
            break
        except genai_errors.ClientError as e:
            if e.code in (401, 403):
                raise ProviderRequestError(f"Authentication with the AI provider failed: {e.message}") from e
            if e.code == 429:
                raise ProviderRequestError(f"The AI provider rate-limited this request: {e.message}") from e
            raise ProviderRequestError(f"The AI provider rejected the request: {e.message}") from e
        except genai_errors.ServerError as e:
            last_server_error = e
            if attempt < GEMINI_SERVER_ERROR_RETRIES:
                time.sleep(GEMINI_SERVER_ERROR_BACKOFF_SECONDS[attempt])
                continue
            raise ProviderRequestError(f"The AI provider returned an error: {e.message}") from e
        except genai_errors.APIError as e:
            raise ProviderRequestError(f"The AI provider returned an error: {e.message}") from e
        except Exception as e:  # network/connection failures etc. — never leaked raw to the client
            raise ProviderRequestError(f"Could not reach the AI provider: {e}") from e

    if response is None:
        # Unreachable in practice (the loop above always either returns via
        # break or raises), but keeps the type checker honest and fails
        # loudly instead of silently if that ever stops being true.
        raise ProviderRequestError(
            f"The AI provider returned an error: {last_server_error.message if last_server_error else 'unknown error'}"
        )

    parsed = response.parsed
    if parsed is None:
        raise AIResponseInvalidError(invalid_response_detail)

    return parsed
