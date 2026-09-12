"""Pydantic models shared across ai-service agents (requirements, prd,
architecture, epics, tasks).

These serve double duty for each feature: FastAPI uses them to validate the
HTTP request/response, and the *same* model (RequirementsContent, PrdContent,
ArchitectureContent, EpicContent, TaskContent) is passed as the Anthropic
`output_format` for structured-output validation (see app/agents/*/
provider.py) — one schema per feature, not two definitions that could drift
apart.
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


class ArchitectureContent(BaseModel):
    overview: str
    system_architecture: str
    technology_stack: list[str] = Field(default_factory=list)
    components: list[str] = Field(default_factory=list)
    data_model: list[str] = Field(default_factory=list)
    api_design: list[str] = Field(default_factory=list)
    data_flows: list[str] = Field(default_factory=list)
    security: list[str] = Field(default_factory=list)
    scalability: list[str] = Field(default_factory=list)
    deployment: list[str] = Field(default_factory=list)
    tradeoffs: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)


class GenerateArchitectureRequest(BaseModel):
    # Reuses PrdContent as-is: architecture generation's input is exactly
    # the shape PRD generation already produces.
    prd: PrdContent


class GenerateArchitectureResponse(BaseModel):
    content: ArchitectureContent


class EpicItem(BaseModel):
    id: str = Field(..., description='Stable short id, e.g. "EP-1".')
    title: str
    description: str
    objective: str
    business_value: str
    scope: str
    acceptance_criteria: list[str] = Field(default_factory=list)
    dependencies: list[str] = Field(
        default_factory=list, description="Other epic ids this epic depends on."
    )
    related_components: list[str] = Field(
        default_factory=list,
        description="Names of architecture components this epic touches.",
    )


class EpicContent(BaseModel):
    epics: list[EpicItem] = Field(default_factory=list)


class GenerateEpicsRequest(BaseModel):
    # Reuses ArchitectureContent as-is: epic generation's input is exactly
    # the shape architecture generation already produces.
    architecture: ArchitectureContent


class GenerateEpicsResponse(BaseModel):
    content: EpicContent


class TaskItem(BaseModel):
    id: str = Field(..., description='Stable short id, e.g. "T-1".')
    title: str
    description: str
    type: Literal["feature", "bug", "chore"]
    priority: Literal["high", "medium", "low"]
    acceptance_criteria: list[str] = Field(default_factory=list)
    dependencies: list[str] = Field(
        default_factory=list, description="Other task ids this task depends on."
    )
    epic_id: str = Field(..., description="The EpicItem.id this task belongs to.")
    related_component: str = Field(
        default="", description="Name of the single architecture component this task touches."
    )
    estimated_complexity: Literal["small", "medium", "large"]
    suggested_order: int = Field(
        ..., description="Suggested sequence position for implementing this task."
    )


class TaskContent(BaseModel):
    tasks: list[TaskItem] = Field(default_factory=list)


class GenerateTasksRequest(BaseModel):
    # Reuses EpicContent as-is: task generation's input is exactly the shape
    # epic generation already produces.
    epics: EpicContent


class GenerateTasksResponse(BaseModel):
    content: TaskContent
