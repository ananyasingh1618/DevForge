"""Request/response models for the codebase-parsing endpoint.

Kept separate from app/schemas.py: those models double as the Anthropic
`output_format` for structured-output validation (see app/schemas.py's own
docstring); parsing is not an LLM call and these models serve no such second
purpose.
"""

from typing import Literal

from pydantic import BaseModel, Field


class ParseFileRequest(BaseModel):
    path: str = Field(..., min_length=1, description="Repository-relative file path.")
    content: str


class SymbolInfo(BaseModel):
    name: str
    type: str
    start_line: int = Field(..., description="1-indexed, inclusive.")
    end_line: int = Field(..., description="1-indexed, inclusive.")
    parent_index: int | None = Field(
        default=None,
        description=(
            "Index into this response's own `symbols` list of this symbol's enclosing "
            "symbol, or null for a top-level symbol. The Node API resolves this to a real "
            "database id when persisting, since no id exists yet at parse time."
        ),
    )
    signature: str | None = None


class ParseFileResponse(BaseModel):
    language: str | None = Field(
        default=None, description="Detected language, or null if the extension is unsupported."
    )
    status: Literal["parsed", "unsupported", "parse_error"]
    symbols: list[SymbolInfo] = Field(default_factory=list)
    error: str | None = None
