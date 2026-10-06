"""Natural-language historical simulation; no broker or deployment dependencies."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from uuid import uuid4

import pandas as pd
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from athena_api.backtest.natural import NaturalSimulation
from athena_api.backtest.natural_laya import NaturalLayaClient
from athena_api.backtest.natural_schema import (
    HEAD_BYTE_LIMIT,
    INSTRUCTION_BYTE_LIMIT,
    OBSERVATIONS,
    OPTION_BYTE_LIMIT,
    draft_json_schema,
    seal_schema,
)
from athena_api.backtest.schema import CostsSpec

router = APIRouter(prefix="/api/v1/backtest/natural", tags=["backtest natural simulation"])
MAX_SESSIONS = 8


class SimulationCosts(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, strict=True)

    fee_bps: float = Field(ge=0, lt=10000)
    tax_bps: float = Field(ge=0, lt=10000)
    slippage_bps: float = Field(ge=0, lt=10000)


class CreateSimulation(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, strict=True)

    strategy: str = Field(min_length=1, max_length=2000)
    data_source: Literal["demo", "cache"]
    symbol: str = Field(default="005930", pattern=r"^[A-Za-z0-9_-]{1,32}$")
    from_dt: str | None = None
    to_dt: str | None = None
    costs: SimulationCosts
    initial_cash: float = Field(default=10_000_000, gt=0, le=1e15)
    replace_session_id: str | None = Field(default=None, min_length=1, max_length=64)
    decision_schema: dict[str, Any] | None = None

    @field_validator("strategy")
    @classmethod
    def nonempty_strategy(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("자연어 조건을 입력해 주세요")
        return value


class SessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(min_length=1, max_length=64)


class SchemaAuthor(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    provider: Literal["codex", "claude"]
    model: str = Field(min_length=1, max_length=160)


class PrepareSimulation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    strategy: str = Field(min_length=1, max_length=2000)
    draft: dict[str, Any]
    author: SchemaAuthor


@router.get("/schema-contract")
async def schema_contract() -> dict[str, Any]:
    return {
        "draft_schema": draft_json_schema(),
        "observations": OBSERVATIONS,
        "limits": {
            "instructions_utf8_bytes": INSTRUCTION_BYTE_LIMIT,
            "option_utf8_bytes_including_key": OPTION_BYTE_LIMIT,
            "head_utf8_bytes": HEAD_BYTE_LIMIT,
        },
    }


@router.post("/prepare")
async def prepare_simulation(body: PrepareSimulation) -> dict[str, Any]:
    try:
        schema = seal_schema(body.draft, body.strategy.strip(), body.author.model_dump())
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    return {
        "strategy": body.strategy.strip(),
        "decision_schema": schema,
        "warnings": [
            "상위 모델이 해석한 진입·청산 조건을 확인해 주세요. 조건을 수정하면 다시 설계합니다.",
            "스키마 검증은 형식·관측값·입력 크기를 검사합니다. "
            "LAYA의 조건 판단 정확도를 보증하지 않습니다.",
            "필요한 관측값이 아직 없는 봉은 관망·보유로 처리합니다.",
        ],
    }


@dataclass
class SimulationSession:
    simulation: NaturalSimulation
    snapshot: dict[str, Any]
    task: asyncio.Task[None] | None = None
    pause_requested: bool = False


def demo_frame() -> pd.DataFrame:
    """Fixed fabricated prices, deliberately labelled synthetic in every report."""
    closes = [100 + i * 1.5 for i in range(12)] + [116 - i * 2 for i in range(12)]
    closes += [94 + i * 1.8 for i in range(12)]
    opens = [closes[0]] + closes[:-1]
    return pd.DataFrame(
        {
            "open": opens,
            "high": [max(o, c) + 1 for o, c in zip(opens, closes, strict=True)],
            "low": [min(o, c) - 1 for o, c in zip(opens, closes, strict=True)],
            "close": closes,
            "volume": [1000 + (i % 4) * 500 for i in range(len(closes))],
        },
        index=pd.bdate_range("2026-01-02", periods=len(closes)),
    )


def _sessions(request: Request) -> dict[str, SimulationSession]:
    if not hasattr(request.app.state, "natural_simulations"):
        request.app.state.natural_simulations = {}
    return request.app.state.natural_simulations


def _session(request: Request, body: SessionRequest) -> SimulationSession:
    session = _sessions(request).get(body.session_id)
    if session is None:
        raise HTTPException(404, "모의 감시 세션이 없습니다. 앱 재시작 후에는 새로 시작해 주세요")
    return session


async def _frame(request: Request, body: CreateSimulation) -> pd.DataFrame:
    if body.data_source == "demo":
        return demo_frame()
    try:
        start = datetime.strptime(body.from_dt or "", "%Y%m%d")
        end = datetime.strptime(body.to_dt or "", "%Y%m%d")
        if (
            start > end
            or start.strftime("%Y%m%d") != body.from_dt
            or end.strftime("%Y%m%d") != body.to_dt
        ):
            raise ValueError
    except ValueError:
        raise HTTPException(
            422, "시작일·종료일을 YYYYMMDD 형식과 시간 순서로 지정해 주세요"
        ) from None
    store = getattr(request.app.state, "backtest_store", None)
    if store is None:
        raise HTTPException(
            503, "저장된 백테스트 데이터가 비활성입니다. 합성 예제를 사용할 수 있습니다"
        )
    coverage = await store.coverage(body.symbol, "day", True)
    if coverage is None or coverage.first_dt > body.from_dt or coverage.last_dt < body.to_dt:
        raise HTTPException(
            409,
            "선택 기간이 저장된 수정주가 일봉 범위를 벗어납니다. "
            "기존 데이터 화면에서 수집 후 다시 시작해 주세요",
        )
    candles = await store.candles(body.symbol, "day", True, start=body.from_dt, end=body.to_dt)
    return pd.DataFrame(
        [
            {name: getattr(c, name) for name in ("open", "high", "low", "close", "volume")}
            for c in candles
        ],
        index=pd.to_datetime([c.dt for c in candles], format="%Y%m%d"),
    )


def _publish(session: SimulationSession) -> None:
    # Publish only on the event loop after a whole engine step. Pollers never read
    # a report while its worker thread is updating decisions/accounting.
    session.snapshot = {**session.snapshot, **session.simulation.report()}


async def _advance(session: SimulationSession, *, single: bool) -> None:
    try:
        while session.snapshot["cursor"] < session.snapshot["total"]:
            if session.pause_requested:
                break
            await asyncio.to_thread(session.simulation.step)
            _publish(session)
            if single:
                break
        session.snapshot["status"] = (
            "done" if session.snapshot["cursor"] == session.snapshot["total"] else "paused"
        )
    except Exception as exc:  # the session reports a failure; background tasks must not disappear
        session.snapshot["status"] = "failed"
        session.snapshot["error"] = f"모의 실행 실패: {type(exc).__name__}"
    finally:
        session.snapshot["pause_requested"] = False


def _start(session: SimulationSession, *, single: bool) -> asyncio.Task[None]:
    if session.task is not None and not session.task.done():
        raise HTTPException(409, "이 세션이 이미 진행 중입니다")
    if session.snapshot["status"] in {"done", "failed"}:
        raise HTTPException(409, "완료되거나 실패한 세션입니다. 기록을 내보내고 새로 시작해 주세요")
    session.pause_requested = False
    session.snapshot["pause_requested"] = False
    session.snapshot["status"] = "running"
    session.task = asyncio.create_task(_advance(session, single=single))
    return session.task


@router.post("/create")
async def create_simulation(request: Request, body: CreateSimulation) -> dict[str, Any]:
    sessions = _sessions(request)
    frame = await _frame(request, body)
    try:
        simulation = NaturalSimulation(
            body.strategy,
            frame,
            NaturalLayaClient(),
            costs=CostsSpec(**body.costs.model_dump()),
            initial_cash=body.initial_cash,
            decision_schema=body.decision_schema,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    # Recheck after cache I/O: another request could have started the old session
    # while the new input was being validated. Replacement is explicit and atomic.
    if body.replace_session_id is not None:
        previous = sessions.get(body.replace_session_id)
        if previous is None:
            raise HTTPException(404, "교체할 모의 감시 세션이 없습니다")
        if previous.task is not None and not previous.task.done():
            raise HTTPException(409, "진행 중인 모의 감시를 먼저 일시 정지해 주세요")
    # The store never silently evicts paused/running sessions. The current UI may
    # explicitly replace its own paused session after all new input is valid.
    if body.replace_session_id is None and len(sessions) >= MAX_SESSIONS:
        finished = next(
            (
                key
                for key, value in sessions.items()
                if value.snapshot["status"] in {"done", "failed"}
            ),
            None,
        )
        if finished is None:
            raise HTTPException(
                409, "모의 감시는 최대 8개입니다. 기존 세션을 완료한 후 다시 시작해 주세요"
            )
        del sessions[finished]
    session_id = str(uuid4())
    snapshot = {
        **simulation.report(),
        "session_id": session_id,
        "status": "paused",
        "pause_requested": False,
        "strategy": body.strategy,
        "data_source": body.data_source,
        "symbol": "SYNTHETIC" if body.data_source == "demo" else body.symbol,
        "period": "day",
        "adjusted": body.data_source == "cache",
        "requested_range": {"from_dt": body.from_dt, "to_dt": body.to_dt},
        "simulation_only": True,
        "decision_mode": "prepared_schema" if body.decision_schema else "direct_text_legacy",
        "notices": [
            "실험용 LAYA 판단입니다. 금융 정확도·점수 보정은 입증되지 않았습니다.",
            "종가 판단 → 다음 봉 시가 체결. "
            "보유 중에는 청산·보유, 무보유 중에는 진입·관망만 가능합니다.",
            "불확실·장애 시 관망/보유합니다. "
            "기존 대기 주문은 취소되지 않으며 다음 체결 가능 봉에 반영됩니다.",
            "감시는 선택한 과거 봉의 순차 재생입니다. "
            "백엔드 종료 시 세션이 사라지므로 기록은 JSON으로 내보내 주세요.",
            "전액 단일 포지션·소수 수량, 미청산 평가는 마지막 종가이며 "
            "별도 손절·익절 강제 규칙은 꺼져 있습니다.",
            "합성 예제이며 실제 시장 성과가 아닙니다."
            if body.data_source == "demo"
            else "수정주가 캐시 재생입니다. 당시 알려졌던 데이터의 스냅샷을 보증하지 않습니다.",
        ],
    }
    if body.replace_session_id is not None:
        del sessions[body.replace_session_id]
    sessions[session_id] = SimulationSession(simulation, snapshot)
    return snapshot


@router.post("/step")
async def step_simulation(request: Request, body: SessionRequest) -> dict[str, Any]:
    session = _session(request, body)
    # A browser disconnect must not orphan a worker halfway through a decision.
    await asyncio.shield(_start(session, single=True))
    return session.snapshot


@router.post("/run")
async def run_simulation(request: Request, body: SessionRequest) -> dict[str, Any]:
    session = _session(request, body)
    _start(session, single=False)
    return session.snapshot


@router.post("/pause")
async def pause_simulation(request: Request, body: SessionRequest) -> dict[str, Any]:
    session = _session(request, body)
    session.pause_requested = True
    session.snapshot["pause_requested"] = session.snapshot["status"] == "running"
    return session.snapshot


@router.post("/result")
async def simulation_result(request: Request, body: SessionRequest) -> dict[str, Any]:
    return _session(request, body).snapshot
