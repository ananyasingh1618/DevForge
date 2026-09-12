# DevForge AI service

Python/FastAPI. Implements **requirements analysis** (`POST /requirements/analyze`, see
`app/agents/requirements/`), **PRD generation** (`POST /prd/generate`, see `app/agents/prd/`),
**architecture generation** (`POST /architecture/generate`, see `app/agents/architecture/`),
**epic generation** (`POST /epics/generate`, see `app/agents/epics/`), and **task generation**
(`POST /tasks/generate`, see `app/agents/tasks/`), all via Anthropic Claude (`claude-opus-5`).
Also implements **tree-sitter source parsing and symbol extraction** (`POST /parsing/parse`,
see `app/parsing/`) — Python, TypeScript, and JavaScript only; not an LLM call, so it needs no
provider configuration and always works even with no `ANTHROPIC_API_KEY` set. Embeddings,
retrieval, and code review are not implemented; nothing here fakes them. `GET /health` always
works — analyze/generate requests fail with a clear 503 with no `ANTHROPIC_API_KEY` set
instead. See the root [README.md](../README.md) for the full picture.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt   # includes pytest, httpx for tests
export ANTHROPIC_API_KEY=sk-ant-...             # optional — omit to see the "not configured" path
.venv/bin/uvicorn main:app --port 8001

# tests
.venv/bin/python -m pytest tests/ -v
```
