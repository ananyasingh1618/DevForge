from fastapi import APIRouter

from app.agents.review import provider as provider_module
from app.agents.review.schemas import ReviewRequest, ReviewResponse

router = APIRouter()


@router.post("/review/analyze", response_model=ReviewResponse)
def analyze_review(body: ReviewRequest) -> ReviewResponse:
    # get_provider() is called here, inside the handler, after FastAPI has
    # already validated `body` — see the matching comment (and the bug it
    # fixed) in app/agents/requirements/router.py and app/agents/qa/router.py.
    # Tests override this via `monkeypatch.setattr(provider_module, "get_provider", ...)`.
    provider = provider_module.get_provider()
    content = provider.review(body.scope, body.repository, body.branch, body.commit, body.sources)
    return ReviewResponse(content=content)
