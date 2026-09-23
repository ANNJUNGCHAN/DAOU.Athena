
from __future__ import annotations

import json
import uuid
from typing import Any

import httpx
from mcp import types

# 순수 변환·manifest 기반 카드 종류 결정은 백엔드 단일 소재지로 이동
# (athena_api/canvas_transform.py) — 캐시 리플레이 라우트와 공용이다. 여기서는
# 재수출만 한다(테스트·호출부 계약 유지 — `as` 동일명 별칭은 의도적 재수출
# 표기라 ruff가 지우지 않는다).
from athena_api.canvas_transform import (
    TABLE_ROWS_MAX as TABLE_ROWS_MAX,
)
from athena_api.canvas_transform import (
    build_table as build_table,
)
from athena_api.screen_manifest import get_mapping


def _error(text: str) -> types.CallToolResult:
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=text)],
        isError=True,
    )


def _order_confirmation_required(details: dict[str, Any] | None = None) -> types.CallToolResult:
    draft = details.get("order_draft") if isinstance(details, dict) else None
    operation_ref = details.get("operation_ref") if isinstance(details, dict) else None
    created = (
        isinstance(draft, dict)
        and bool(draft.get("stk_cd"))
        and bool(draft.get("ord_qty"))
    )
    payload = {
        "status": "needs_confirmation",
        "code": "ORDER_TICKET_REQUIRED",
        "confirmation_required": True,
        "order_ticket_created": created,
        "order_submitted": False,
        "message": (
            "주문 티켓을 열었습니다. 앱에서 내용을 확인한 뒤 전송하세요."
            if created
            else (
                "주문 확인이 필요합니다. 주문 티켓은 생성되지 않았고 주문도 "
                "접수되지 않았습니다."
            )
        ),
    }
    if created:
        payload["operation_ref"] = operation_ref
        payload["order_draft"] = draft
        payload["next_actions"] = ["open_order_ticket"]
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=json.dumps(payload, ensure_ascii=False))],
        structuredContent=payload,
        isError=False,
    )


_WS_RECEIPTS = {
    "started": "실시간 데이터 수신을 시작했습니다. 캔버스에서 확인하세요.",
    "stopped": "실시간 데이터 수신을 중지했습니다.",
    "reconnecting": "실시간 데이터 연결을 복구하고 있습니다. 캔버스에서 확인하세요.",
    "reconnected": "실시간 데이터 연결을 복구했습니다. 캔버스에서 확인하세요.",
    "error": "실시간 데이터 연결에 실패했습니다. 인증 및 연결 상태를 확인하세요.",
}


def _result_payload(result: types.CallToolResult) -> dict[str, Any] | None:
    """CallToolResult의 JSON 객체만 읽는다. 원문은 새 결과에 복제하지 않는다."""
    if isinstance(result.structuredContent, dict):
        return result.structuredContent
    if not result.content or not isinstance(result.content[0], types.TextContent):
        return None
    try:
        payload = json.loads(result.content[0].text)
    except (TypeError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def _ws_state(payload: dict[str, Any]) -> str | None:
    data = payload.get("data")
    if not isinstance(data, dict):
        data = {}

    return_code = data.get("return_code", payload.get("return_code"))
    if return_code is None or str(return_code).strip() not in {"0", "+0", "00"}:
        return "error"

    raw_state = data.get("lifecycle") or data.get("state")
    if not isinstance(raw_state, str):
        raw_state = payload.get("lifecycle") or payload.get("state")
    if isinstance(raw_state, str):
        normalized = raw_state.strip().lower().replace("-", "_")
        aliases = {
            "start": "started",
            "starting": "started",
            "running": "started",
            "stop": "stopped",
            "stopping": "stopped",
            "reconnect": "reconnecting",
            "retrying": "reconnecting",
            "connected": "reconnected",
            "failed": "error",
            "failure": "error",
            "disconnected": "error",
        }
        normalized = aliases.get(normalized, normalized)
        if normalized in _WS_RECEIPTS:
            return normalized

    trnm = data.get("trnm", payload.get("trnm"))
    if trnm == "REG":
        return "started"
    if trnm == "REMOVE":
        return "stopped"
    return None


def websocket_lifecycle_receipt(result: types.CallToolResult) -> types.CallToolResult:
    """키움 WebSocket 응답을 값 없는 수명주기 영수증으로 바꾼다.

    일반 query/order 결과는 그대로 둔다. WebSocket 여부는 문자열 패턴이 아니라
    canonical screen manifest의 ``classification``으로 판정한다. 성공 HTTP 응답이어도
    ACK가 알 수 없는 상태이거나 화면 계약이 없으면 frame/data를 내보내지 않고
    명시적 오류로 닫는다.
    """
    if result.isError:
        return result
    payload = _result_payload(result)
    if payload is None:
        return result
    operation_ref = payload.get("operation_ref")
    if not isinstance(operation_ref, str):
        return result
    mapping = get_mapping(operation_ref)
    if mapping is None:
        return result
    classification = mapping.get("classification")
    if not isinstance(classification, dict) or classification.get("category") != "websocket":
        return result

    screen_reference = mapping.get("screen_reference")
    if not isinstance(screen_reference, dict) or not screen_reference.get("screen_id"):
        return _error(f"키움 화면 계약 누락: {operation_ref}의 screen_reference")

    state = _ws_state(payload)
    if state is None:
        return _error("실시간 데이터 상태를 확인할 수 없습니다. 연결 상태를 다시 확인하세요.")
    receipt = {"lifecycle": state, "receipt": _WS_RECEIPTS[state]}
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=json.dumps(receipt, ensure_ascii=False))],
        structuredContent=receipt,
        isError=state == "error",
    )


