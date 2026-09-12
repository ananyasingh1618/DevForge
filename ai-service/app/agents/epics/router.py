from fastapi import APIRouter

from app.agents.epics import provider as provider_module
from app.schemas import GenerateEpicsRequest, GenerateEpicsResponse

router = APIRouter()


@router.post("/epics/generate", response_model=GenerateEpicsResponse)
def generate_epics(body: GenerateEpicsRequest) -> GenerateEpicsResponse:
    # get_provider() is called here, inside the handler, after FastAPI has
    # already validated `body` — see the matching comment (and the bug it
    # fixed) in app/agents/requirements/router.py. Tests override this via
    # `monkeypatch.setattr(provider_module, "get_provider", ...)`.
    provider = provider_module.get_provider()
    content = provider.generate(body.architecture)
    return GenerateEpicsResponse(content=content)
