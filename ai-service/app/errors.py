"""Structured errors for the ai-service, mirroring the Node API's envelope
(`{"error": {"code", "message", "details"?}}`) so a client — the Node API's
aiServiceClient, or a developer curling this service directly — sees one
consistent shape regardless of which process answered.
"""

from __future__ import annotations

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class AppError(Exception):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


class ProviderNotConfiguredError(AppError):
    def __init__(self, feature: str = "requirements analysis") -> None:
        super().__init__(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "PROVIDER_NOT_CONFIGURED",
            "No LLM provider is configured. Set ANTHROPIC_API_KEY in the ai-service "
            f"environment to enable {feature}.",
        )


class AIResponseInvalidError(AppError):
    def __init__(self, detail: str) -> None:
        super().__init__(
            status.HTTP_502_BAD_GATEWAY,
            "AI_RESPONSE_INVALID",
            f"The AI provider returned a response that did not match the expected "
            f"structure: {detail}",
        )


class ProviderRequestError(AppError):
    """Wraps a provider-side failure (rate limit, auth, network, etc.) that
    isn't a schema/validation problem on our end."""

    def __init__(self, message: str) -> None:
        super().__init__(status.HTTP_502_BAD_GATEWAY, "AI_PROVIDER_ERROR", message)


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code, "message": exc.message}},
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "Invalid request",
                    "details": exc.errors(),
                }
            },
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(_request: Request, _exc: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"error": {"code": "INTERNAL_ERROR", "message": "Something went wrong"}},
        )
