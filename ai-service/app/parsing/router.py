from fastapi import APIRouter

from app.parsing.parser import parse_file
from app.parsing.schemas import ParseFileRequest, ParseFileResponse

router = APIRouter()


@router.post("/parsing/parse", response_model=ParseFileResponse)
def parse(body: ParseFileRequest) -> ParseFileResponse:
    return parse_file(body.path, body.content)
