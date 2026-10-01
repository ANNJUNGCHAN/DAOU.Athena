"""Natural-language decisions over the existing, deterministic simulation engine.

Each step replays the bounded prefix with recorded actions before asking for one new
decision. Accounting, outstanding orders and risk exits belong only to engine.py.
Waiting/holding does not cancel an already pending order. Nothing submits orders.
"""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Callable, Mapping
from dataclasses import asdict
from typing import Any

import pandas as pd

from athena_api.backtest.engine import (
    DEFAULT_INITIAL_CASH,
    BacktestResult,
    DecisionState,
    run_backtest,
)
from athena_api.backtest.natural_schema import validate_schema
from athena_api.backtest.schema import CostsSpec, RiskSpec

MAX_BARS = 512
_COLUMNS = ("open", "high", "low", "close", "volume")
DecisionProvider = Callable[[dict[str, Any]], Mapping[str, Any]]


def _json_copy(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))


def _canonical_numbers(value: Any) -> Any:
    # JSON.parse/stringify in the app changes 1.0 to 1 and -0.0 to 0. Hash the
    # numeric value consistently while retaining every non-integral float bit.
    if isinstance(value, float) and math.isfinite(value) and value.is_integer():
        return int(value)
    if isinstance(value, list):
        return [_canonical_numbers(item) for item in value]
    if isinstance(value, Mapping):
        return {key: _canonical_numbers(item) for key, item in value.items()}
    return value


def _hash(value: Any, version: int = 2) -> str:
    if version == 2:
        value = _canonical_numbers(value)
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                         allow_nan=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _number(value: Any, name: str, *, minimum: float = 0, maximum: float | None = None) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a finite number")
    value = float(value)
    if not math.isfinite(value) or value < minimum or (maximum is not None and value >= maximum):
        raise ValueError(f"{name} is outside the supported range")
    return value


def _validated_frame(df: pd.DataFrame) -> pd.DataFrame:
    if not 1 <= len(df) <= MAX_BARS:
        raise ValueError(f"candles must contain 1..{MAX_BARS} bars")
    if any(column not in df for column in _COLUMNS):
        raise ValueError("candles require open, high, low, close and volume")
    if pd.api.types.is_numeric_dtype(df.index.dtype):
        raise ValueError("candles require calendar dates, not numeric row indexes")
    frame = df.loc[:, list(_COLUMNS)].copy(deep=True)
    try:
        index = pd.DatetimeIndex(pd.to_datetime(df.index, errors="raise"))
    except (ValueError, TypeError) as exc:
        raise ValueError("candles require calendar dates") from exc
    if (index.hasnans or not index.is_monotonic_increasing or not index.is_unique
            or index.tz is not None or not index.equals(index.normalize())):
        raise ValueError("candles must have unique ascending dates without time or timezone")
    frame.index = index
    for column in _COLUMNS:
        values = [_number(value, column) for value in frame[column].tolist()]
        if column != "volume" and any(value <= 0 for value in values):
            raise ValueError("OHLC prices must be positive")
        frame[column] = values
    if ((frame.high < frame[["open", "close", "low"]].max(axis=1)).any()
            or (frame.low > frame[["open", "close", "high"]].min(axis=1)).any()):
        raise ValueError("candles have inconsistent OHLC ranges")
    return frame


def _rows(df: pd.DataFrame) -> list[dict[str, Any]]:
    return [dict(dt=index.strftime("%Y-%m-%d"), **{k: float(row[k]) for k in _COLUMNS})
            for index, row in df.iterrows()]


def _request(strategy: str, rows: list[dict[str, Any]], state: DecisionState,
             decision_schema: dict[str, Any] | None = None) -> dict[str, Any]:
    account = asdict(state)
    account.pop("bar_index")
    account.pop("dt")
    request = {
        "strategy": strategy,
        "as_of": state.dt,
        "observations": rows[:state.bar_index + 1],
        "state": account,
        "allowed_actions": ["exit", "hold"] if state.holding else ["enter", "wait"],
    }
    if decision_schema is not None:
        request["decision_schema"] = _json_copy(decision_schema)
    return request


def _signals(action: str) -> tuple[bool, bool]:
    return action == "enter", action == "exit"


