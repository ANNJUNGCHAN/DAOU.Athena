"""Broker-credential-free, metadata-only selector surface for the WTS local bridge."""

from __future__ import annotations

import secrets
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from athena_api.selector.catalog import (
    OperationCatalog,
    OperationDocument,
    build_operation_catalog,
)
from athena_api.selector.ranking import search_catalog
from athena_api.selector.schemas import (
    DetailGroupSummary,
    DiscoveryIntent,
    FieldContract,
    OperationDescription,
    SearchRequest,
)

PROFILE = "wts-readonly-v1"
API_VERSION = "selector-readonly-v1"
CANVAS_KINDS = ("capability-list.v1", "capability-detail.v1")


class _StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ReadonlySettings(BaseSettings):
    """The only parent-process setting this profile is allowed to read."""

    model_config = SettingsConfigDict(
        env_prefix="ATHENA_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="forbid",
    )

    local_bearer_token: SecretStr | None = None

    @field_validator("local_bearer_token", mode="before")
    @classmethod
    def normalize_local_bearer_token(cls, value: object) -> object:
        raw = value.get_secret_value() if isinstance(value, SecretStr) else value
        if isinstance(raw, str) and not raw.strip():
            return None
        return value


class ReadonlySearchRequest(_StrictRequest):
    query: str = Field(min_length=2, max_length=500)
    limit: int = Field(default=5, ge=1, le=10)

    @field_validator("query")
    @classmethod
    def validate_query(cls, value: str) -> str:
        stripped = value.strip()
        if len(stripped) < 2:
            raise ValueError("query must contain at least two non-whitespace characters")
        return stripped


class ReadonlyDescribeRequest(_StrictRequest):
    operation_ref: str = Field(
        min_length=6,
        max_length=128,
        pattern=r"^(?:base:[a-z0-9]+|detail:[a-z0-9]+:[a-z0-9_]+)$",
    )


def _bearer_value(settings: ReadonlySettings) -> str:
    configured: SecretStr | None = settings.local_bearer_token
    if configured is None or not configured.get_secret_value().strip():
        raise RuntimeError("wts-readonly requires ATHENA_LOCAL_BEARER_TOKEN")
    return configured.get_secret_value().strip()


def _require_bearer(request: Request, authorization: str) -> None:
    scheme, _, credential = authorization.partition(" ")
    expected = request.app.state.local_bearer_token
    if (
        scheme.lower() != "bearer"
        or not credential.strip()
        or not secrets.compare_digest(credential.strip(), expected)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer authentication required",
        )


def _query_documents(catalog: OperationCatalog) -> list[OperationDocument]:
    return [document for document in catalog.documents if document.kind == "query"]


def _field_contracts(
    model: type[BaseModel], *, required: bool | None = None
) -> list[FieldContract]:
    schema = model.model_json_schema(by_alias=True)
    properties = schema.get("properties", {})
    contracts = []
    for name, field in model.model_fields.items():
        is_required = field.is_required()
        if required is not None and is_required is not required:
            continue
        alias = field.alias or name
        contracts.append(
            FieldContract(
                alias=alias,
                description=field.description,
                required=is_required,
                json_schema=properties.get(alias, {}),
            )
        )
    return contracts


def _detail_groups(
    catalog: OperationCatalog, document: OperationDocument
) -> list[DetailGroupSummary]:
    if document.group_id is not None:
        return []
    return [
        DetailGroupSummary(
            group_id=str(detail.group_id),
            operation_ref=detail.operation_ref,
            title_ko=detail.group_title_ko,
            title_en=detail.group_title_en,
            layout=detail.layout,  # type: ignore[arg-type]
            ui_page_size=detail.ui_page_size,
            response_field_count=len(detail.response_model.model_fields),
        )
        for detail in catalog.details_for(document.tr_id)
    ]


def _describe_query(catalog: OperationCatalog, document: OperationDocument) -> OperationDescription:
    return OperationDescription(
        catalog_version=catalog.version,
        operation_ref=document.operation_ref,
        kind="query",
        domain=document.domain,
        name=document.name,
        group_id=document.group_id,
        group_title_ko=document.group_title_ko,
        group_title_en=document.group_title_en,
        layout=document.layout,  # type: ignore[arg-type]
        ui_page_size=document.ui_page_size,
        required_arguments=_field_contracts(document.request_model, required=True),
        optional_arguments=_field_contracts(document.request_model, required=False),
        response_fields=_field_contracts(document.response_model),
        detail_groups=_detail_groups(catalog, document),
        generic_callable=document.generic_callable,
        execution_policy="selector_detail" if document.group_id else "selector_query",
        policy_reasons=[],
    )


def create_readonly_app(settings: ReadonlySettings | None = None) -> FastAPI:
    """Build the finite metadata app without importing the full Athena app or lifespan."""
    runtime_settings = settings or ReadonlySettings(_env_file=None)
    bearer = _bearer_value(runtime_settings)
    catalog = build_operation_catalog()

    app = FastAPI(
        title="ATHENA WTS Read-only Selector",
        version=API_VERSION,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.local_bearer_token = bearer
    app.state.operation_catalog = catalog

    async def authenticated(
        request: Request,
        authorization: Annotated[str, Header(alias="Authorization")] = "",
    ) -> None:
        _require_bearer(request, authorization)

    auth = [Depends(authenticated)]

    @app.get("/health", dependencies=auth)
    async def health() -> dict[str, str]:
        return {"status": "ok", "profile": PROFILE}

    @app.get("/api/v1/readonly/capabilities", dependencies=auth)
    async def capabilities() -> dict[str, Any]:
        return {
            "profile": PROFILE,
            "apiVersion": API_VERSION,
            "catalog": True,
            "search": True,
            "describe": True,
            "financialQuery": False,
            "credentials": False,
            "externalAi": False,
            "jobs": False,
            "order": False,
            "websocket": False,
            "canvasKinds": list(CANVAS_KINDS),
        }

    @app.get("/api/v1/readonly/manifest", dependencies=auth)
    async def manifest() -> dict[str, Any]:
        operations = [
            {
                "operation_ref": document.operation_ref,
                "kind": document.kind,
                "domain": document.domain,
                "name": document.name,
                "group_id": document.group_id,
                "group_title": document.group_title_ko or document.group_title_en,
            }
            for document in _query_documents(catalog)
            if document.visibility != "hidden"
        ]
        return {
            "profile": PROFILE,
            "apiVersion": API_VERSION,
            "catalogVersion": catalog.version,
            "operations": operations,
        }

    @app.post("/api/v1/readonly/search", dependencies=auth)
    async def search(payload: ReadonlySearchRequest) -> dict[str, Any]:
        # Ask for the bounded maximum, remove the selector's two read-only websocket
        # compatibility entries, then apply the caller's smaller bound.
        result = search_catalog(
            catalog, SearchRequest(query=payload.query, intent=DiscoveryIntent.QUERY, limit=10)
        )
        hits = [hit for hit in result.results if hit.kind.value == "query"][: payload.limit]
        return result.model_copy(update={"results": hits, "suggested_intent": None}).model_dump(
            mode="json"
        )

    @app.post("/api/v1/readonly/describe", dependencies=auth)
    async def describe(payload: ReadonlyDescribeRequest) -> dict[str, Any]:
        document = catalog.find_exact(payload.operation_ref)
        if document is None or document.kind != "query":
            raise HTTPException(status_code=404, detail="Query operation was not found")
        return _describe_query(catalog, document).model_dump(mode="json")

    return app
