"""Read-only condition commands: one result page, never a live subscription."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from fastapi.responses import JSONResponse

from athena_api.canvas_transform import resolve_fixed_card_title, screen_definition_for
from athena_api.card_surface_contract import bind_surface_values, build_board_surface_contract
from athena_api.errors import KiwoomApiError, KiwoomNotReadyError
from athena_api.selector.schemas import CallRequest


def is_condition_read_plan(document: Any, plan: Any) -> bool:
    if document is None or document.kind != "websocket":
        return False
    arguments = plan.arguments
    if plan.operation_ref == "base:ka10171":
        return arguments.get("trnm") == "CNSRLST"
    if plan.operation_ref == "base:ka10172":
        return (arguments.get("trnm") == "CNSRREQ"
                and arguments.get("search_type") == "0")
    return False


async def render_condition_query(payload, request, response, ws_client, selector, account):
    # Imported here because canvas_push owns the shared signed delivery machinery.
    from athena_api.api.canvas_push import (
        _apply_workspace_reservation, _bind_semantic_values, _correlation,
        _display_receipt, _enqueue_envelope, _integrated_card_contract,
        _reserve_workspace, _stale_workspace_response,
    )

    plan = selector.signer.verify(payload.plan_token, selector.catalog, expected_account=account)
    document = selector.catalog.find_exact(plan.operation_ref)
    if not is_condition_read_plan(document, plan):
        raise HTTPException(409, "A saved-condition list or one-shot search plan is required")
    if ws_client is None or not ws_client.is_ready:
        raise KiwoomNotReadyError("Kiwoom WebSocket service is not ready")
    definition = screen_definition_for(plan.operation_ref)
    fields = (definition or {}).get("workflow", {}).get("display_allowlist", {}).get("containers", {}).get("data")
    if (not definition or definition.get("category") != "websocket"
            or not definition.get("screen_id") or not isinstance(fields, list)):
        raise HTTPException(422, "Condition result display contract is missing")
    queue = getattr(request.app.state, "canvas_events", None)
    if payload.delivery == "side_channel" and queue is None:
        raise HTTPException(503, "캔버스 채널이 준비되지 않았다")

    contract = _integrated_card_contract(
        plan.operation_ref, arguments=plan.arguments, question_hash=plan.question_hash,
        account=account, dataset_id=payload.dataset_id,
    )
    reservation = _reserve_workspace(request.app, contract)
    result = await selector.call(
        CallRequest(plan_token=payload.plan_token), request, response, None,
        account=account, order_client=None, ws_client=ws_client,
    )
    # A business failure is not an empty successful condition result. Keep its
    # public code, without putting upstream messages or condition names in errors.
    data = result.data
    if str(data.get("return_code", "")).strip() not in {"0", "+0", "00"}:
        raise KiwoomApiError(str(data.get("return_code", "")), "", 502)
    expected_command = "CNSRLST" if plan.operation_ref == "base:ka10171" else "CNSRREQ"
    if result.operation_ref != plan.operation_ref or data.get("trnm") != expected_command:
        raise HTTPException(502, "Condition result identity does not match the signed request")
    if plan.operation_ref == "base:ka10172" and data.get("seq") != plan.arguments["seq"]:
        raise HTTPException(502, "Condition result sequence does not match the signed request")
    rows = data.get("data")
    if not isinstance(rows, list):
        raise HTTPException(502, "Condition result list is missing")
    _bind_semantic_values(contract, plan.operation_ref, data)
    # ka10172 is also a data source for the watchlist. This explicit condition
    # request belongs to the authored condition-search state, not that sibling.
    contract["surface_contract"] = build_board_surface_contract(
        "2UN6-1", bound_values=bind_surface_values(plan.operation_ref, data),
        active_operation_refs=[plan.operation_ref],
    )
    if not _apply_workspace_reservation(request.app, contract, reservation):
        return _stale_workspace_response(operation_ref=plan.operation_ref, reservation=reservation)

    records = [{field: row[field] for field in fields if field in row}
               for row in rows if isinstance(row, dict)]
    screen_id = definition["screen_id"]
    correlation = _correlation(payload)
    envelope = {
        "operation_ref": plan.operation_ref, "canvas_type": "event", "screen_id": screen_id,
        "card_title": resolve_fixed_card_title(plan.operation_ref), "caption": payload.caption,
        "fell_back": False, "fallback_reason": None, "layout": None, "drop_types": [],
        "data": {"lifecycle": "completed", "state_label": "조회 완료", "records": records,
                 "has_more": data.get("cont_yn") == "Y"},
        "raw_data": data, "source_data": {"operation_ref": plan.operation_ref, "data": data},
        **contract,
    }
    if correlation is not None:
        envelope["correlation"] = correlation
    if payload.delivery_id is not None:
        envelope["delivery_id"] = payload.delivery_id
    side_channel = payload.delivery == "side_channel"
    if side_channel:
        _enqueue_envelope(queue, envelope)
    return JSONResponse(content={
        "queued": side_channel, "delivery": payload.delivery,
        "status": "queued" if side_channel else "rendered",
        "operation_ref": plan.operation_ref, "canvas_type": "event", "screen_id": screen_id,
        "correlation": correlation, "envelope": None if side_channel else envelope,
        "receipt": _display_receipt(
            delivery=payload.delivery, canvas_kind="event", screen_id=screen_id,
            meta={"trimmed": False}, delivery_id=payload.delivery_id,
        ),
        "next_actions": [],
    })
