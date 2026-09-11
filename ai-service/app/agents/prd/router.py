from fastapi import APIRouter

from app.agents.prd import provider as provider_module
from app.schemas import GeneratePrdRequest, GeneratePrdResponse

router = APIRouter()


@router.post("/prd/generate", response_model=GeneratePrdResponse)
def generate_prd(body: GeneratePrdRequest) -> GeneratePrdResponse:
    # get_provider() is called here, inside the handler, after FastAPI has
    # already validated `body` — see the matching comment (and the bug it
    # fixed) in app/agents/requirements/router.py. Tests override this via
    # `monkeypatch.setattr(provider_module, "get_provider", ...)`.
    provider = provider_module.get_provider()
    content = provider.generate(body.requirements)
    return GeneratePrdResponse(content=content)
