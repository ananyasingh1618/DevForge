"""DevForge AI service (Python/FastAPI).

Phase 2 added requirements analysis (see app/agents/requirements/). Phase 3
added PRD generation (see app/agents/prd/). Phase 4 added architecture
generation (see app/agents/architecture/). Phase 5 adds epic generation (see
app/agents/epics/) and task generation (see app/agents/tasks/). Phase 7 adds
tree-sitter-backed source parsing and symbol extraction (see app/parsing/) —
not an LLM call, so it needs no provider configuration. Phase 8 adds
embedding generation via Voyage AI (see app/agents/embeddings/) — also not
an LLM call, gated by its own optional VOYAGE_API_KEY rather than
ANTHROPIC_API_KEY. Phase 9 adds codebase Q&A (see app/agents/qa/) — an
Anthropic structured-output call grounded in Phase 8 retrieval results,
gated by the same ANTHROPIC_API_KEY as every other LLM agent. Code review
remains unimplemented; nothing in this service fabricates a response for
it.
"""

from fastapi import FastAPI

from app.agents.architecture.router import router as architecture_router
from app.agents.embeddings.router import router as embeddings_router
from app.agents.epics.router import router as epics_router
from app.agents.prd.router import router as prd_router
from app.agents.qa.router import router as qa_router
from app.agents.requirements.router import router as requirements_router
from app.agents.tasks.router import router as tasks_router
from app.errors import register_error_handlers
from app.parsing.router import router as parsing_router

app = FastAPI(title="DevForge AI Service", version="0.0.0")

register_error_handlers(app)
app.include_router(requirements_router)
app.include_router(prd_router)
app.include_router(architecture_router)
app.include_router(epics_router)
app.include_router(tasks_router)
app.include_router(parsing_router)
app.include_router(embeddings_router)
app.include_router(qa_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
