import asyncio
import json
import sqlite3
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from athena_api.api import backtest
from athena_api.api.projects import TECHNIQUE_SEED_SOURCE
from athena_api.backtest import flow, optimize, presets
from athena_api.backtest.engine import DEFAULT_INITIAL_CASH, run_backtest
from athena_api.backtest.metrics import compute_metrics
from athena_api.backtest.runner import BacktestRunner, _align_signals, _run_code_signals
from athena_api.backtest.schema import from_kis_yaml
from athena_api.backtest.store import BacktestStore, Candle, Coverage
from athena_api.brain.db import SqliteOwner
from athena_api.projects.store import ProjectStore


@pytest.mark.asyncio
async def test_registration_and_listing_use_the_app_project_registry(tmp_path, database):
    registry_root = tmp_path / "app-projects"
    folder = tmp_path / "technique"
    folder.mkdir()
    (folder / "strategy.py").write_text(TECHNIQUE_SEED_SOURCE, encoding="utf-8")
    project = ProjectStore(registry_root).open_external(str(folder))
    state = SimpleNamespace(
        settings=SimpleNamespace(
            projects_root=registry_root, backtest_db_path=tmp_path / "backtest.sqlite3"
        ),
        backtest_store=database[1],
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


@pytest.fixture
async def database(tmp_path):
    owner = SqliteOwner(tmp_path / "backtest.sqlite3")
    await owner.open()
    store = BacktestStore(owner)
    await store.open()
    yield owner, store
    await owner.close()


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
async def test_registered_api_preserves_ranges_from_current_file(tmp_path, database):
    folder = tmp_path / "technique"
    folder.mkdir()
    strategy = folder / "strategy.py"
    strategy.write_text(SOURCE, encoding="utf-8")
    projects_root = tmp_path / "registry"
    project = ProjectStore(projects_root).open_external(str(folder))
    req = request()
    req.app.state.backtest_store = database[1]
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


@pytest.mark.asyncio
async def test_registered_versions_survive_restart_without_merging_files(tmp_path, database):
    owner, store = database
    folder = tmp_path / "registered-folder"
    folder.mkdir()
    (folder / "strategy.py").write_text(SOURCE, encoding="utf-8")
    (folder / "other.py").write_text(SOURCE, encoding="utf-8")
    settings = SimpleNamespace(projects_root=tmp_path / "projects",
                               backtest_db_path=tmp_path / "backtest.sqlite3")
    project = ProjectStore(settings.projects_root).open_external(str(folder))
    req = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(settings=settings,
        backtest_store=store, backtest_runner=BacktestRunner(store))))
    first = await backtest.register_user_strategy_route(req, dict(project_id=project.id,
        path="strategy.py", name="same display name"))
    other = await backtest.register_user_strategy_route(req, dict(project_id=project.id,
        path="other.py", name="same display name"))
    await store.upsert_candles("005930", "day", True, await CachedStore().candles())
    await store.upsert_coverage("005930", "day", True, first_dt="20260101",
        last_dt="20260108", fetched_at=datetime.now(UTC), pages=1)
    body = dict(yaml=yaml_spec(), source=SOURCE, project_id=project.id,
                user_strategy_id=first["id"], strategy_path="strategy.py")
    for patch_body in [{"project_id": "different-project"}, {"strategy_path": "other.py"}]:
        with pytest.raises(HTTPException) as error:
            await backtest.start_run(req, {**body, **patch_body})
        assert error.value.status_code == 422
    assert await store.strategies() == ()
    concurrent = await asyncio.gather(backtest.start_run(req, body), backtest.start_run(req, body))
    responses = [json.loads(item.body) for item in concurrent]
    for item in responses:
        await req.app.state.backtest_runner.get(item["run_id"]).task
        assert req.app.state.backtest_runner.get(item["run_id"]).status == "done"
    response = responses[0]
    assert response["strategy_id"] == f'registered:{first["id"]}'
    assert responses[1]["strategy_id"] == response["strategy_id"]
    assert {v.version for v in await store.versions(response["strategy_id"])} == {1, 2}
    active_before_restart = await store.active_version_id(response["strategy_id"])
    anonymous_response = await backtest.start_run(req, dict(yaml=yaml_spec(), source=SOURCE))
    anonymous = json.loads(anonymous_response.body)
    await req.app.state.backtest_runner.get(anonymous["run_id"]).task
    assert anonymous["strategy_id"] != response["strategy_id"]
    await owner.close()
    restarted_owner = SqliteOwner(settings.backtest_db_path)
    await restarted_owner.open()
    try:
        restarted_store = BacktestStore(restarted_owner)
        await restarted_store.open()
        req.app.state.backtest_store = restarted_store
        req.app.state.backtest_runner = BacktestRunner(restarted_store)
        listed = (await backtest.list_user_strategies_route(req))["strategies"]
        mapped = {item["id"]: item for item in listed}
        assert mapped[first["id"]]["backend_strategy_id"] == response["strategy_id"]
        assert mapped[first["id"]]["active_version_id"] == active_before_restart
        assert mapped[other["id"]]["backend_strategy_id"] is None
        version_list = await backtest.list_versions_route(req, response["strategy_id"])
        assert len(version_list["versions"]) == 2
        failing_source = SOURCE.replace(
            'return df.assign', 'raise ValueError("synthetic failure")\n    return df.assign',
        )
        failed_responses = await asyncio.gather(*[
            backtest.start_run(req, {**body, "source": failing_source}) for _ in range(2)
        ])
        failed_runs = [json.loads(item.body) for item in failed_responses]
        for failed in failed_runs:
            await req.app.state.backtest_runner.get(failed["run_id"]).task
            assert req.app.state.backtest_runner.get(failed["run_id"]).status == "failed"
        versions = await restarted_store.versions(response["strategy_id"])
        assert {v.version for v in versions} == {1, 2, 3, 4}
        assert next(v for v in versions if v.active).id in {r["version_id"] for r in failed_runs}
        assert sum(v.active for v in versions) == 1
        assert len(await restarted_store.versions(anonymous["strategy_id"])) == 1
        assert await restarted_store.strategy(f'registered:{other["id"]}') is None
    finally:
        await restarted_owner.close()


@pytest.mark.asyncio
async def test_registered_version_insert_failure_rolls_back_identity_and_activation(database):
    owner, store = database
    now = datetime.now(UTC)
    await store.add_registered_run_version(
        "registered:existing", "v1", "QA", SOURCE, created_at=now,
    )
    await owner.run(lambda: owner.require().execute(
        "CREATE TRIGGER fail_version BEFORE INSERT ON bt_strategy_version"
        " BEGIN SELECT RAISE(FAIL, 'synthetic disk failure'); END"
    ))
    for strategy_id in ("registered:existing", "registered:new"):
        with pytest.raises(sqlite3.IntegrityError, match="synthetic disk failure"):
            await store.add_registered_run_version(strategy_id, "v2", "QA", SOURCE, created_at=now)
    assert await store.strategy("registered:new") is None
    assert len(await store.versions("registered:existing")) == 1
    assert await store.active_version_id("registered:existing") == "v1"
