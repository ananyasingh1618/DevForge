"""DevForge AI service (Python/FastAPI).

Phase 2 added requirements analysis (see app/agents/requirements/). Phase 3
adds PRD generation (see app/agents/prd/). Every other future capability —
architecture generation, retrieval, codebase Q&A, code review — remains
unimplemented; nothing in this service fabricates a response for them.
"""

from fastapi import FastAPI

from app.agents.prd.router import router as prd_router
from app.agents.requirements.router import router as requirements_router
from app.errors import register_error_handlers

app = FastAPI(title="DevForge AI Service", version="0.0.0")

register_error_handlers(app)
app.include_router(requirements_router)
app.include_router(prd_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
