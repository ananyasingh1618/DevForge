from fastapi import APIRouter

from app.agents.tasks import provider as provider_module
from app.schemas import GenerateTasksRequest, GenerateTasksResponse

router = APIRouter()


@router.post("/tasks/generate", response_model=GenerateTasksResponse)
def generate_tasks(body: GenerateTasksRequest) -> GenerateTasksResponse:
    # get_provider() is called here, inside the handler, after FastAPI has
    # already validated `body` — see the matching comment (and the bug it
    # fixed) in app/agents/requirements/router.py. Tests override this via
    # `monkeypatch.setattr(provider_module, "get_provider", ...)`.
    provider = provider_module.get_provider()
    content = provider.generate(body.epics)
    return GenerateTasksResponse(content=content)
