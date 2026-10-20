"""Finite authenticated FastAPI surface for local WTS financial reads."""

from __future__ import annotations

import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from athena_api.financial_query_runtime import (
    FinancialCredentialRuntime,
    FinancialQueryError,
    FinancialQueryRuntime,
)
from athena_api.selector.catalog import build_operation_catalog

PROFILE = "wts-financial-read-v1"
API_VERSION = "selector-financial-read-v1"
CARD_VERSION = "wts-financial-card-1"
METHODS = (
    "source.credentials.status",
    "source.credentials.configure",
    "source.credentials.delete",
    "source.query.start",
    "source.query.status",
    "source.query.page",
    "source.query.continue",
    "source.query.cancel",
)
RENDER_KINDS = ("facts", "table", "compound", "chart")
MAX_REQUEST_BYTES = 256 * 1024

ERROR_MESSAGES = {
    "REQUEST_INVALID": "Request is invalid.",
    "LOCAL_AUTH_FAILED": "Local authorization failed.",
    "RESOURCE_NOT_FOUND": "Requested local resource was not found.",
    "STATE_CONFLICT": "Requested operation conflicts with current state.",
    "BUSY": "Local financial runtime is busy.",
    "PAYLOAD_TOO_LARGE": "Payload is too large.",
    "UPSTREAM_UNAVAILABLE": "Financial data source is unavailable.",
    "OPERATION_TIMEOUT": "Financial operation timed out.",
    "INTERNAL_ERROR": "Financial operation failed.",
    "FINANCIAL_BACKEND_STARTING": "Local financial runtime is starting.",
    "CREDENTIAL_MUTATION_NOT_FOUND": "Credential mutation was not found.",
    "IDEMPOTENCY_CONFLICT": "Request identity conflicts with prior input.",
    "QUERY_JOB_NOT_FOUND": "Financial query job was not found.",
    "QUERY_CANCELLED": "Financial query was cancelled.",
    "QUERY_RESULT_ITEM_TOO_LARGE": "Financial result item is too large.",
    "QUERY_RESULT_TOO_LARGE": "Financial result is too large.",
    "QUERY_RESULT_UNSUPPORTED_VALUE": "Financial result contains an unsupported value.",
    "CONTINUATION_ALREADY_USED": "Financial continuation was already used.",
    "LOCK_CONFLICT": "Credential profile is locked by another process.",
    "TOKEN_REFRESHING": "Credential token is refreshing.",
    "TOKEN_REJECTED": "Credential token request was rejected.",
    "NETWORK_UNAVAILABLE": "Credential network is unavailable.",
    "VAULT_UNAVAILABLE": "Credential vault is unavailable.",
    "DELETING": "Credential profile is being deleted.",
}


class FinancialReadSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="ATHENA_", env_file=None, extra="forbid"
    )

    local_bearer_token: SecretStr | None = None
    data_dir: Path | None = None

    @field_validator("local_bearer_token", mode="before")
    @classmethod
    def normalize_bearer(cls, value: object) -> object:
        raw = value.get_secret_value() if isinstance(value, SecretStr) else value
        return None if isinstance(raw, str) and not raw.strip() else value

    @field_validator("data_dir")
    @classmethod
    def absolute_data_dir(cls, value: Path | None) -> Path | None:
        if value is not None and not value.is_absolute():
            raise ValueError("data_dir must be absolute")
        return value


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CredentialStatusRequest(StrictRequest):
    mutationId: UUID | None = None


class CredentialConfigureRequest(StrictRequest):
    mutationId: UUID
    profileId: UUID
    expectedRevision: int | None = Field(default=None, ge=1)
    label: str = Field(min_length=1, max_length=64)
    environment: Literal["mock", "real"]
    appKey: str = Field(min_length=1, max_length=256)
    secretKey: str = Field(min_length=1, max_length=256)


class CredentialDeleteRequest(StrictRequest):
    mutationId: UUID
    profileId: UUID
    expectedRevision: int = Field(ge=1)


class QueryStartRequest(StrictRequest):
    submissionId: UUID
    profileId: UUID
    operationRef: str = Field(min_length=1, max_length=256)
    arguments: dict[str, str | int | float | bool | None] = Field(max_length=64)


class QueryStatusRequest(StrictRequest):
    jobId: UUID


