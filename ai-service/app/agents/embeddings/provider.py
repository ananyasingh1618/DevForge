"""Provider abstraction for embedding generation.

`EmbeddingProvider` is the seam a test double sits behind (see
ai-service/tests/), mirroring every other agent's provider.py. Only one real
implementation exists: VoyageEmbeddingProvider, calling Voyage AI's
`voyage-code-3` model (a code-retrieval-specific embedding model) directly
over HTTP — Voyage has no first-party Python SDK dependency already present
in this project, and a raw `httpx` call is a thinner boundary than adding
one. There is no fallback that fabricates a vector — every failure path (no
key configured, provider error, malformed response) raises a typed error
instead.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import httpx

from app.errors import AIResponseInvalidError, ProviderRequestError
from app.lib.provider_config import get_voyage_api_key

VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings"
MODEL = "voyage-code-3"
DIMENSIONS = 1024


class EmbeddingProvider(ABC):
    @abstractmethod
    def embed(self, texts: list[str], input_type: str) -> tuple[str, int, list[list[float]]]:
        """Returns (model, dimensions, embeddings) — embeddings in the same
        order as `texts`."""
        ...


class VoyageEmbeddingProvider(EmbeddingProvider):
    def __init__(self, api_key: str, model: str = MODEL, dimensions: int = DIMENSIONS) -> None:
        self._api_key = api_key
        self._model = model
        self._dimensions = dimensions

    def embed(self, texts: list[str], input_type: str) -> tuple[str, int, list[list[float]]]:
        try:
            response = httpx.post(
                VOYAGE_API_URL,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "input": texts,
                    "model": self._model,
                    "input_type": input_type,
                    "output_dimension": self._dimensions,
                },
                timeout=30.0,
            )
        except httpx.RequestError as e:
            raise ProviderRequestError(f"Could not reach the embedding provider: {e}") from e

        if response.status_code != 200:
            raise ProviderRequestError(_error_message_for(response))

        body = response.json()
        data = body.get("data")
        if not isinstance(data, list) or len(data) != len(texts):
            raise AIResponseInvalidError(
                "the embedding provider returned a different number of vectors than texts sent"
            )

        # Defensive: sort by the provider's own reported index rather than
        # assuming response order matches request order.
        try:
            ordered = sorted(data, key=lambda item: item["index"])
            embeddings = [item["embedding"] for item in ordered]
        except (KeyError, TypeError) as e:
            raise AIResponseInvalidError(
                "the embedding provider's response did not match the expected shape"
            ) from e

        for embedding in embeddings:
            if not isinstance(embedding, list) or len(embedding) != self._dimensions:
                raise AIResponseInvalidError(
                    f"the embedding provider returned a vector with an unexpected dimension "
                    f"(expected {self._dimensions})"
                )

        return self._model, self._dimensions, embeddings


def _error_message_for(response: httpx.Response) -> str:
    try:
        detail = response.json().get("detail")
    except ValueError:
        detail = None
    reason = detail or response.text or f"HTTP {response.status_code}"
    if response.status_code == 401:
        return f"Authentication with the embedding provider failed: {reason}"
    if response.status_code == 429:
        return f"The embedding provider rate-limited this request: {reason}"
    if response.status_code == 400:
        return f"The embedding provider rejected the request: {reason}"
    return f"The embedding provider returned an error: {reason}"


def get_provider() -> EmbeddingProvider:
    api_key = get_voyage_api_key("embedding generation")
    return VoyageEmbeddingProvider(api_key=api_key)
