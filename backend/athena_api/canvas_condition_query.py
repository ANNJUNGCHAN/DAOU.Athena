"""Read-only condition commands: one result page, never a live subscription."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
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


def _condition_rate_display(row: dict[str, Any], raw_rate: Any) -> dict[str, Any]:
    # CNSRREQ FID 12's documented scale and observed delivery disagree. Derive
    # this labelled display from the same row's price/change; retain its raw FID.
    display = {"value": raw_rate, "display_calculation": "current_price_previous_change"}
    try:
        price_raw, change_raw = row.get("10"), row.get("11")
        if any(isinstance(value, bool) or not isinstance(value, (str, int, float))
               for value in (price_raw, change_raw)):
            raise InvalidOperation
        price, change = abs(Decimal(str(price_raw))), Decimal(str(change_raw))
        if not price.is_finite() or not change.is_finite() or price <= 0 or price - change <= 0:
            raise InvalidOperation
        rate = (100 * change / (price - change)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except InvalidOperation:
        return {**display, "missing": "unavailable"}
    if rate == 0:
        rate = abs(rate)
    return {**display, "text": f"{'+' if rate > 0 else ''}{rate:.2f}%",
            "tone": "up" if rate > 0 else "down" if rate < 0 else "flat"}


def _annotate_condition_rates(surface: dict[str, Any], rows: list[Any]) -> None:
    for entry in surface["slot_values"]:
        if entry.get("occurrence_id") != "base:ka10172|$.data[].12|1":
            continue
        index = entry.get("row_index")
        row = rows[index] if isinstance(index, int) and 0 <= index < len(rows) else {}
        entry["value"] = _condition_rate_display(row if isinstance(row, dict) else {}, entry["value"])


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
    if plan.operation_ref == "base:ka10172":
        # The watchlist view is the same completed response, not another command
        # or a subscription. The renderer's existing secondary cache seeds it.
        contract["initial_surface_contract"] = build_board_surface_contract(
            "15L8-2", bound_values=bind_surface_values(plan.operation_ref, data),
            active_operation_refs=[plan.operation_ref],
        )
        _annotate_condition_rates(contract["initial_surface_contract"], rows)
        contract["initial_surface_contract"]["hydration_slot_ids"] = []
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
