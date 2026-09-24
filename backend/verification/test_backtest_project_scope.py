import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from athena_api.api import backtest
from athena_api.api.projects import TECHNIQUE_SEED_SOURCE
from athena_api.backtest import flow, optimize, presets
from athena_api.backtest.engine import DEFAULT_INITIAL_CASH, run_backtest
from athena_api.backtest.metrics import compute_metrics
from athena_api.backtest.runner import _align_signals, _run_code_signals
from athena_api.backtest.schema import from_kis_yaml
from athena_api.backtest.store import Candle, Coverage
from athena_api.projects.store import ProjectStore


@pytest.mark.asyncio
async def test_registration_and_listing_use_the_app_project_registry(tmp_path):
    registry_root = tmp_path / "app-projects"
    folder = tmp_path / "technique"
    folder.mkdir()
    (folder / "strategy.py").write_text(TECHNIQUE_SEED_SOURCE, encoding="utf-8")
    project = ProjectStore(registry_root).open_external(str(folder))
    state = SimpleNamespace(
        settings=SimpleNamespace(
            projects_root=registry_root, backtest_db_path=tmp_path / "backtest.sqlite3"
        ),
        backtest_store=object(),
    )
    request = SimpleNamespace(app=SimpleNamespace(state=state))
    with patch(
        "athena_api.config.get_settings",
        side_effect=AssertionError("global settings must not be read"),
    ):
        result = await backtest.register_user_strategy_route(
            request, {"project_id": project.id, "path": "strategy.py", "name": "QA technique"}
        )
        assert result["project_id"] == project.id
        listed = await backtest.list_user_strategies_route(request)
        assert listed["strategies"][0]["exists"] is True
        assert backtest._project_root("missing", request) is None


SOURCE = '''PARAMS = {
    "fast": {"default": 20, "min": 5, "max": 30, "step": 5, "type": "int"},
    "slow": {"default": 60, "min": 40, "max": 120, "step": 20, "type": "int"},
}
def signals(df, p):
    return df.assign(entry=df.close == p["fast"], exit=df.close == p["slow"])[["entry", "exit"]]
'''


def yaml_spec(*, code=True):
    raw = from_kis_yaml(presets._SMA_CROSSOVER).model_dump(mode="json")
    raw["data"] = dict(symbols=["005930"], period="day", adjusted=True,
                       from_="20260101", to="20260108")
    raw["data"]["from"] = raw["data"].pop("from_")
    raw["costs"] = dict(fee_bps=0, tax_bps=0, slippage_bps=0)
    if code:
        raw["strategy"]["params"] = flow.params_specs(SOURCE)
        raw["strategy"]["indicators"] = []
        raw["strategy"]["entry"]["conditions"] = []
        raw["strategy"]["exit"]["conditions"] = []
    return json.dumps(raw)


class CachedStore:
    async def coverage(self, *_):
        return Coverage("005930", "day", True, "20260101", "20260108", "20260108", 1)

    async def candles(self, *_, **kwargs):
        return [Candle(f"202601{i + 1:02}", price, price + 1, price - 1, price, 100)
                for i, price in enumerate([5, 10, 20, 40, 45, 60, 65, 70])]


def request():
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(backtest_store=CachedStore())))


def test_declared_grid_has_all_thirty_valid_combinations():
    declared = flow.params_specs(SOURCE)
    assert declared["fast"] == dict(default=20, min=5, max=30, step=5, type="int")
    ranges = [optimize.ParamRange(name, p["min"], p["max"], p["step"], True)
              for name, p in declared.items()]
    combos = list(optimize._combinations(ranges))
    assert len(combos) == 30
    assert {c["fast"] for c in combos} == {5, 10, 15, 20, 25, 30}
    assert {c["slow"] for c in combos} == {40, 60, 80, 100, 120}


@pytest.mark.asyncio
async def test_registered_api_preserves_ranges_from_current_file(tmp_path):
    folder = tmp_path / "technique"
    folder.mkdir()
    strategy = folder / "strategy.py"
    strategy.write_text(SOURCE, encoding="utf-8")
    projects_root = tmp_path / "registry"
    project = ProjectStore(projects_root).open_external(str(folder))
    req = request()
    req.app.state.settings = SimpleNamespace(projects_root=projects_root,
                                             backtest_db_path=tmp_path / "bt.sqlite3")
    await backtest.register_user_strategy_route(req, dict(project_id=project.id,
                                                        path="strategy.py", name="QA"))
    listed = await backtest.list_user_strategies_route(req)
    item = listed["strategies"][0]
    assert item["params"] == {"fast": 20, "slow": 60}
    assert item["param_specs"] == flow.params_specs(SOURCE)
    strategy.write_text(SOURCE.replace('"max": 30', '"max": 10'), encoding="utf-8")
    invalid = (await backtest.list_user_strategies_route(req))["strategies"][0]
    assert invalid["param_specs"] == {}
    assert invalid["params_error"]


@pytest.mark.asyncio
async def test_python_signal_error_is_a_failed_trial_not_a_yaml_fallback():
    source = SOURCE.replace(
        'return df.assign', 'raise ValueError("synthetic signal failure")\n    return df.assign',
    )
    result = await backtest.optimize_route(request(), dict(yaml=yaml_spec(), source=source,
        ranges=[dict(name="fast", start=5, stop=5, step=5, is_int=True)]))
    assert result["best"] is None
    assert "synthetic signal failure" in result["trials"][0]["error"]
    assert result["trials"][0]["sharpe"] is None


