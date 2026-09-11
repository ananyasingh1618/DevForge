from fastapi import APIRouter

from app.agents.requirements import provider as provider_module
from app.schemas import AnalyzeRequirementsRequest, AnalyzeRequirementsResponse

router = APIRouter()


@router.post("/requirements/analyze", response_model=AnalyzeRequirementsResponse)
def analyze_requirements(body: AnalyzeRequirementsRequest) -> AnalyzeRequirementsResponse:
    # get_provider() is called here, inside the handler, rather than via a
    # FastAPI Depends() parameter — FastAPI resolves parameter-less Depends()
    # callables before parsing the request body, so a bad idea (or a missing
    # field) was incorrectly returning 503 PROVIDER_NOT_CONFIGURED instead of
    # 400 VALIDATION_ERROR when no key was set. Calling it here guarantees
    # `body` is already validated first. Tests override this via
    # `monkeypatch.setattr(provider_module, "get_provider", ...)`.
    provider = provider_module.get_provider()
    content = provider.analyze(body.idea)
    return AnalyzeRequirementsResponse(content=content)
