import copy
import hashlib
import json
from dataclasses import asdict

import pandas as pd
import pytest

from athena_api.backtest.engine import run_backtest
from athena_api.backtest.natural import NaturalSimulation, replay_natural
from athena_api.backtest.natural_schema import seal_schema
from athena_api.backtest.schema import CostsSpec, RiskSpec


def candles(prices=(100, 110, 120, 130)):
    return pd.DataFrame({
        "open": prices, "high": [p + 2 for p in prices],
        "low": [p - 2 for p in prices], "close": [p + 1 for p in prices],
        "volume": [100] * len(prices),
    }, index=pd.date_range("2026-01-01", periods=len(prices)))


ZERO_COSTS = {"fee_bps": 0, "tax_bps": 0, "slippage_bps": 0}
NO_RISK = {"stop_loss": {"enabled": False, "percent": 0},
           "take_profit": {"enabled": False, "percent": 0},
           "position": {"sizing": "all_in"}}


def scripted(actions, seen=None):
    iterator = iter(actions)

    def provider(request):
        if seen is not None:
            seen.append(copy.deepcopy(request))
        return {"action": next(iterator), "raw": {"model": "test-only"}}

    return provider


def test_next_open_fill_uses_actual_position_and_explicit_costs():
    seen = []
    costs = {"fee_bps": 10, "tax_bps": 20, "slippage_bps": 30}
    simulation = NaturalSimulation("상승하면 진입하고 다음 날 청산", candles(),
                                   scripted(["enter", "exit", "wait", "wait"], seen),
                                   costs=costs, initial_cash=10_000)
    first = simulation.step()
    assert first["action"] == "enter"
    assert simulation.report()["trades"] == []
    assert simulation.report()["current_state"]["pending_entry"] is True
    report = simulation.run()
    assert [r["allowed_actions"] for r in seen] == [
        ["enter", "wait"], ["exit", "hold"], ["enter", "wait"], ["enter", "wait"]]
    assert seen[1]["state"]["holding"] is True
    assert seen[1]["state"]["qty"] > 0
    assert report["trades"][0]["dt"] == "2026-01-02"
    assert report["trades"][0]["price"] == pytest.approx(110 * 1.003)
    assert report["trades"][1]["dt"] == "2026-01-03"
    assert report["trades"][1]["price"] == pytest.approx(120 * 0.997)
    expected_qty = 10_000 / (110 * 1.003 * 1.001)
    assert report["equity"][-1]["cash"] == pytest.approx(expected_qty * 120 * .997 * .997)
    assert len(seen) == 4  # prefix replay does not call the provider again


def test_pending_entry_survives_wait_on_zero_volume_bar():
    frame = candles()
    frame.loc[frame.index[1], "volume"] = 0
    simulation = NaturalSimulation("조건이면 진입", frame,
                                   scripted(["enter", "wait", "hold", "hold"]), costs=ZERO_COSTS)
    report = simulation.run()
    assert report["decisions"][1]["request"]["state"]["pending_entry"] is True
    assert report["trades"][0]["dt"] == "2026-01-03"
    assert report["decisions"][2]["request"]["state"]["holding"] is True


def test_pending_exit_survives_hold_on_locked_bar():
    frame = candles((100, 105, 106, 107))
    frame.loc[frame.index[2], ["open", "high", "low", "close"]] = 106
    simulation = NaturalSimulation("진입 후 청산", frame,
                                   scripted(["enter", "exit", "hold", "wait"]), costs=ZERO_COSTS)
    report = simulation.run()
    assert report["decisions"][2]["request"]["state"]["pending_exit"] is True
    assert report["trades"][1]["dt"] == "2026-01-04"


def test_illegal_actions_and_provider_failure_fail_closed_for_current_position():
    actions = iter(["exit", "enter", RuntimeError("private error"), "enter"])

    def provider(_):
        value = next(actions)
        if isinstance(value, Exception):
            raise value
        return {"action": value}

    report = NaturalSimulation("조건 확인", candles(), provider, costs=ZERO_COSTS).run()
    assert [d["action"] for d in report["decisions"]] == ["wait", "enter", "hold", "hold"]
    assert report["decisions"][2]["fallback_reason"] == "provider_error"
    assert "private error" not in str(report)
    assert len(report["trades"]) == 1


def test_no_future_access_and_future_mutation_preserves_prefix_decisions():
    first = candles()
    second = candles((100, 110, 999, 9999))
    requests = [[], []]
    reports = []
    for frame, seen in zip((first, second), requests, strict=True):
        simulation = NaturalSimulation("오늘 종가가 105보다 크면 진입", frame,
            lambda req, seen=seen: seen.append(copy.deepcopy(req)) or {
                "action": "enter" if req["observations"][-1]["close"] > 105 else "wait"},
            costs=ZERO_COSTS)
        simulation.step()
        simulation.step()
        reports.append(simulation.report())
    assert requests[0] == requests[1]
    assert [len(r["observations"]) for r in requests[0]] == [1, 2]
    assert reports[0]["decisions"] == reports[1]["decisions"]
    assert reports[0]["equity"] == reports[1]["equity"]


