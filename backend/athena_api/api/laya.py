"""Opt-in operation selection for the existing cold CLI classifier.

Returns a candidate proposal only. Consumers still extract free arguments with their
CLI and pass the original question through canonical selector/card validation. This
endpoint neither authorizes tools nor selects strategies or simulated trade actions.
"""

from typing import Annotated

from fastapi import APIRouter, Header, Request

from athena_api.account_sync import require_loopback
from athena_api.laya import DecisionRequest, DecisionResponse, LayaDecisionService
from athena_api.security import require_local_bearer

router = APIRouter(prefix="/api/v1/laya", tags=["Local decisions"])


@router.post(
    "/decide",
    response_model=DecisionResponse,
    operation_id="laya_decide",
    openapi_extra={"x-athena-llm-exposed": False, "x-athena-side-effect": "none"},
)
async def decide(
    payload: DecisionRequest,
    request: Request,
    authorization: Annotated[str, Header(alias="Authorization")] = "",
) -> DecisionResponse:
    require_loopback(request)
    require_local_bearer(request, authorization)
    service = getattr(request.app.state, "laya_decisions", None)
    if service is None:
        service = LayaDecisionService(request.app.state.settings)
        request.app.state.laya_decisions = service
    return await service.decide(payload)