class NaturalSimulation:
    """A bounded, inspectable session. Providers receive JSON copies of past/current data only."""

    def __init__(
        self, strategy: str, df: pd.DataFrame, provider: DecisionProvider, *,
        costs: CostsSpec | Mapping[str, Any], risk: RiskSpec | Mapping[str, Any] | None = None,
        initial_cash: float = DEFAULT_INITIAL_CASH,
        decision_schema: Mapping[str, Any] | None = None,
    ) -> None:
        if not isinstance(strategy, str) or not 1 <= len(strategy.strip()) <= 2000:
            raise ValueError("strategy must contain 1..2000 characters")
        self._strategy = strategy if decision_schema is not None else strategy.strip()
        self._decision_schema = (
            validate_schema(decision_schema, self._strategy)
            if decision_schema is not None else None
        )
        self._df = _validated_frame(df)
        if not isinstance(costs, (CostsSpec, Mapping)):
            raise ValueError("explicit costs are required")
        costs_raw = costs.model_dump() if isinstance(costs, CostsSpec) else dict(costs)
        for key in ("fee_bps", "tax_bps", "slippage_bps"):
            _number(costs_raw.get(key), key, maximum=10_000)
        self._costs = CostsSpec.model_validate(costs_raw)
        risk_raw = risk.model_dump() if isinstance(risk, RiskSpec) else risk
        if risk_raw is None:
            risk_raw = {"stop_loss": {"enabled": False, "percent": 0},
                        "take_profit": {"enabled": False, "percent": 0},
                        "position": {"sizing": "all_in"}}
        for key in ("stop_loss", "take_profit"):
            toggle = risk_raw.get(key, {})
            if not isinstance(toggle.get("enabled"), bool):
                raise ValueError(f"{key}.enabled must be boolean")
            percent = _number(toggle.get("percent"), f"{key}.percent", maximum=100)
            if toggle["enabled"] and percent <= 0:
                raise ValueError(f"enabled {key} requires 0 < percent < 100")
        self._risk = RiskSpec.model_validate(risk_raw)
        if self._risk.position.sizing != "all_in":
            raise ValueError("only all_in position sizing is supported")
        self._initial_cash = _number(initial_cash, "initial_cash")
        if self._initial_cash <= 0:
            raise ValueError("initial_cash must be positive")
        self._provider = provider
        self._rows = _rows(self._df)
        self._decisions: list[dict[str, Any]] = []
        self._result = BacktestResult(trades=(), equity=(), costs_flag=None)

    def step(self) -> dict[str, Any]:
        """Advance one historical bar, keeping every previous model decision fixed."""
        cursor = len(self._decisions)
        if cursor == len(self._df):
            raise StopIteration("simulation is complete")
        record: dict[str, Any] = {}

        def decide(state: DecisionState) -> tuple[bool, bool]:
            if state.bar_index < cursor:
                return _signals(self._decisions[state.bar_index]["action"])
            request = _request(self._strategy, self._rows, state, self._decision_schema)
            fallback: str | None = None
            try:
                response = _json_copy(dict(self._provider(_json_copy(request))))
            except Exception as exc:  # provider boundary: unavailable/invalid means no new order
                response = {"action": None, "error_type": type(exc).__name__}
                fallback = "provider_error"
            action = response.get("action")
            if action not in request["allowed_actions"] or response.get("fallback_reason"):
                fallback = (fallback or response.get("fallback_reason")
                            or "illegal_or_missing_action")
                fallback = str(fallback)
                action = "hold" if state.holding else "wait"
            record.update({
                "index": cursor, "as_of": state.dt, "request": request,
                "request_hash": _hash(request), "response": response,
                "action": action, "fallback_reason": fallback,
            })
            record["decision_hash"] = _hash(record)
            return _signals(action)

        prefix = self._df.iloc[:cursor + 1]
        self._result = run_backtest(prefix, pd.DataFrame(index=prefix.index), self._risk,
                                    self._costs, initial_cash=self._initial_cash, decide=decide)
        self._decisions.append(record)
        return _json_copy(record)

    def run(self) -> dict[str, Any]:
        while len(self._decisions) < len(self._df):
            self.step()
        return self.report()

    def report(self) -> dict[str, Any]:
        inputs = {"strategy": self._strategy, "candles": self._rows,
                  "costs": self._costs.model_dump(), "risk": self._risk.model_dump(),
                  "initial_cash": self._initial_cash}
        if self._decision_schema is not None:
            inputs["decision_schema"] = self._decision_schema
        current = {"holding": False, "cash": self._initial_cash, "qty": 0.0,
                   "entry_price": 0.0, "pending_entry": False, "pending_exit": False}
        if self._decisions:
            latest = self._decisions[-1]
            current = dict(latest["request"]["state"])
            if latest["action"] == "enter":
                current["pending_entry"] = True
            elif latest["action"] == "exit":
                current["pending_exit"] = True
        return _json_copy({
            "schema_version": 1, "hash_version": 2, "mode": "simulation", "input": inputs,
            "input_hash": _hash(inputs), "cursor": len(self._decisions), "total": len(self._df),
            "current_state": current, "decisions": self._decisions,
            "trades": [asdict(trade) for trade in self._result.trades],
            "equity": [asdict(point) for point in self._result.equity],
            "flags": ["모의 시뮬레이션", "종가 판단 · 다음 체결 가능 봉 시가 체결",
                      "관망·보유는 이미 대기 중인 모의 주문을 취소하지 않습니다",
                      "LAYA 금융 판단 정확도는 검증되지 않았습니다"],
        })


