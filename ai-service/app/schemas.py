"""Pydantic models shared across ai-service agents (requirements, prd).

These serve double duty for each feature: FastAPI uses them to validate the
HTTP request/response, and the *same* model (RequirementsContent, PrdContent)
is passed as the Anthropic `output_format` for structured-output validation
(see app/agents/*/provider.py) — one schema per feature, not two definitions
that could drift apart.
"""

from typing import Literal

from pydantic import BaseModel, Field


class RequirementItem(BaseModel):
    id: str = Field(..., description='Stable short id, e.g. "FR-1" or "NFR-1".')
    title: str
    description: str
    priority: Literal["high", "medium", "low"]
    source: Literal["stated", "inferred"] = Field(
        ...,
        description=(
            "Whether this requirement was explicitly stated by the user in the "
            "idea text (\"stated\") or inferred by the model (\"inferred\")."
        ),
    )
    acceptance_criteria: list[str] = Field(default_factory=list)


class RequirementsContent(BaseModel):
    project_summary: str
    users: list[str] = Field(default_factory=list)
    functional_requirements: list[RequirementItem] = Field(default_factory=list)
    non_functional_requirements: list[RequirementItem] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)


class AnalyzeRequirementsRequest(BaseModel):
    idea: str = Field(..., min_length=10, max_length=5000)


class AnalyzeRequirementsResponse(BaseModel):
    content: RequirementsContent


class PrdContent(BaseModel):
    overview: str
    problem_statement: str
    goals: list[str] = Field(default_factory=list)
    personas: list[str] = Field(default_factory=list)
    functional_requirements: list[str] = Field(default_factory=list)
    non_functional_requirements: list[str] = Field(default_factory=list)
    user_workflows: list[str] = Field(default_factory=list)
    edge_cases: list[str] = Field(default_factory=list)
    success_criteria: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)


class GeneratePrdRequest(BaseModel):
    # Reuses RequirementsContent as-is: PRD generation's input is exactly
    # the shape requirements analysis already produces.
    requirements: RequirementsContent


class GeneratePrdResponse(BaseModel):
    content: PrdContent