def test_provider_mutation_does_not_change_audit_input():
    def mutate(request):
        request["observations"][0]["close"] = 999
        request["state"]["cash"] = 0
        return {"action": "wait"}

    report = NaturalSimulation("관망", candles(), mutate, costs=ZERO_COSTS).run()
    assert report["decisions"][0]["request"]["observations"][0]["close"] == 101
    assert report["decisions"][0]["request"]["state"]["cash"] > 0
    replay_natural(report)


def test_intrabar_stop_uses_engine_state_before_close_decision():
    frame = candles((100, 100, 100))
    frame.loc[frame.index[1], "low"] = 80
    risk = copy.deepcopy(NO_RISK)
    risk["stop_loss"] = {"enabled": True, "percent": 5}
    seen = []
    report = NaturalSimulation("진입 후 관망", frame,
        scripted(["enter", "wait", "wait"], seen), costs=ZERO_COSTS, risk=risk).run()
    assert [trade["side"] for trade in report["trades"]] == ["buy", "sell"]
    assert report["trades"][1]["reason"] == "stop_loss"
    assert seen[1]["state"]["holding"] is False
    assert seen[1]["state"]["qty"] == 0
    assert seen[1]["allowed_actions"] == ["enter", "wait"]


def test_recorded_replay_equals_original_engine_and_rejects_tampering():
    frame = candles()
    costs = CostsSpec(fee_bps=5, tax_bps=12, slippage_bps=8)
    report = NaturalSimulation("진입 후 청산", frame,
        scripted(["enter", "hold", "exit", "wait"]), costs=costs).run()
    replay = replay_natural(report)
    legacy = run_backtest(frame, pd.DataFrame({"entry": [True, False, False, False],
                          "exit": [False, False, True, False]}, index=frame.index),
                          RiskSpec.model_validate(NO_RISK), costs)
    assert replay == legacy
    assert report["trades"] == [asdict(t) for t in legacy.trades]
    for mutate in (
        lambda r: r["decisions"][1]["request"]["state"].update(qty=0),
        lambda r: r["decisions"][0].update(action="wait"),
        lambda r: r["input"]["candles"][0].update(close=999),
        lambda r: r["equity"][0].update(cash=0),
    ):
        changed = copy.deepcopy(report)
        mutate(changed)
        with pytest.raises(ValueError):
            replay_natural(changed)


def test_partial_and_empty_replay_and_last_bar_pending_order():
    simulation = NaturalSimulation("진입", candles((100,)), scripted(["enter"]), costs=ZERO_COSTS)
    assert replay_natural(simulation.report()).equity == ()
    report = simulation.run()
    assert report["trades"] == []
    assert report["current_state"]["pending_entry"] is True
    assert len(replay_natural(report).equity) == 1
    with pytest.raises(StopIteration):
        simulation.step()


@pytest.mark.parametrize("cursor", [0, 1, 2, 4])
@pytest.mark.parametrize("field", [
    "cash", "qty", "entry_price", "holding", "pending_entry", "pending_exit",
])
def test_replay_rejects_changed_displayed_account_state(cursor, field):
    simulation = NaturalSimulation("진입 후 청산", candles(),
        scripted(["enter", "exit", "enter", "hold"]), costs=ZERO_COSTS)
    for _ in range(cursor):
        simulation.step()
    report = simulation.report()
    replay_natural(report)
    original = report["current_state"][field]
    report["current_state"][field] = not original if isinstance(original, bool) else original + 1
    with pytest.raises(ValueError, match="recorded current state differs from replay"):
        replay_natural(report)


@pytest.mark.parametrize("change", [
    lambda f: f.assign(close=float("nan")),
    lambda f: f.assign(volume=-1),
    lambda f: f.assign(close=1000),
    lambda f: f.assign(open=True),
    lambda f: f.iloc[::-1],
    lambda f: f.set_axis([f.index[0]] * len(f)),
    lambda f: f.reset_index(drop=True),
])
def test_invalid_candles_rejected(change):
    with pytest.raises(ValueError):
        NaturalSimulation("관망", change(candles()), lambda _: {}, costs=ZERO_COSTS)


@pytest.mark.parametrize("field,value", [("fee_bps", -1), ("tax_bps", float("inf")),
                                        ("slippage_bps", 10_000), ("fee_bps", True)])
def test_invalid_costs_rejected(field, value):
    with pytest.raises(ValueError):
        NaturalSimulation("관망", candles(), lambda _: {}, costs={**ZERO_COSTS, field: value})


@pytest.mark.parametrize("text", ["", "   ", "a" * 2001])
def test_invalid_strategy_rejected(text):
    with pytest.raises(ValueError):
        NaturalSimulation(text, candles(), lambda _: {}, costs=ZERO_COSTS)