async def render_with_plan(
    arguments: dict[str, Any],
    http_client: httpx.AsyncClient,
    *,
    call_timeout_seconds: float,
) -> types.CallToolResult:
    """서명된 plan을 백엔드 단일 렌더 경로로 실행하고 표시 영수증만 돌려준다."""
    plan_token = arguments["plan_token"]
    request_payload: dict[str, Any] = {
        "plan_token": plan_token,
        "delivery": "side_channel",
        "delivery_id": uuid.uuid4().hex,
    }
    if "caption" in arguments:
        request_payload["caption"] = arguments["caption"]
    try:
        response = await http_client.post(
            "/api/v1/canvas/render-query",
            json=request_payload,
            timeout=call_timeout_seconds,
        )
    except httpx.ConnectError:
        return _error("앱에 연결된 키움 백엔드가 응답하지 않는다 — 사용자에게 안내하라")
    except httpx.HTTPError as exc:
        return _error(f"plan 렌더 중 전송 오류: {exc}")
    if response.status_code >= 400:
        try:
            error_payload = response.json()
        except ValueError:
            error_payload = None
        if response.status_code in {409, 428} and isinstance(error_payload, dict):
            if (
                error_payload.get("code") == "ORDER_TICKET_REQUIRED"
                or error_payload.get("detail") == "X-Athena-Confirm: true is required"
            ):
                details = error_payload.get("details")
                return _order_confirmation_required(details if isinstance(details, dict) else None)
        return _error(f"plan 렌더 실패 (HTTP {response.status_code}): {response.text[:300]}")
    try:
        response_payload = response.json()
    except ValueError:
        return _error("plan 렌더 응답이 JSON이 아니다")
    if not isinstance(response_payload, dict):
        return _error("plan 렌더 응답 형식이 올바르지 않다")
    if (
        response_payload.get("queued") is not True
        or response_payload.get("delivery") != "side_channel"
        or response_payload.get("status") != "queued"
        or "envelope" not in response_payload
        or response_payload.get("envelope") is not None
    ):
        return _error("캔버스 side-channel 배달을 확인하지 못했다")

    raw_receipt = response_payload.get("receipt")
    if not isinstance(raw_receipt, dict):
        return _error("캔버스 표시 영수증이 누락되었다")
    required_receipt = {
        "pushed": bool,
        "delivery": str,
        "canvas_type": str,
        "screen_id": str,
        "fell_back": bool,
        "trimmed": bool,
        "partial": bool,
        "cache_reused": bool,
    }
    if any(
        not isinstance(raw_receipt.get(key), expected_type)
        for key, expected_type in required_receipt.items()
    ) or raw_receipt.get("pushed") is not True or raw_receipt.get("delivery") != "side_channel":
        return _error("캔버스 표시 영수증 형식이 올바르지 않다")
    if not raw_receipt["canvas_type"] or not raw_receipt["screen_id"]:
        return _error("캔버스 표시 영수증 형식이 올바르지 않다")
    if response_payload.get("canvas_type") != raw_receipt["canvas_type"]:
        return _error("캔버스 표시 영수증 형식이 올바르지 않다")
    if "fallback_reason" not in raw_receipt:
        return _error("캔버스 표시 영수증 형식이 올바르지 않다")
    fallback_reason = raw_receipt.get("fallback_reason")
    if fallback_reason is not None and not isinstance(fallback_reason, str):
        return _error("캔버스 표시 영수증 형식이 올바르지 않다")
    renderer_id = raw_receipt.get("renderer_id")
    if renderer_id is not None and not isinstance(renderer_id, str):
        return _error("캔버스 표시 영수증 형식이 올바르지 않다")

    allowed_keys = (
        "pushed",
        "delivery",
        "canvas_type",
        "screen_id",
        "fell_back",
        "fallback_reason",
        "trimmed",
        "partial",
        "cache_reused",
        "renderer_id",
    )
    receipt = {key: raw_receipt[key] for key in allowed_keys if key in raw_receipt}
    # Keep card data off the model stream. This opaque identifier joins the
    # backend push to the caller's trusted conversation context in the app.
    delivery_id = raw_receipt.get("delivery_id")
    if delivery_id is not None:
        if delivery_id != request_payload["delivery_id"]:
            return _error("캔버스 표시 영수증 배달 식별자가 일치하지 않습니다")
        receipt["delivery_id"] = delivery_id
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=json.dumps(receipt, ensure_ascii=False))],
        structuredContent=receipt,
        isError=False,
    )
