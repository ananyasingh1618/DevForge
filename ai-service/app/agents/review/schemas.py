"""Request/response models for AI code review.

Structurally the same citation-safety shape as app/agents/qa/schemas.py:
ReviewFindingContent has no field for a model-supplied file path, symbol, or
line number — only cited_source_numbers, a selection from the fixed,
1-indexed source list the caller already provided. Severity/category/
confidence are Pydantic enums (not free strings), so an invalid value is a
structured-output parse failure the provider layer already handles, not a
value that reaches Node and needs separate validation there.
"""

from enum import Enum

from pydantic import BaseModel, Field


class ReviewSourceInput(BaseModel):
    source_number: int = Field(..., ge=1, description="1-indexed position in this request's own source list.")
    path: str
    symbol_name: str | None = None
    start_line: int
    end_line: int
    content: str


class ReviewRequest(BaseModel):
    scope: str = Field(..., min_length=1, max_length=2000)
    repository: str = Field(..., min_length=1, description='e.g. "octocat/Hello-World".')
    branch: str = Field(..., min_length=1)
    commit: str = Field(..., min_length=1)
    sources: list[ReviewSourceInput] = Field(..., min_length=1, max_length=20)


class ReviewFindingSeverity(str, Enum):
    critical = "critical"
    high = "high"
    medium = "medium"
    low = "low"
    info = "info"


class ReviewFindingCategory(str, Enum):
    bug = "bug"
    security = "security"
    reliability = "reliability"
    performance = "performance"
    maintainability = "maintainability"
    validation = "validation"
    error_handling = "error_handling"
    testing = "testing"
    architecture = "architecture"
    other = "other"


class ReviewFindingConfidence(str, Enum):
    high = "high"
    medium = "medium"
    low = "low"


class ReviewFindingContent(BaseModel):
    title: str
    description: str
    severity: ReviewFindingSeverity
    category: ReviewFindingCategory
    confidence: ReviewFindingConfidence
    recommendation: str
    cited_source_numbers: list[int] = Field(
        default_factory=list,
        description=(
            "Which of the request's numbered sources this finding is based on. Never a file "
            "path, symbol name, or line number — those are never model output, only a "
            "selection from the fixed list the request already provided. A finding with no "
            "valid citation is not evidence-based and is dropped before the response is "
            "returned."
        ),
    )


class ReviewAnswerContent(BaseModel):
    summary: str = Field(..., description="Short overall review summary, grounded only in the supplied sources.")
    findings: list[ReviewFindingContent] = Field(
        default_factory=list,
        description="Empty when no supported issue is found — never populated just to look useful.",
    )


class ReviewResponse(BaseModel):
    content: ReviewAnswerContent
