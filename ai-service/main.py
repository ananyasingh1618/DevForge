"""DevForge AI service (Python/FastAPI).

Phase 2 adds requirements analysis (see app/agents/requirements/). Every
other future capability — PRD/architecture generation, retrieval,
codebase Q&A, code review — remains unimplemented; nothing in this
service fabricates a response for them.
"""

from fastapi import FastAPI

from app.agents.requirements.router import router as requirements_router
from app.errors import register_error_handlers

app = FastAPI(title="DevForge AI Service", version="0.0.0")

register_error_handlers(app)
app.include_router(requirements_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