class QueryPageRequest(StrictRequest):
    jobId: UUID
    pageToken: str = Field(min_length=43, max_length=43, pattern=r"^[A-Za-z0-9_-]{43}$")


class QueryContinueRequest(StrictRequest):
    submissionId: UUID
    parentJobId: UUID
    continuationToken: str = Field(
        min_length=43, max_length=43, pattern=r"^[A-Za-z0-9_-]{43}$"
    )


class QueryCancelRequest(StrictRequest):
    jobId: UUID
    cancellationId: UUID


def _error(code: str, status_code: int) -> JSONResponse:
    safe = code if code in ERROR_MESSAGES else "INTERNAL_ERROR"
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": safe, "message": ERROR_MESSAGES[safe]}},
    )


def _domain_status(code: str) -> int:
    if code in {"CREDENTIAL_MUTATION_NOT_FOUND", "QUERY_JOB_NOT_FOUND", "RESOURCE_NOT_FOUND"}:
        return 404
    if code in {"IDEMPOTENCY_CONFLICT", "CONTINUATION_ALREADY_USED", "STATE_CONFLICT"}:
        return 409
    if code in {"BUSY"}:
        return 429
    if code in {"PAYLOAD_TOO_LARGE", "QUERY_RESULT_ITEM_TOO_LARGE", "QUERY_RESULT_TOO_LARGE"}:
        return 413
    if code in {"OPERATION_TIMEOUT"}:
        return 504
    if code in {"UPSTREAM_UNAVAILABLE", "NETWORK_UNAVAILABLE", "VAULT_UNAVAILABLE"}:
        return 503
    return 422


def _payload(model: BaseModel) -> dict[str, Any]:
    return model.model_dump(mode="json", by_alias=True, exclude_unset=True)


class _BoundedAuthenticatedRequest:
    def __init__(self, app: ASGIApp, *, bearer: str) -> None:
        self.app = app
        self.bearer = bearer

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        raw_length = headers.get(b"content-length")
        if raw_length is not None:
            try:
                declared_length = int(raw_length)
                if declared_length < 0:
                    raise ValueError
                if declared_length > MAX_REQUEST_BYTES:
                    await _error("PAYLOAD_TOO_LARGE", 413)(scope, receive, send)
                    return
            except ValueError:
                await _error("REQUEST_INVALID", 422)(scope, receive, send)
                return
        raw_authorization = headers.get(b"authorization", b"")
        try:
            authorization = raw_authorization.decode("ascii")
        except UnicodeDecodeError:
            authorization = ""
        scheme, _, credential = authorization.partition(" ")
        if (
            scheme.lower() != "bearer"
            or not credential.strip()
            or not secrets.compare_digest(credential.strip(), self.bearer)
        ):
            await _error("LOCAL_AUTH_FAILED", 401)(scope, receive, send)
            return

        messages: list[Message] = []
        body_size = 0
        while True:
            message = await receive()
            if message["type"] != "http.request":
                await _error("REQUEST_INVALID", 422)(scope, receive, send)
                return
            body_size += len(message.get("body", b""))
            if body_size > MAX_REQUEST_BYTES:
                await _error("PAYLOAD_TOO_LARGE", 413)(scope, receive, send)
                return
            messages.append(message)
            if not message.get("more_body", False):
                break

        index = 0

        async def replay() -> Message:
            nonlocal index
            if index < len(messages):
                message = messages[index]
                index += 1
                return message
            return {"type": "http.request", "body": b"", "more_body": False}

        await self.app(scope, replay, send)


