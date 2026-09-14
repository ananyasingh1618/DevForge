# DevForge AI service

Python/FastAPI. Implements **requirements analysis** (`POST /requirements/analyze`, see
`app/agents/requirements/`), **PRD generation** (`POST /prd/generate`, see `app/agents/prd/`),
**architecture generation** (`POST /architecture/generate`, see `app/agents/architecture/`),
**epic generation** (`POST /epics/generate`, see `app/agents/epics/`), **task generation**
(`POST /tasks/generate`, see `app/agents/tasks/`), **codebase Q&A** (`POST /qa/answer`, see
`app/agents/qa/`), and **AI code review** (`POST /review/analyze`, see `app/agents/review/`),
all via Anthropic Claude (`claude-opus-5`). Both Q&A's and code review's structured output have
no field for a model-supplied file path, symbol, or line number — only a numeric selection from
the fixed source list the caller already provided — so a citation can never be invented; a
review finding left with zero valid citations after filtering is dropped entirely. Code review
returns a summary plus a list of findings, each with a controlled severity/category/confidence
and a recommendation — it never modifies code, executes anything, or takes a repository action;
it has no tool-use capability in this call at all.
Also implements **tree-sitter source parsing and symbol extraction** (`POST /parsing/parse`,
see `app/parsing/`) — Python, TypeScript, and JavaScript only — and **embedding generation**
via Voyage AI (`POST /embeddings/generate`, `voyage-code-3`, see `app/agents/embeddings/`).
Neither is an LLM call, so neither needs `ANTHROPIC_API_KEY`; embeddings has its own separate
optional key, `VOYAGE_API_KEY`. `GET /health` always works — analyze/generate/ask/review
requests fail with a clear 503 with no `ANTHROPIC_API_KEY` set, and embedding requests fail
with a clear 503 with no `VOYAGE_API_KEY` set, instead of a fabricated result. See the root
[README.md](../README.md) for the full picture.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt   # includes pytest, httpx for tests
export ANTHROPIC_API_KEY=sk-ant-...             # optional — omit to see the "not configured" path
export VOYAGE_API_KEY=pa-...                    # optional — omit to see the "not configured" path
.venv/bin/uvicorn main:app --port 8001

# tests
.venv/bin/python -m pytest tests/ -v
```
