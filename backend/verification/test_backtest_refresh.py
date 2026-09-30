import asyncio
import json
import sqlite3
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from athena_api.api import backtest
from athena_api.backtest.data import contract_for, refresh_candles
from athena_api.backtest.runner import BacktestRunner
from athena_api.backtest.store import BacktestStore, Candle
from athena_api.brain.db import SqliteOwner

NOW = datetime(2026, 1, 10, tzinfo=UTC)
KEY = ("005930", "day", True)
OLD = [Candle(dt, price, price + 1, price - 1, price, 100)
       for dt, price in [("20260102", 100), ("20260105", 110), ("20260106", 120)]]


@pytest.fixture
async def database(tmp_path):
    owner = SqliteOwner(tmp_path / "synthetic-backtest.sqlite3")
    await owner.open()
    store = BacktestStore(owner)
    await store.open()
    await store.upsert_candles(*KEY, OLD)
    await store.upsert_coverage(*KEY, first_dt=OLD[0].dt, last_dt=OLD[-1].dt, fetched_at=NOW, pages=1)
    yield owner, store
    await owner.close()


def raw_rows(items, period="day"):
    contract = contract_for(period)
    return {contract.container_alias: [
        {contract.time_alias: dt, contract.open_alias: str(close),
         contract.high_alias: str(close + 1), contract.low_alias: str(close - 1),
         contract.close_alias: str(close), contract.volume_alias: "100"}
        for dt, close in items
    ]}


FIRST = [("20260109", 200), ("20260108", 198), ("20260107", 196), ("20260106", 194)]
SECOND = [("20260105", 192), ("20260102", 190)]


def fetcher(pages):
    remaining = iter(pages)
    calls = []

    async def fetch(tr_id, body, cont_yn, next_key):
        calls.append((tr_id, dict(body), cont_yn, next_key))
        page = next(remaining)
        if isinstance(page, Exception):
            raise page
        return page

    return fetch, calls


async def refresh(store, fetch, **overrides):
    return await refresh_candles(
        **dict(store=store, fetch_page=fetch, stk_cd=KEY[0], period=KEY[1], adjusted=KEY[2],
               from_dt="20260105", base_dt="20260109", now=lambda: NOW, **overrides),
    )


async def audits(owner):
    return await owner.run(lambda: [dict(row) for row in owner.require().execute("SELECT * FROM bt_candle_refresh")])


@pytest.mark.asyncio
async def test_adjustment_job_has_structured_recovery_and_does_not_change_cache(database):
    owner, store = database
    before = await store.candle_snapshot(*KEY)
    fetch, _ = fetcher([(raw_rows(FIRST), "Y", "page2")])
    runner = BacktestRunner(store)
    job = runner.start_backfill("synthetic", fetch_page=fetch, stk_cd=KEY[0], period="day",
                                adjusted=True, from_dt="20260105", base_dt="20260109")
    await job.task
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(backtest_runner=runner)))
    status = await backtest.get_job(request, job.id)
    assert status["status"] == "failed"
    assert status["error_code"] == "ADJUSTMENT_DETECTED"
    assert status["recovery"] == dict(stk_cd=KEY[0], period="day", adjusted=True,
                                      from_dt="20260102", to_dt="20260109",
                                      mismatch_dates=["20260106"], estimated_pages=1, est_seconds=1.0)
    assert "기존 데이터는 보존" in status["error"]
    assert await store.candle_snapshot(*KEY) == before
    assert await audits(owner) == []


@pytest.mark.asyncio
async def test_refresh_preserves_previous_snapshot_and_other_series_and_strategies(database):
    owner, store = database
    before = await store.candle_snapshot(*KEY)
    await store.upsert_candles("OTHER", "day", True, OLD)
    await store.create_strategy("synthetic-strategy", "keep", "python", created_at=NOW)
    fetch, calls = fetcher([(raw_rows(FIRST), "Y", "page2"), (raw_rows(SECOND), "N", None)])
    snapshot_id = await refresh(store, fetch)
    saved = (await audits(owner))[0]
    assert saved["id"] == snapshot_id
    assert json.loads(saved["previous_snapshot_json"]) == before
    assert json.loads(saved["replacement_snapshot_json"]) == await store.candle_snapshot(*KEY)
    assert [c.close for c in await store.candles(*KEY)] == [190, 192, 194, 196, 198, 200]
    assert (await store.coverage(*KEY)).first_dt == "20260102"
    assert (await store.coverage(*KEY)).last_dt == "20260109"
    assert await store.candles("OTHER", "day", True) == tuple(OLD)
    assert (await store.strategy("synthetic-strategy")).name == "keep"
    assert calls[0][1] == {"stk_cd": KEY[0], "base_dt": "20260109", "upd_stkpc_tp": "1"}
    assert calls[1][2:] == ("Y", "page2")


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["missing_old", "conflict", "invalid_ohlc", "invalid_date",
                                     "invalid_volume", "missing_field", "incomplete", "empty", "network"])
