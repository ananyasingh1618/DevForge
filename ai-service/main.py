"""DevForge AI service (Python/FastAPI).

Foundation phase: this service is intentionally inert. It exists only to
establish the process/deployment boundary between the Node/Express
application API (auth, projects, orchestration) and future AI-heavy
processing (requirements/PRD generation, retrieval, code review agents).

Nothing in this service performs requirements analysis, PRD generation,
retrieval, codebase Q&A, or code review yet, and nothing here fabricates
such a response. The Node API does not call this service yet — there is
nothing for it to call.
"""

from fastapi import FastAPI

app = FastAPI(title="DevForge AI Service", version="0.0.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
