# DevForge AI service

Python/FastAPI. Implements **requirements analysis** (`POST /requirements/analyze`, see
`app/agents/requirements/`) and **PRD generation** (`POST /prd/generate`, see
`app/agents/prd/`), both via Anthropic Claude (`claude-opus-5`). Architecture generation,
retrieval, and code review are not implemented; nothing here fakes them. `GET /health` always
works, even with no `ANTHROPIC_API_KEY` set — analyze/generate requests fail with a clear 503
in that case instead. See the root [README.md](../README.md) for the full picture.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt   # includes pytest, httpx for tests
export ANTHROPIC_API_KEY=sk-ant-...             # optional — omit to see the "not configured" path
.venv/bin/uvicorn main:app --port 8001

# tests
.venv/bin/python -m pytest tests/ -v
```
