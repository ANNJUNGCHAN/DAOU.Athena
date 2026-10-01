"""API/worker integration with real simulation accounting and injected decisions."""

import asyncio
import threading
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI

from athena_api.api import backtest_natural as api
from athena_api.backtest.natural_schema import validate_schema

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def client(monkeypatch):
    monkeypatch.setattr(api, "NaturalLayaClient", lambda: lambda req: {"action": "enter"})
    app = FastAPI()
    app.include_router(api.router)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c, app


def payload(**extra):
    return {
        "strategy": "종가가 전일보다 높으면 진입하고 하락하면 청산한다.",
        "data_source": "demo",
        "costs": {"fee_bps": 10, "tax_bps": 20, "slippage_bps": 5},
        **extra,
    }


async def post(client, operation, body):
    return await client.post(f"/api/v1/backtest/natural/{operation}", json=body)


async def test_demo_step_exposes_fill_timing_and_costs(client):
    c, _ = client
    created = await post(c, "create", payload())
    assert created.status_code == 200, created.text
    report = created.json()
    assert report["cursor"] == 0 and report["status"] == "paused"
    assert report["symbol"] == "SYNTHETIC" and report["simulation_only"]
    body = {"session_id": report["session_id"]}
    first = (await post(c, "step", body)).json()
    assert first["cursor"] == 1 and not first["trades"]
    second = (await post(c, "step", body)).json()
    assert second["cursor"] == 2 and len(second["trades"]) == 1
    assert second["trades"][0]["side"] == "buy"
    assert second["trades"][0]["fee"] > 0
    assert (await post(c, "result", body)).json() == second


async def test_pause_preserves_inflight_step_and_blocks_concurrent_run(client, monkeypatch):
    c, app = client
    entered, release = threading.Event(), threading.Event()

    def provider(req):
        entered.set()
        assert release.wait(5), "test did not release provider"
        return {"action": "wait"}

    monkeypatch.setattr(api, "NaturalLayaClient", lambda: provider)
    report = (await post(c, "create", payload())).json()
    body = {"session_id": report["session_id"]}
    try:
        assert (await post(c, "run", body)).json()["status"] == "running"
        assert await asyncio.to_thread(entered.wait, 5)
        assert (await post(c, "step", body)).status_code == 409
        assert (await post(c, "run", body)).status_code == 409
        replacement = await post(c, "create", payload(replace_session_id=body["session_id"]))
        assert replacement.status_code == 409
        assert len(app.state.natural_simulations) == 1
        paused = (await post(c, "pause", body)).json()
        assert paused["status"] == "running" and paused["pause_requested"]
        assert (await post(c, "result", body)).json()["cursor"] == 0
    finally:
        release.set()
        await app.state.natural_simulations[body["session_id"]].task
    paused = (await post(c, "result", body)).json()
    assert paused["status"] == "paused" and paused["cursor"] == 1
    assert not paused["pause_requested"]


async def test_run_finishes_and_cannot_restart_completed_session(client):
    c, app = client
    body = {"session_id": (await post(c, "create", payload())).json()["session_id"]}
    assert (await post(c, "run", body)).status_code == 200
    await app.state.natural_simulations[body["session_id"]].task
    report = (await post(c, "result", body)).json()
    assert report["cursor"] == report["total"] == 36
    assert report["status"] == "done"
    assert (await post(c, "run", body)).status_code == 409


async def test_cached_data_has_no_fetch_or_live_order_dependency(client):
    c, app = client
    calls = []

    async def coverage(*key):
        calls.append(("coverage", key))
        return SimpleNamespace(first_dt="20260102", last_dt="20260105")

    async def candles(*key, **bounds):
        calls.append(("candles", key, bounds))
        return [
            SimpleNamespace(dt=dt, open=100, high=102, low=98, close=101, volume=100)
            for dt in ["20260102", "20260105"]
        ]

    app.state.backtest_store = SimpleNamespace(coverage=coverage, candles=candles)
    response = await post(
        c,
        "create",
        payload(
            data_source="cache",
            symbol="005930",
            from_dt="20260102",
            to_dt="20260105",
        ),
    )
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 2 and response.json()["adjusted"] is True
    assert calls[1][2] == {"start": "20260102", "end": "20260105"}
    response = await post(
        c,
        "create",
        payload(
            data_source="cache",
            from_dt="20260101",
            to_dt="20260105",
        ),
    )
    assert response.status_code == 409
    assert len(calls) == 3  # no download, no use of a partial cache


@pytest.mark.parametrize(
    "overrides",
    [
        {"strategy": "  "},
        {"initial_cash": -1},
        {"initial_cash": True},
        {"costs": {"fee_bps": True, "tax_bps": 0, "slippage_bps": 0}},
        {"costs": {"fee_bps": -1, "tax_bps": 0, "slippage_bps": 0}},
        {"data_source": "live"},
        {"server_url": "https://example.com"},
        {"data_source": "cache", "from_dt": "20260230", "to_dt": "20260301"},
    ],
)
async def test_invalid_request_never_creates_session(client, overrides):
    c, app = client
    response = await post(c, "create", payload(**overrides))
    assert response.status_code == 422
    assert not getattr(app.state, "natural_simulations", {})