@pytest.mark.asyncio
async def test_python_route_runs_real_sandbox_signals_and_matches_single_run_metrics():
    body = dict(yaml=yaml_spec(), source=SOURCE, ranges=[
        dict(name="fast", start=5, stop=10, step=5, is_int=True),
        dict(name="slow", start=40, stop=40, step=20, is_int=True),
    ])
    result = await backtest.optimize_route(request(), body)
    assert len(result["trials"]) == 2
    assert all(t["error"] is None and t["trades"] > 0 for t in result["trials"])
    assert result["trials"][0]["total_return"] != result["trials"][1]["total_return"]
    spec = from_kis_yaml(body["yaml"], require_conditions=False)
    df = backtest._candles_to_frame(await CachedStore().candles())
    outcome = await _run_code_signals(SOURCE, df, {"fast": 5, "slow": 40})
    assert outcome["ok"]
    signals = _align_signals(outcome["signals_df"], df.index)
    assert int(signals.entry.sum()) == 1
    run = run_backtest(df, signals, spec.risk, spec.costs)
    metrics = compute_metrics(run.equity, run.trades, df, initial_cash=DEFAULT_INITIAL_CASH)
    assert result["trials"][0]["total_return"] == pytest.approx(metrics.total_return)


@pytest.mark.asyncio
@pytest.mark.parametrize("axis", [
    dict(start=0, stop=30, step=5, is_int=True),
    dict(start=5, stop=30, step=8, is_int=True),
    dict(start=5, stop=30, step=5, is_int=False),
])
async def test_api_rejects_invalid_python_domains_before_running(axis):
    with pytest.raises(HTTPException) as error:
        await backtest.optimize_route(request(), dict(yaml=yaml_spec(), source=SOURCE,
                                                     ranges=[dict(name="fast", **axis)]))
    assert error.value.status_code == 422


@pytest.mark.asyncio
async def test_yaml_optimization_still_uses_declarative_signals():
    body = dict(yaml=yaml_spec(code=False), ranges=[
        dict(name="fast", start=2, stop=3, step=1, is_int=True),
        dict(name="slow", start=4, stop=4, step=1, is_int=True),
    ])
    result = await backtest.optimize_route(request(), body)
    spec = from_kis_yaml(body["yaml"])
    df = backtest._candles_to_frame(await CachedStore().candles())
    expected = optimize.optimize(spec, df, backtest._parse_ranges(body["ranges"]))
    assert len(result["trials"]) == 2
    assert result["trials"][0]["total_return"] == expected.trials[0].total_return


@pytest.mark.parametrize("text", [SOURCE.replace('"step": 5', '"step": 0'),
                                       SOURCE.replace('"max": 30', '"max": 10')])
def test_invalid_declared_ranges_are_not_replaced_with_guessed_bounds(text):
    with pytest.raises(ValueError):
        flow.params_specs(text)


def test_large_grid_rejects_before_materializing_any_candidate(monkeypatch):
    ranges = [optimize.ParamRange("fast", 1, 10000, 1),
              optimize.ParamRange("slow", 1, 10000, 1)]
    def forbidden(*args):
        raise AssertionError("candidate allocated before grid bound checked")
    monkeypatch.setattr(optimize.ParamRange, "value_at", forbidden)
    with pytest.raises(ValueError, match="1000"):
        optimize._search_combinations(ranges, "grid", None, None, None)
    with pytest.raises(ValueError, match="1000"):
        optimize._search_combinations(ranges, "random", 10, 1, lambda p: False)


def test_large_random_grid_samples_only_requested_candidates(monkeypatch):
    ranges = [optimize.ParamRange("fast", 1, 10000, 1),
              optimize.ParamRange("slow", 1, 10000, 1)]
    calls = 0
    original = optimize.ParamRange.value_at
    def counted(self, index):
        nonlocal calls
        calls += 1
        return original(self, index)
    monkeypatch.setattr(optimize.ParamRange, "value_at", counted)
    combos = optimize._search_combinations(ranges, "random", 10, 42, None)
    assert calls == 20
    assert len(combos) == 10
    assert len({(c["fast"], c["slow"]) for c in combos}) == 10
    assert all(1 <= c["fast"] <= 10000 and 1 <= c["slow"] <= 10000 for c in combos)


@pytest.mark.asyncio
async def test_large_declared_grid_api_returns_explicit_error_before_sandbox(monkeypatch):
    source = SOURCE.replace('"max": 30', '"max": 10000').replace('"max": 120', '"max": 10000')
    def forbidden(*args):
        raise AssertionError("axis materialized")
    monkeypatch.setattr(optimize.ParamRange, "values", forbidden)
    with pytest.raises(HTTPException) as error:
        await backtest.optimize_route(request(), dict(yaml=yaml_spec(), source=source, ranges=[
            dict(name="fast", start=5, stop=10000, step=5, is_int=True),
            dict(name="slow", start=40, stop=10000, step=20, is_int=True),
        ]))
    assert error.value.status_code == 422
    assert "1000" in error.value.detail
