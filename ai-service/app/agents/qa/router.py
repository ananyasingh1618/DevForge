from fastapi import APIRouter

from app.agents.qa import provider as provider_module
from app.agents.qa.schemas import AskQuestionRequest, AskQuestionResponse

router = APIRouter()


@router.post("/qa/answer", response_model=AskQuestionResponse)
def answer_question(body: AskQuestionRequest) -> AskQuestionResponse:
    # get_provider() is called here, inside the handler, after FastAPI has
    # already validated `body` — see the matching comment (and the bug it
    # fixed) in app/agents/requirements/router.py. Tests override this via
    # `monkeypatch.setattr(provider_module, "get_provider", ...)`.
    provider = provider_module.get_provider()
    content = provider.answer(body.question, body.repository, body.branch, body.commit, body.sources)
    return AskQuestionResponse(content=content)
