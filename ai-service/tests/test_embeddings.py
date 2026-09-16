"""Tests for POST /embeddings/generate and the Voyage-backed provider.

The "provider not configured" case runs for real against this environment's
actual (unset) VOYAGE_API_KEY — no mocking needed, mirroring every other
agent's own test file. Router-level success/failure-after-configured cases
use FakeEmbeddingProvider, a clearly-named test double injected via
monkeypatch. Provider-level tests exercise VoyageEmbeddingProvider directly
against a monkeypatched httpx.post — this is the one agent whose real
implementation talks HTTP directly rather than through the anthropic SDK, so
its own request/response handling gets its own direct coverage, the way
app/parsing/parser.py's tree-sitter logic got direct coverage in Phase 7.
"""

import os

import httpx
import pytest
from fastapi.testclient import TestClient

from app.agents.embeddings import provider as provider_module
from app.errors import AIResponseInvalidError, ProviderRequestError
from main import app

client = TestClient(app)


class FakeEmbeddingProvider(provider_module.EmbeddingProvider):
    """Test double only — never used outside this test file."""

    def __init__(
        self,
        vectors: list[list[float]] | None = None,
        error: Exception | None = None,
        model: str = "voyage-code-3",
        dimensions: int = 4,
    ):
        self._vectors = vectors
        self._error = error
        self._model = model
        self._dimensions = dimensions

    def embed(self, texts: list[str], input_type: str) -> tuple[str, int, list[list[float]]]:
        if self._error is not None:
            raise self._error
        assert self._vectors is not None
        return self._model, self._dimensions, self._vectors


def test_health_still_works():
    res = client.get("/health")
    assert res.status_code == 200


def test_generate_rejects_empty_texts_with_400():
    res = client.post("/embeddings/generate", json={"texts": []})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


def test_generate_rejects_invalid_input_type_with_400():
    res = client.post("/embeddings/generate", json={"texts": ["hello"], "input_type": "nonsense"})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


def test_generate_returns_503_when_provider_not_configured():
    # Real, unmocked: this environment genuinely has no VOYAGE_API_KEY.
    assert "VOYAGE_API_KEY" not in os.environ
    res = client.post("/embeddings/generate", json={"texts": ["function add(a, b) { return a + b; }"]})
    assert res.status_code == 503
    body = res.json()["error"]
    assert body["code"] == "PROVIDER_NOT_CONFIGURED"
    assert "VOYAGE_API_KEY" in body["message"]