def test_nonfinite_response_uses_fallback_and_is_json_safe():
    report = NaturalSimulation("관망", candles((100,)),
        lambda _: {"action": "enter", "score": float("nan")}, costs=ZERO_COSTS).run()
    assert report["decisions"][0]["action"] == "wait"
    assert report["decisions"][0]["fallback_reason"] == "provider_error"
    replay_natural(report)


def test_fallback_reason_overrides_otherwise_valid_active_action():
    report = NaturalSimulation("조건 확인", candles((100,)),
        lambda _: {"action": "enter", "fallback_reason": "unreliable"},
        costs=ZERO_COSTS).run()
    assert report["decisions"][0]["action"] == "wait"
    assert report["current_state"]["pending_entry"] is False


@pytest.mark.parametrize("percent", [0, -1, 100, True, float("nan")])
def test_invalid_enabled_risk_rejected(percent):
    risk = copy.deepcopy(NO_RISK)
    risk["stop_loss"] = {"enabled": True, "percent": percent}
    with pytest.raises(ValueError):
        NaturalSimulation("관망", candles(), lambda _: {}, costs=ZERO_COSTS, risk=risk)


def test_compiled_schema_bound_to_input_requests_and_replay_without_mutable_aliases():
    source = "  105 초과에서 진입하고 100 이하에서 청산  "
    schema = seal_schema({
        "title": "Price thresholds", "explanation": "Enter over 105; exit at or below 100.",
        "required_observations": ["close"],
        "flat": {"type": "choice", "instructions": "Enter if {close} > 105; otherwise wait.",
                 "criteria": {"enter": "Enter", "wait": "Wait"}},
        "holding": {"type": "choice", "instructions": "Exit if {close} <= 100; otherwise hold.",
                    "criteria": {"exit": "Exit", "hold": "Hold"}},
    }, source, {"provider": "test", "model": "fixture"})
    original = copy.deepcopy(schema)
    seen = []
    simulation = NaturalSimulation(source, candles(),
        scripted(["enter", "hold", "exit", "wait"], seen), costs=ZERO_COSTS,
        decision_schema=schema)
    schema["flat"]["instructions"] = "external mutation"
    report = simulation.run()
    assert report["input"]["strategy"] == source
    assert report["input"]["decision_schema"] == original
    assert all(request["decision_schema"] == original for request in seen)
    replay_natural(report)
    report["input"]["decision_schema"]["title"] = "changed"
    with pytest.raises(ValueError, match="input hash mismatch"):
        replay_natural(report)


def test_compiled_schema_cannot_be_reused_for_another_source():
    schema = seal_schema({
        "title": "Wait", "explanation": "Always wait or hold.", "required_observations": [],
        "flat": {"type": "choice", "instructions": "Always wait.",
                 "criteria": {"enter": "Enter", "wait": "Wait"}},
        "holding": {"type": "choice", "instructions": "Always hold.",
                    "criteria": {"exit": "Exit", "hold": "Hold"}},
    }, "first source", {"provider": "test", "model": "fixture"})
    with pytest.raises(ValueError, match="source_text"):
        NaturalSimulation("another source", candles(), lambda _: {}, costs=ZERO_COSTS,
                          decision_schema=schema)


def test_export_roundtrip_preserves_replay_despite_integer_float_representation():
    costs = CostsSpec(fee_bps=5, tax_bps=12, slippage_bps=8)
    simulation = NaturalSimulation("진입·청산", candles(),
        scripted(["enter", "hold", "exit", "wait"]), costs=costs)
    report = simulation.run()
    assert report["hash_version"] == 2
    # JavaScript JSON serialization drops the .0 in integral-valued JSON numbers.
    exported = json.loads(json.dumps(report), parse_float=lambda value:
        int(float(value)) if float(value).is_integer() else float(value))
    assert type(report["input"]["initial_cash"]) is float
    assert type(exported["input"]["initial_cash"]) is int
    assert replay_natural(exported) == replay_natural(report)
    exported["decisions"][0]["response"]["action"] = "wait"
    with pytest.raises(ValueError, match="decision audit mismatch"):
        replay_natural(exported)


def test_legacy_hashes_remain_checked_and_unknown_hash_version_is_rejected():
    report = NaturalSimulation("진입·청산", candles(),
        scripted(["enter", "hold", "exit", "wait"]), costs=ZERO_COSTS).run()

    def legacy_hash(value):
        return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
            separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()

    report.pop("hash_version")
    report["input_hash"] = legacy_hash(report["input"])
    for record in report["decisions"]:
        record["request_hash"] = legacy_hash(record["request"])
        record["decision_hash"] = legacy_hash({key: value for key, value in record.items()
                                              if key != "decision_hash"})
    replay_natural(report)
    changed = copy.deepcopy(report)
    changed["input"]["initial_cash"] += 1
    with pytest.raises(ValueError, match="input hash mismatch"):
        replay_natural(changed)
    report["hash_version"] = 999
    with pytest.raises(ValueError, match="unsupported simulation hash version"):
        replay_natural(report)
