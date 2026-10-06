"""Authenticated app/MCP facade. Not an LLM-discoverable execution API."""
from typing import Annotated, Literal

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from athena_api.account_sync import require_loopback
from athena_api.laya.contracts import canonical
from athena_api.laya.service import TurnExpired
from athena_api.laya.native import plan_native, refine_native, SUPPORTED_TOOLS
from athena_api.laya.cancellation import until_disconnect
from athena_api.security import require_local_bearer

router = APIRouter(prefix="/api/v1/laya", tags=["Local semantic decisions"])


class TurnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lease_id: str = Field(min_length=32, max_length=128)
    generation_id: str = Field(min_length=1, max_length=128)
    conversation_id: str = Field(min_length=1, max_length=128)
    turn_id: str = Field(min_length=1, max_length=128)
    utterance: str = Field(min_length=1, max_length=4000)
    context: dict | str = Field(default_factory=dict)
    origin: Literal["shell", "orb", "briefing", "memory", "backtest"] = "shell"
    protected_fields: dict = Field(default_factory=dict)


class DecisionSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task_id: str = Field(min_length=1, max_length=80)
    candidate_id: str | None = Field(default=None, max_length=256)


class DecisionsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decisions: list[DecisionSpec] = Field(min_length=1, max_length=32)


class RefineRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tool_name: str = Field(min_length=1, max_length=80)
    arguments: dict = Field(default_factory=dict)


def service(request, authorization):
    require_local_bearer(request, authorization)
    require_loopback(request)
    result = getattr(request.app.state, "laya_service", None)
    if result is None:
        raise HTTPException(503, "Local semantic runtime is unavailable")
    return result


def bound_service(request, authorization, ticket):
    current = service(request, authorization)
    lease = request.headers.get("x-athena-laya-lease", "")
    generation = request.headers.get("x-athena-laya-generation", "")
    if not lease or not generation:
        raise HTTPException(409, "Semantic turn binding required")
    try:
        current.context(ticket, lease_id=lease, generation_id=generation)
    except TurnExpired:
        raise HTTPException(409, "Semantic turn expired or belongs to another session") from None
    return current


@router.post("/turns", openapi_extra={"x-athena-llm-exposed": False})
async def register_turn(payload: TurnRequest, request: Request,
                        authorization: Annotated[str, Header()] = ""):
    current = service(request, authorization)
    if len(canonical(payload.context)) > 10000 or len(canonical(payload.protected_fields)) > 4000:
        raise HTTPException(422, "Context exceeds the semantic contract limit")
    ticket = current.register(**payload.model_dump())
    return {"ticket": ticket, "turn_id": payload.turn_id, "conversation_id": payload.conversation_id}


@router.post("/turns/{ticket}/decide", openapi_extra={"x-athena-llm-exposed": False})
async def decide(ticket: str, payload: DecisionsRequest, request: Request,
                 authorization: Annotated[str, Header()] = ""):
    current = bound_service(request, authorization, ticket)
    try:
        return {"decisions": await until_disconnect(request,
            current.decide(ticket, [item.model_dump() for item in payload.decisions]))}
    except TurnExpired:
        raise HTTPException(409, "Semantic turn expired") from None


@router.delete("/turns/{ticket}", openapi_extra={"x-athena-llm-exposed": False})
async def retire(ticket: str, request: Request, authorization: Annotated[str, Header()] = ""):
    bound_service(request, authorization, ticket).retire(ticket)
    return {"retired": True}


@router.get("/status", openapi_extra={"x-athena-llm-exposed": False})
async def status(request: Request, authorization: Annotated[str, Header()] = ""):
    current = service(request, authorization)
    return {"configured": bool(current.client.token and current.client.deployment_sha256),
            "deployment_sha256": current.client.deployment_sha256,
            "worker_state": getattr(getattr(request.app.state, "laya_worker", None), "state", "unmanaged"),
            "decisions_by_reason": dict(current.client.counts)}


@router.post("/turns/{ticket}/plan", openapi_extra={"x-athena-llm-exposed": False})
async def plan(ticket: str, request: Request, authorization: Annotated[str, Header()] = ""):
    current = bound_service(request, authorization, ticket)
    try:
        return await until_disconnect(request, plan_native(current, ticket))
    except TurnExpired:
        raise HTTPException(409, "Semantic turn expired") from None


@router.post("/turns/{ticket}/refine", openapi_extra={"x-athena-llm-exposed": False})
async def refine(ticket: str, payload: RefineRequest, request: Request,
                 authorization: Annotated[str, Header()] = ""):
    current = bound_service(request, authorization, ticket)
    if payload.tool_name not in SUPPORTED_TOOLS or len(canonical(payload.arguments)) > 200000:
        raise HTTPException(422, "Unsupported native tool or oversized arguments")
    try:
        # Routing is advisory; a structured native call retains its tool and is
        # still checked by the existing tool validator and permission boundary.
        turn = current.context(ticket)
        route = turn.get("plan")
        advisory = None
        if (route and not turn.get("route_consumed") and route["tool_name"] is not None
                and route["tool_name"] != payload.tool_name):
            advisory = {"reason": "accepted_route_mismatch", "applied": False,
                        "expected_tool": route["tool_name"], "decisions": route["decisions"]}
        result = await until_disconnect(request,
            refine_native(current, ticket, payload.tool_name, payload.arguments))
        current.turns[ticket]["route_consumed"] = True
        return {"blocked": False, **result, **({"routing_advisory": advisory} if advisory else {})}
    except TurnExpired:
        raise HTTPException(409, "Semantic turn expired") from None


@router.post("/turns/{ticket}/dispatch", openapi_extra={"x-athena-llm-exposed": False})
async def dispatch(ticket: str, request: Request, authorization: Annotated[str, Header()] = ""):
    current = bound_service(request, authorization, ticket)

    async def execute(tool, arguments):
        import httpx
        from athena_mcp import graph_view_tools, nudge_guard_tools, routine_tools
        if tool == "athena_graph_view":
            result = await graph_view_tools.dispatch(arguments)
        else:
            # The same native handlers and same guarded HTTP routes are used. No
            # self-network call, account side effects or new write capability.
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=request.app),
                    base_url="http://127.0.0.1", headers={"Authorization": authorization}) as client:
                if tool == "athena_routine" and arguments.get("action") == "list":
                    result = await routine_tools.dispatch(arguments, client)
                elif tool == "athena_nudge_guard" and arguments.get("action") == "get":
                    result = await nudge_guard_tools.dispatch(arguments, client)
                else:
                    raise HTTPException(422, "Direct semantic dispatch is not supported")
        return result.model_dump(mode="json", exclude_none=True)

    try:
        return await current.direct_dispatch(ticket, execute)
    except TurnExpired:
        raise HTTPException(409, "Semantic turn expired") from None
