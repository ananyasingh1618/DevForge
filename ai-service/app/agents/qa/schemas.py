"""Request/response models for codebase Q&A.

Kept separate from app/schemas.py for the same reason app/parsing/schemas.py
and app/agents/embeddings/schemas.py are: QaAnswerContent *is* used as an
Anthropic `output_format` (unlike parsing/embeddings), but the request shape
(QaSourceInput, AskQuestionRequest) has no equivalent in app/schemas.py's
existing five content models and belongs with the agent that owns it.
"""

from pydantic import BaseModel, Field


class QaSourceInput(BaseModel):
    source_number: int = Field(..., ge=1, description="1-indexed position in this request's own source list.")
    path: str
    symbol_name: str | None = None
    start_line: int
    end_line: int
    content: str


class AskQuestionRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    repository: str = Field(..., min_length=1, description='e.g. "octocat/Hello-World".')
    branch: str = Field(..., min_length=1)
    commit: str = Field(..., min_length=1)
    sources: list[QaSourceInput] = Field(..., min_length=1, max_length=20)


class QaAnswerContent(BaseModel):
    answer: str = Field(..., description="The natural-language answer, grounded only in the supplied sources.")
    cited_source_numbers: list[int] = Field(
        default_factory=list,
        description=(
            "Which of the request's numbered sources the answer actually draws from. Never a "
            "file path, symbol name, or line number — those are never model output, only a "
            "selection from the fixed list the request already provided."
        ),
    )
    insufficient_evidence: bool = Field(
        default=False,
        description="True if the supplied sources do not contain enough information to answer.",
    )


class AskQuestionResponse(BaseModel):
    content: QaAnswerContent