def test_generate_returns_vectors_from_a_configured_provider(monkeypatch):
    vectors = [[0.1, 0.2, 0.3, 0.4], [0.5, 0.6, 0.7, 0.8]]
    monkeypatch.setattr(
        provider_module, "get_provider", lambda: FakeEmbeddingProvider(vectors=vectors)
    )
    res = client.post(
        "/embeddings/generate",
        json={"texts": ["function add(a, b) {}", "class Foo {}"], "input_type": "document"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["model"] == "voyage-code-3"
    assert body["dimensions"] == 4
    assert body["embeddings"] == vectors


def test_generate_defaults_input_type_to_document(monkeypatch):
    monkeypatch.setattr(
        provider_module, "get_provider", lambda: FakeEmbeddingProvider(vectors=[[0.0, 0.0, 0.0, 0.0]])
    )
    res = client.post("/embeddings/generate", json={"texts": ["hello"]})
    assert res.status_code == 200


def test_generate_surfaces_provider_request_error_as_502(monkeypatch):
    monkeypatch.setattr(
        provider_module,
        "get_provider",
        lambda: FakeEmbeddingProvider(error=ProviderRequestError("rate limited")),
    )
    res = client.post("/embeddings/generate", json={"texts": ["hello"]})
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "AI_PROVIDER_ERROR"


def test_generate_surfaces_ai_response_invalid_as_502(monkeypatch):
    monkeypatch.setattr(
        provider_module,
        "get_provider",
        lambda: FakeEmbeddingProvider(error=AIResponseInvalidError("unexpected vector shape")),
    )
    res = client.post("/embeddings/generate", json={"texts": ["hello"]})
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "AI_RESPONSE_INVALID"


# --- VoyageEmbeddingProvider itself, against a monkeypatched httpx.post ---


class FakeHttpxResponse:
    def __init__(self, status_code: int, body: dict):
        self.status_code = status_code
        self._body = body
        self.text = str(body)

    def json(self):
        return self._body


def _voyage_success_body(vectors: list[list[float]]) -> dict:
    return {
        "object": "list",
        "data": [{"object": "embedding", "embedding": v, "index": i} for i, v in enumerate(vectors)],
        "model": "voyage-code-3",
        "usage": {"total_tokens": 42},
    }


class TestVoyageEmbeddingProvider:
    def test_returns_vectors_in_request_order_even_if_response_is_out_of_order(self, monkeypatch):
        vectors = [[0.1] * 1024, [0.2] * 1024]
        body = _voyage_success_body(vectors)
        body["data"] = list(reversed(body["data"]))  # out of order on the wire
        monkeypatch.setattr(httpx, "post", lambda *a, **k: FakeHttpxResponse(200, body))

        provider = provider_module.VoyageEmbeddingProvider(api_key="fake-key")
        model, dimensions, embeddings = provider.embed(["a", "b"], "document")
        assert model == "voyage-code-3"
        assert dimensions == 1024
        assert embeddings == vectors

    def test_rejects_a_vector_with_the_wrong_dimensions(self, monkeypatch):
        body = _voyage_success_body([[0.1, 0.2, 0.3]])  # only 3 dims, not 1024
        monkeypatch.setattr(httpx, "post", lambda *a, **k: FakeHttpxResponse(200, body))

        provider = provider_module.VoyageEmbeddingProvider(api_key="fake-key")
        with pytest.raises(AIResponseInvalidError):
            provider.embed(["a"], "document")

    def test_rejects_a_response_with_the_wrong_number_of_vectors(self, monkeypatch):
        body = _voyage_success_body([[0.1] * 1024])  # one vector, two texts sent
        monkeypatch.setattr(httpx, "post", lambda *a, **k: FakeHttpxResponse(200, body))

        provider = provider_module.VoyageEmbeddingProvider(api_key="fake-key")
        with pytest.raises(AIResponseInvalidError):
            provider.embed(["a", "b"], "document")

    def test_maps_401_to_an_authentication_error(self, monkeypatch):
        monkeypatch.setattr(
            httpx, "post", lambda *a, **k: FakeHttpxResponse(401, {"detail": "Provided API key is invalid."})
        )
        provider = provider_module.VoyageEmbeddingProvider(api_key="fake-key")
        with pytest.raises(ProviderRequestError, match="Authentication"):
            provider.embed(["a"], "document")

    def test_maps_429_to_a_rate_limit_error_after_exhausting_retries(self, monkeypatch):
        monkeypatch.setattr(provider_module.time, "sleep", lambda _seconds: None)
        calls = []
        monkeypatch.setattr(
            httpx,
            "post",
            lambda *a, **k: (calls.append(1), FakeHttpxResponse(429, {"detail": "rate limited"}))[1],
        )
        provider = provider_module.VoyageEmbeddingProvider(api_key="fake-key")
        with pytest.raises(ProviderRequestError, match="rate-limited"):
            provider.embed(["a"], "document")
        # Real, live condition (a no-payment-method Voyage account, capped
        # at 3 requests/minute) — see the module's own docstring. This
        # proves the bounded retry actually happened, not just that the
        # final error surfaces correctly.
        assert len(calls) == provider_module.RATE_LIMIT_RETRIES + 1

    def test_retries_a_429_with_backoff_then_succeeds(self, monkeypatch):
        sleep_calls = []
        monkeypatch.setattr(provider_module.time, "sleep", lambda seconds: sleep_calls.append(seconds))
        responses = [
            FakeHttpxResponse(429, {"detail": "rate limited"}),
            FakeHttpxResponse(200, _voyage_success_body([[0.1] * 1024])),
        ]
        monkeypatch.setattr(httpx, "post", lambda *a, **k: responses.pop(0))
        provider = provider_module.VoyageEmbeddingProvider(api_key="fake-key")

        model, dimensions, embeddings = provider.embed(["a"], "document")

        assert len(embeddings) == 1
        assert sleep_calls == [provider_module.RATE_LIMIT_BACKOFF_SECONDS]

    def test_never_retries_a_401(self, monkeypatch):
        monkeypatch.setattr(provider_module.time, "sleep", lambda _seconds: None)
        calls = []
        monkeypatch.setattr(
            httpx,
            "post",
            lambda *a, **k: (calls.append(1), FakeHttpxResponse(401, {"detail": "invalid key"}))[1],
        )
        provider = provider_module.VoyageEmbeddingProvider(api_key="fake-key")
        with pytest.raises(ProviderRequestError, match="Authentication"):
            provider.embed(["a"], "document")
        assert len(calls) == 1

    def test_maps_a_network_failure_to_a_provider_request_error(self, monkeypatch):
        def raise_request_error(*_args, **_kwargs):
            raise httpx.RequestError("connection refused")

        monkeypatch.setattr(httpx, "post", raise_request_error)
        provider = provider_module.VoyageEmbeddingProvider(api_key="fake-key")
        with pytest.raises(ProviderRequestError, match="Could not reach"):
            provider.embed(["a"], "document")


@pytest.fixture(autouse=True)
def _no_leaked_env(monkeypatch):
    monkeypatch.delenv("VOYAGE_API_KEY", raising=False)