async def test_unknown_session_is_explicit(client):
    c, _ = client
    assert (await post(c, "result", {"session_id": "missing"})).status_code == 404


async def test_replacement_does_not_orphan_paused_sessions_or_lose_invalid_draft(client):
    c, app = client
    report = (await post(c, "create", payload())).json()
    for _ in range(api.MAX_SESSIONS + 1):
        previous = report["session_id"]
        invalid = await post(c, "create", payload(replace_session_id=previous, strategy=""))
        assert invalid.status_code == 422
        assert previous in app.state.natural_simulations
        replaced = await post(c, "create", payload(replace_session_id=previous))
        assert replaced.status_code == 200, replaced.text
        report = replaced.json()
        assert len(app.state.natural_simulations) == 1
        assert previous not in app.state.natural_simulations


def prepared_payload():
    return {
        "strategy": "종가가 전일보다 높으면 진입하고 하락하면 청산한다.",
        "author": {"provider": "codex", "model": "api-test-model"},
        "draft": {
            "title": "전일 종가 비교",
            "explanation": "전일 종가보다 높으면 진입, 낮으면 청산하고 같으면 유지한다.",
            "required_observations": ["close", "previous_close"],
            "flat": {
                "type": "choice",
                "instructions": "Enter iff {close} > {previous_close}; otherwise wait.",
                "criteria": {"enter": "Enter", "wait": "Wait"},
            },
            "holding": {
                "type": "choice",
                "instructions": "Exit iff {close} < {previous_close}; otherwise hold.",
                "criteria": {"exit": "Exit", "hold": "Hold"},
            },
        },
    }


async def test_prepare_contract_seals_source_without_running_laya(client, monkeypatch):
    c, app = client

    def should_not_construct():
        raise AssertionError("schema preparation must not start LAYA")

    monkeypatch.setattr(api, "NaturalLayaClient", should_not_construct)
    contract = (await c.get("/api/v1/backtest/natural/schema-contract")).json()
    assert {"close", "previous_close"} <= contract["observations"].keys()
    assert contract["limits"]["head_utf8_bytes"] == 480
    assert contract["draft_schema"]["additionalProperties"] is False
    body = prepared_payload()
    body["strategy"] = "  " + body["strategy"] + "  "
    response = await post(c, "prepare", body)
    assert response.status_code == 200, response.text
    prepared = response.json()
    assert prepared["strategy"] == body["strategy"].strip()
    schema = prepared["decision_schema"]
    assert validate_schema(schema, prepared["strategy"]) == schema
    assert schema["author"] == body["author"]
    assert not getattr(app.state, "natural_simulations", {})


@pytest.mark.parametrize(
    "invalid_kind", ["unknown_observation", "extra_code", "blank_source", "false_author"]
)
async def test_prepare_rejects_invalid_schema_and_metadata(client, invalid_kind):
    c, app = client
    body = prepared_payload()
    if invalid_kind == "unknown_observation":
        body["draft"]["flat"]["instructions"] = "Enter if {tomorrow_close} > {close}; else wait."
    elif invalid_kind == "extra_code":
        body["draft"]["code"] = "print('must never execute')"
    elif invalid_kind == "blank_source":
        body["strategy"] = "  "
    else:
        body["author"]["provider"] = "unconfigured-provider"
    response = await post(c, "prepare", body)
    assert response.status_code == 422, response.text
    assert not getattr(app.state, "natural_simulations", {})


async def test_prepared_session_binds_source_and_preserves_previous_session(client, monkeypatch):
    c, app = client
    requests = []
    monkeypatch.setattr(
        api, "NaturalLayaClient", lambda: lambda req: requests.append(req) or {"action": "wait"}
    )
    prepared = (await post(c, "prepare", prepared_payload())).json()
    create_body = payload(
        strategy=prepared["strategy"], decision_schema=prepared["decision_schema"]
    )
    created = await post(c, "create", create_body)
    assert created.status_code == 200, created.text
    session = created.json()
    assert session["decision_mode"] == "prepared_schema"
    stepped = await post(c, "step", {"session_id": session["session_id"]})
    assert stepped.status_code == 200
    assert requests[0]["decision_schema"] == prepared["decision_schema"]
    create_body["replace_session_id"] = session["session_id"]
    create_body["strategy"] += "다른 조건"
    assert (await post(c, "create", create_body)).status_code == 422
    create_body["strategy"] = prepared["strategy"]
    create_body["decision_schema"]["flat"]["instructions"] = "Always enter."
    assert (await post(c, "create", create_body)).status_code == 422
    assert list(app.state.natural_simulations) == [session["session_id"]]
    assert len(requests) == 1
