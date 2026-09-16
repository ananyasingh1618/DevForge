"""Tests for the shared structured-output helpers
(app/lib/structured_llm.py), focused on call_gemini_structured()'s bounded
retry for a transient Gemini ServerError. Observed live against a real
GEMINI_API_KEY: Gemini's free-tier flash models genuinely return a 503
"currently experiencing high demand" ServerError under real load, and the
exact same model/request succeeds on a retry seconds later — this is not a
hypothetical error shape. A 4xx ClientError (bad request, auth, rate limit)
is never transient in the same way and must never be retried.
"""

from unittest.mock import MagicMock

import pytest
from google.genai import errors as genai_errors
from pydantic import BaseModel

from app.errors import AIResponseInvalidError, ProviderRequestError
from app.lib import structured_llm


class _SampleModel(BaseModel):
    value: str


def _make_server_error(code: int = 503) -> genai_errors.ServerError:
    return genai_errors.ServerError(code, {"error": {"message": "high demand", "status": "UNAVAILABLE"}})


def _make_client_error(code: int) -> genai_errors.ClientError:
    return genai_errors.ClientError(code, {"error": {"message": "bad request", "status": "INVALID_ARGUMENT"}})


class TestCallGeminiStructuredRetry:
    def test_succeeds_without_retry_when_the_first_call_succeeds(self, monkeypatch):
        monkeypatch.setattr(structured_llm.time, "sleep", lambda _seconds: None)
        fake_response = MagicMock(parsed=_SampleModel(value="ok"))
        fake_client = MagicMock()
        fake_client.models.generate_content.side_effect = [fake_response]

        result = structured_llm.call_gemini_structured(
            client=fake_client,
            model="gemini-3.6-flash",
            system_prompt="system",
            user_content="content",
            response_model=_SampleModel,
            max_tokens=100,
            invalid_response_detail="invalid",
        )

        assert result == _SampleModel(value="ok")
        assert fake_client.models.generate_content.call_count == 1

    def test_retries_once_after_a_transient_server_error_then_succeeds(self, monkeypatch):
        sleep_calls: list[float] = []
        monkeypatch.setattr(structured_llm.time, "sleep", lambda seconds: sleep_calls.append(seconds))
        fake_response = MagicMock(parsed=_SampleModel(value="ok"))
        fake_client = MagicMock()
        fake_client.models.generate_content.side_effect = [_make_server_error(), fake_response]

        result = structured_llm.call_gemini_structured(
            client=fake_client,
            model="gemini-3.6-flash",
            system_prompt="system",
            user_content="content",
            response_model=_SampleModel,
            max_tokens=100,
            invalid_response_detail="invalid",
        )

        assert result == _SampleModel(value="ok")
        assert fake_client.models.generate_content.call_count == 2
        assert len(sleep_calls) == 1  # backed off exactly once, between the two attempts

    def test_raises_provider_request_error_after_exhausting_retries_on_repeated_server_errors(self, monkeypatch):
        monkeypatch.setattr(structured_llm.time, "sleep", lambda _seconds: None)
        fake_client = MagicMock()
        # GEMINI_SERVER_ERROR_RETRIES + 1 total attempts, all failing.
        fake_client.models.generate_content.side_effect = [
            _make_server_error() for _ in range(structured_llm.GEMINI_SERVER_ERROR_RETRIES + 1)
        ]

        with pytest.raises(ProviderRequestError):
            structured_llm.call_gemini_structured(
                client=fake_client,
                model="gemini-3.6-flash",
                system_prompt="system",
                user_content="content",
                response_model=_SampleModel,
                max_tokens=100,
                invalid_response_detail="invalid",
            )

        assert fake_client.models.generate_content.call_count == structured_llm.GEMINI_SERVER_ERROR_RETRIES + 1

    def test_never_retries_a_client_error(self, monkeypatch):
        monkeypatch.setattr(structured_llm.time, "sleep", lambda _seconds: None)
        fake_client = MagicMock()
        fake_client.models.generate_content.side_effect = [_make_client_error(400)]

        with pytest.raises(ProviderRequestError):
            structured_llm.call_gemini_structured(
                client=fake_client,
                model="gemini-3.6-flash",
                system_prompt="system",
                user_content="content",
                response_model=_SampleModel,
                max_tokens=100,
                invalid_response_detail="invalid",
            )

        # Exactly one attempt -- a 4xx is never treated as transient.
        assert fake_client.models.generate_content.call_count == 1

    def test_raises_ai_response_invalid_when_parsed_is_none(self, monkeypatch):
        monkeypatch.setattr(structured_llm.time, "sleep", lambda _seconds: None)
        fake_client = MagicMock()
        fake_client.models.generate_content.side_effect = [MagicMock(parsed=None)]

        with pytest.raises(AIResponseInvalidError):
            structured_llm.call_gemini_structured(
                client=fake_client,
                model="gemini-3.6-flash",
                system_prompt="system",
                user_content="content",
                response_model=_SampleModel,
                max_tokens=100,
                invalid_response_detail="the model's output did not match the schema",
            )
