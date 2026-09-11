from fastapi import APIRouter

from app.agents.architecture import provider as provider_module
from app.schemas import GenerateArchitectureRequest, GenerateArchitectureResponse

router = APIRouter()


@router.post("/architecture/generate", response_model=GenerateArchitectureResponse)
def generate_architecture(body: GenerateArchitectureRequest) -> GenerateArchitectureResponse:
    # get_provider() is called here, inside the handler, after FastAPI has
    # already validated `body` — see the matching comment (and the bug it
    # fixed) in app/agents/requirements/router.py. Tests override this via
    # `monkeypatch.setattr(provider_module, "get_provider", ...)`.
    provider = provider_module.get_provider()
    content = provider.generate(body.prd)
    return GenerateArchitectureResponse(content=content)
