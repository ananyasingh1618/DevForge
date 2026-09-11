# DevForge AI service

Python/FastAPI. **Intentionally inert in the Foundation phase** — only `GET /health` exists.
No requirements/PRD generation, retrieval, or code review logic lives here yet, and the Node
API does not call this service yet. See the root [README.md](../README.md) for why this
service exists as its own process already, before there's AI logic to put in it.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn main:app --port 8001
```
