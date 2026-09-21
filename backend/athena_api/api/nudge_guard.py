"""말걸기 가드 설정 REST — routines.py와 완전히 분리된 별도 라우터(git-lock 정합).

전역 설정 하나뿐이라 라우틴별 엔드포인트와 모양이 다르다 — GET(조회)·
POST(전체 교체)뿐이고 draft/confirm 개념이 없다. 저장이 곧 확정이다
(guard_settings.py 모듈 독스트링 참고 — 낮은 스테이크 설정값이라는 판단).
"""

from __future__ import annotations

from typing import Any
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request

from athena_api.routines.guard_settings import validate_guard_settings
from athena_api.routines.suggestions import SuggestionStore

router = APIRouter(prefix="/api/v1/nudge-guard", tags=["nudge-guard"])


def _suggestions(request: Request) -> SuggestionStore:
    return SuggestionStore(request.app.state.nudge_guard_store.path.with_name("suggestion-state.json"))


def _entity(value: Any) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 200:
        raise HTTPException(status_code=422, detail="entity_id는 1~200자 문자열이어야 합니다")
    return value


@router.get("/suggestions")
async def suggestion_state(request: Request) -> dict[str, Any]:
    return _suggestions(request).state(request.app.state.nudge_guard_store.get(), datetime.now(UTC))


@router.post("/suggestions/present")
async def present_suggestions(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    ids = body.get("entity_ids")
    if not isinstance(ids, list) or len(ids) > 100:
        raise HTTPException(status_code=422, detail="entity_ids는 최대 100개 목록이어야 합니다")
    return _suggestions(request).present([_entity(i) for i in ids],
                                        request.app.state.nudge_guard_store.get(), datetime.now(UTC))


@router.post("/suggestions/hold")
async def hold_suggestion(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    return _suggestions(request).hold(_entity(body.get("entity_id")),
                                     request.app.state.nudge_guard_store.get(), datetime.now(UTC))


@router.get("")
async def get_nudge_guard(request: Request) -> dict[str, Any]:
    return request.app.state.nudge_guard_store.get().to_dict()


@router.post("")
async def replace_nudge_guard(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    settings = validate_guard_settings(body)  # GuardSettingsError → 422 (errors.py)
    request.app.state.nudge_guard_store.replace(settings)
    return settings.to_dict()
