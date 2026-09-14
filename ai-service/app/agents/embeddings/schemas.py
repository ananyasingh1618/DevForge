"""Request/response models for embedding generation.

Kept separate from app/schemas.py: those models double as the Anthropic
`output_format` for structured-output validation (see app/schemas.py's own
docstring); embedding generation is not an LLM call and these models serve
no such second purpose — mirrors app/parsing/schemas.py's same reasoning.
"""

from typing import Literal

from pydantic import BaseModel, Field


class EmbedRequest(BaseModel):
    texts: list[str] = Field(..., min_length=1, max_length=128)
    # Voyage's asymmetric embedding: chunks are embedded as "document", a
    # search query as "query" — measurably better retrieval than embedding
    # both the same way.
    input_type: Literal["document", "query"] = "document"


class EmbedResponse(BaseModel):
    model: str
    dimensions: int
    embeddings: list[list[float]]