async def test_bad_or_incomplete_refresh_preserves_cache_and_coverage(database, failure):
    owner, store = database
    before = await store.candle_snapshot(*KEY)
    first, second = raw_rows(FIRST), raw_rows(SECOND)
    contract = contract_for("day")
    pages = [(first, "Y", "page2"), (second, "N", None)]
    if failure == "missing_old":
        pages[1] = (raw_rows(SECOND[:1]), "N", None)
    if failure == "conflict":
        pages[1] = (raw_rows([("20260106", 333), *SECOND]), "N", None)
    if failure == "invalid_ohlc":
        second[contract.container_alias][0][contract.high_alias] = "1"
    if failure == "invalid_date":
        second[contract.container_alias][0][contract.time_alias] = "20269999"
    if failure == "invalid_volume":
        second[contract.container_alias][0][contract.volume_alias] = "1.5"
    if failure == "missing_field":
        del second[contract.container_alias][0][contract.close_alias]
    if failure == "incomplete":
        pages = [(first, "Y", None)]
    if failure == "empty":
        pages[1] = (raw_rows([]), "N", None)
    if failure == "network":
        pages[1] = RuntimeError("synthetic network failure")
    fetch, _ = fetcher(pages)
    with pytest.raises((ValueError, RuntimeError)):
        await refresh(store, fetch)
    assert await store.candle_snapshot(*KEY) == before
    assert await audits(owner) == []


@pytest.mark.asyncio
async def test_cancel_during_staging_keeps_original_and_has_no_audit(database):
    owner, store = database
    before = await store.candle_snapshot(*KEY)
    waiting = asyncio.Event()
    async def fetch(_tr, _body, cont, _key):
        if cont == "N":
            return raw_rows(FIRST), "Y", "page2"
        waiting.set()
        await asyncio.Event().wait()
    task = asyncio.create_task(refresh(store, fetch))
    await waiting.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert await store.candle_snapshot(*KEY) == before
    assert await audits(owner) == []


@pytest.mark.asyncio
async def test_cancel_while_atomic_apply_is_queued_keeps_original(database):
    owner, store = database
    before = await store.candle_snapshot(*KEY)
    reached, release = asyncio.Event(), asyncio.Event()
    original_run = owner.run
    async def delayed_run(fn):
        if fn.__name__ == "write":
            reached.set()
            await release.wait()
        return await original_run(fn)
    fetch, _ = fetcher([(raw_rows(FIRST + SECOND), "N", None)])
    with patch.object(owner, "run", delayed_run):
        task = asyncio.create_task(refresh(store, fetch))
        await reached.wait()
        task.cancel()
        await asyncio.sleep(0)
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert await store.candle_snapshot(*KEY) == before
    assert await audits(owner) == []


@pytest.mark.asyncio
async def test_concurrent_cache_change_is_not_overwritten(database):
    owner, store = database
    concurrent = None
    async def fetch(_tr, _body, cont, _key):
        nonlocal concurrent
        if cont == "N":
            return raw_rows(FIRST), "Y", "page2"
        await store.upsert_candles(*KEY, [Candle("20260105", 111, 112, 110, 111, 100)])
        concurrent = await store.candle_snapshot(*KEY)
        return raw_rows(SECOND), "N", None
    with pytest.raises(ValueError, match="다른 작업"):
        await refresh(store, fetch)
    assert await store.candle_snapshot(*KEY) == concurrent
    assert await audits(owner) == []


@pytest.mark.asyncio
async def test_failure_after_replacement_writes_rolls_everything_back(database):
    owner, store = database
    before = await store.candle_snapshot(*KEY)
    await owner.run(lambda: owner.require().execute(
        "CREATE TRIGGER fail_refresh BEFORE INSERT ON bt_candle_refresh BEGIN"
        " SELECT RAISE(FAIL, 'synthetic snapshot write failure'); END;"))
    fetch, _ = fetcher([(raw_rows(FIRST + SECOND), "N", None)])
    with pytest.raises(sqlite3.IntegrityError):
        await refresh(store, fetch)
    assert await store.candle_snapshot(*KEY) == before
    assert await audits(owner) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("period", ["day", "week", "month"])
async def test_completed_calendar_range_does_not_require_a_bar_on_weekends_or_period_boundaries(database, period):
    _, store = database
    key = ("CALENDAR", period, True)
    candle = Candle("20260102", 100, 101, 99, 100, 100)
    await store.upsert_candles(*key, [candle])
    await store.upsert_coverage(*key, first_dt=candle.dt, last_dt=candle.dt, fetched_at=NOW, pages=1)
    fetch, calls = fetcher([(raw_rows([("20260102", 200)], period), "N", None)])
    await refresh_candles(store=store, fetch_page=fetch, stk_cd=key[0], period=period,
                          adjusted=True, from_dt="20260101", base_dt="20260104", now=lambda: NOW)
    coverage = await store.coverage(*key)
    assert (coverage.first_dt, coverage.last_dt) == ("20260101", "20260104")
    assert calls[0][1]["base_dt"] == "20260104"
    plan = await backtest.data_plan(SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(backtest_store=store))),
                                   dict(stk_cd=key[0], period=period, adjusted=True, from_dt="20260101", to_dt="20260104"))
    assert plan["needed_pages"] == 0


@pytest.mark.asyncio
async def test_explicit_refresh_route_and_job_success_receipt(database):
    owner, store = database
    runner = BacktestRunner(store)
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(backtest_runner=runner)))
    body = dict(stk_cd=KEY[0], period="day", adjusted=True, from_dt="20260105", to_dt="20260109", full_refresh=True)
    fetch, _ = fetcher([(raw_rows(FIRST + SECOND), "N", None)])
    with patch.object(backtest, "kiwoom_fetch_page", return_value=fetch):
        response = await backtest.start_backfill(request, body, None)
    job = runner.get(json.loads(response.body)["job_id"])
    await job.task
    status = await backtest.get_job(request, job.id)
    assert status["status"] == "done"
    assert status["refresh_snapshot_id"] == (await audits(owner))[0]["id"]
    with pytest.raises(HTTPException) as caught:
        await backtest.start_backfill(request, {**body, "full_refresh": "true"}, None)
    assert caught.value.status_code == 422
