from fastapi import APIRouter

from app.agents.embeddings import provider as provider_module
from app.agents.embeddings.schemas import EmbedRequest, EmbedResponse

router = APIRouter()


@router.post("/embeddings/generate", response_model=EmbedResponse)
def generate_embeddings(body: EmbedRequest) -> EmbedResponse:
    # get_provider() is called here, inside the handler, after FastAPI has
    # already validated `body` — see the matching comment (and the bug it
    # fixed) in app/agents/requirements/router.py. Tests override this via
    # `monkeypatch.setattr(provider_module, "get_provider", ...)`.
    provider = provider_module.get_provider()
    model, dimensions, embeddings = provider.embed(body.texts, body.input_type)
    return EmbedResponse(model=model, dimensions=dimensions, embeddings=embeddings)