def replay_natural(report: Mapping[str, Any]) -> BacktestResult:
    """Verify stored observations/actions and replay without a model call.

    Hashes detect accidental changes; they are not signatures proving audit authenticity.
    Future bars in the input are excluded when replaying a partially stepped report.
    """
    if report.get("schema_version") != 1 or report.get("mode") != "simulation":
        raise ValueError("unsupported simulation report")
    hash_version = report.get("hash_version", 1)
    if type(hash_version) is not int or hash_version not in {1, 2}:
        raise ValueError("unsupported simulation hash version")
    inputs = report["input"]
    if _hash(inputs, hash_version) != report.get("input_hash"):
        raise ValueError("input hash mismatch")
    frame = pd.DataFrame(inputs["candles"]).set_index("dt")
    simulation = NaturalSimulation(inputs["strategy"], frame, lambda _: {}, costs=inputs["costs"],
                                   risk=inputs["risk"], initial_cash=inputs["initial_cash"],
                                   decision_schema=inputs.get("decision_schema"))
    records = report["decisions"]
    cursor = report["cursor"]
    if (isinstance(cursor, bool) or not isinstance(cursor, int) or cursor != len(records)
            or not 0 <= cursor <= len(frame) or report.get("total") != len(frame)):
        raise ValueError("invalid replay cursor")
    current = {"holding": False, "cash": simulation._initial_cash, "qty": 0.0,
               "entry_price": 0.0, "pending_entry": False, "pending_exit": False}

    def decide(state: DecisionState) -> tuple[bool, bool]:
        nonlocal current
        record = records[state.bar_index]
        payload = {key: value for key, value in record.items() if key != "decision_hash"}
        request = _request(simulation._strategy, simulation._rows, state,
                           simulation._decision_schema)
        if (_hash(payload, hash_version) != record.get("decision_hash")
                or _hash(request, hash_version) != record.get("request_hash")
                or record.get("request") != request
                or record.get("index") != state.bar_index or record.get("as_of") != state.dt
                or record.get("action") not in request["allowed_actions"]):
            raise ValueError(f"decision audit mismatch at bar {state.bar_index}")
        current = request["state"]
        if record["action"] == "enter":
            current["pending_entry"] = True
        elif record["action"] == "exit":
            current["pending_exit"] = True
        return _signals(record["action"])

    prefix = simulation._df.iloc[:cursor]
    result = run_backtest(prefix, pd.DataFrame(index=prefix.index), simulation._risk,
                          simulation._costs, initial_cash=simulation._initial_cash, decide=decide)
    if ([asdict(t) for t in result.trades] != report.get("trades")
            or [asdict(p) for p in result.equity] != report.get("equity")):
        raise ValueError("recorded accounting differs from replay")
    if _hash(current) != _hash(report.get("current_state")):
        raise ValueError("recorded current state differs from replay")
    return result


__all__ = ["MAX_BARS", "DecisionProvider", "NaturalSimulation", "replay_natural"]