def create_financial_read_app(
    settings: FinancialReadSettings | None = None,
    *,
    query_runtime: FinancialQueryRuntime | None = None,
    credential_runtime: FinancialCredentialRuntime | None = None,
) -> FastAPI:
    runtime_settings = settings or FinancialReadSettings(_env_file=None)
    if runtime_settings.local_bearer_token is None:
        raise RuntimeError("wts-financial-read requires ATHENA_LOCAL_BEARER_TOKEN")
    bearer = runtime_settings.local_bearer_token.get_secret_value().strip()
    if not bearer:
        raise RuntimeError("wts-financial-read requires ATHENA_LOCAL_BEARER_TOKEN")
    catalog = build_operation_catalog()

    if credential_runtime is None:
        if runtime_settings.data_dir is None:
            raise RuntimeError("wts-financial-read requires --data-dir")
        from athena_api.financial_vault import FinancialVault

        credential_runtime = FinancialCredentialRuntime(
            FinancialVault(runtime_settings.data_dir / "financial-read-v1"), catalog
        )
    if query_runtime is None:
        query_runtime = FinancialQueryRuntime(catalog, credential_runtime.get_query_profile)
    credential_runtime.attach_query_runtime(query_runtime)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        credential_runtime.start_refresh()
        yield
        await query_runtime.aclose()
        await credential_runtime.aclose()

    app = FastAPI(
        title="ATHENA WTS financial read",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.state.local_bearer_token = bearer
    app.state.catalog = catalog
    app.state.query_runtime = query_runtime
    app.state.credential_runtime = credential_runtime
    app.add_middleware(_BoundedAuthenticatedRequest, bearer=bearer)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, __: RequestValidationError):
        return _error("REQUEST_INVALID", 422)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException):
        code = "RESOURCE_NOT_FOUND" if exc.status_code == 404 else "REQUEST_INVALID"
        return _error(code, exc.status_code)

    @app.exception_handler(FinancialQueryError)
    async def domain_error(_: Request, exc: FinancialQueryError):
        return _error(exc.code, _domain_status(exc.code))

    @app.exception_handler(Exception)
    async def internal_error(_: Request, __: Exception):
        return _error("INTERNAL_ERROR", 500)

    @app.get("/health")
    async def health() -> dict[str, str]:
        credential_runtime.assert_available()
        return {"status": "ok", "profile": PROFILE}

    @app.get("/api/v1/financial/capabilities")
    async def capabilities() -> dict[str, Any]:
        return {
            "profile": PROFILE,
            "apiVersion": API_VERSION,
            "cardVersion": CARD_VERSION,
            "catalogVersion": catalog.version,
            "methods": list(METHODS),
            "renderKinds": list(RENDER_KINDS),
            "queryOnly": True,
            "credentialSetup": True,
            "order": False,
            "websocket": False,
            "externalAi": False,
        }

    @app.post("/api/v1/financial/credentials/status")
    async def credential_status(body: CredentialStatusRequest) -> dict[str, Any]:
        return await credential_runtime.status(str(body.mutationId) if body.mutationId else None)

    @app.post("/api/v1/financial/credentials/configure")
    async def credential_configure(body: CredentialConfigureRequest) -> dict[str, Any]:
        credential_runtime.assert_available()
        return await credential_runtime.configure(_payload(body))

    @app.post("/api/v1/financial/credentials/delete")
    async def credential_delete(body: CredentialDeleteRequest) -> dict[str, Any]:
        credential_runtime.assert_available()
        return await credential_runtime.delete(_payload(body))

    @app.post("/api/v1/financial/query/start")
    async def query_start(body: QueryStartRequest) -> dict[str, Any]:
        credential_runtime.assert_available()
        return {
            "job": await query_runtime.start(
                submission_id=str(body.submissionId),
                profile_id=str(body.profileId),
                operation_ref=body.operationRef,
                arguments=body.arguments,
            )
        }

    @app.post("/api/v1/financial/query/status")
    async def query_status(body: QueryStatusRequest) -> dict[str, Any]:
        credential_runtime.assert_available()
        return {"job": await query_runtime.status(str(body.jobId))}

    @app.post("/api/v1/financial/query/page")
    async def query_page(body: QueryPageRequest) -> dict[str, Any]:
        credential_runtime.assert_available()
        return await query_runtime.page(str(body.jobId), body.pageToken)

    @app.post("/api/v1/financial/query/continue")
    async def query_continue(body: QueryContinueRequest) -> dict[str, Any]:
        credential_runtime.assert_available()
        return {
            "job": await query_runtime.continue_query(
                submission_id=str(body.submissionId),
                parent_job_id=str(body.parentJobId),
                continuation_token=body.continuationToken,
            )
        }

    @app.post("/api/v1/financial/query/cancel")
    async def query_cancel(body: QueryCancelRequest) -> dict[str, Any]:
        credential_runtime.assert_available()
        return await query_runtime.cancel(
            job_id=str(body.jobId), cancellation_id=str(body.cancellationId)
        )

    return app
