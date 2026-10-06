"""Product scope regressions, with synthetic inputs and isolated lifecycle storage.

Scope (2026-10-06): Kiwoom mock-account orders confirmed by the user on the order ticket are
in scope. Real-account orders and automated trading stay blocked at every layer.
"""
import asyncio
import json
import os
from collections import OrderedDict
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from pydantic import SecretStr
from starlette.datastructures import Headers

from athena_api import dependencies
from athena_api.accounts import REAL_ACCOUNT_ORDER_MESSAGE, is_mock_order_client
from athena_api.api import canvas_push, llm_tools
from athena_api.backtest import deploy_orders, deploy_runner
from athena_api.config import KIWOOM_MOCK_BASE_URL, Settings
from athena_api.errors import KiwoomNotReadyError
from athena_api.generated.registry import TR_REGISTRY
from athena_api.generated.runtime import call_order_tr
from athena_api.kiwoom import KiwoomClient
from athena_api.lifespan import build_lifespan
from athena_api.main import create_app
from athena_api.selector.schemas import DescribeRequest, ResolveRequest, SearchRequest
from athena_mcp import backtest_tools, routine_tools, selector_tools

REAL_BASE_URL = "https://api.kiwoom.com"


def _mock_client():
    return KiwoomClient(SimpleNamespace(is_ready=True), None, client=SimpleNamespace())


def _real_client():
    # The shipped client refuses a real host, so a real-account client can only be a double.
    return SimpleNamespace(base_url=REAL_BASE_URL, is_ready=True)


ORDER_KEY = "launch-order-key"


def _request(order_client, *, enable_order_api=True, token="synthetic", order_key=ORDER_KEY):
    settings = SimpleNamespace(
        enable_order_api=enable_order_api, local_bearer_token=token,
        order_key=SecretStr(order_key) if order_key else None,
    )
    return SimpleNamespace(headers={}, query_params={}, app=SimpleNamespace(state=SimpleNamespace(
        settings=settings, kiwoom_order_client=order_client,
        kiwoom_client=SimpleNamespace(is_ready=True),
    )))


def test_mock_predicate_reads_the_posting_host_and_fails_closed():
    assert _mock_client().base_url == KIWOOM_MOCK_BASE_URL
    assert is_mock_order_client(_mock_client())
    for client in (_real_client(), None, SimpleNamespace(is_ready=True),
                   SimpleNamespace(base_url=None), SimpleNamespace(base_url=REAL_BASE_URL + "/")):
        assert not is_mock_order_client(client)
    with pytest.raises(ValueError):
        KiwoomClient(SimpleNamespace(is_ready=True), None, client=SimpleNamespace(),
                     base_url=REAL_BASE_URL)


@pytest.mark.parametrize("order_client", [_real_client(), SimpleNamespace(is_ready=True), None])
def test_order_dependency_refuses_real_and_unknown_accounts(order_client):
    request = _request(order_client)
    assert dependencies.get_order_kiwoom_client(request) is None
    with pytest.raises(HTTPException) as caught:
        dependencies.require_order_kiwoom_client(request)
    assert caught.value.status_code == 403
    assert caught.value.detail == REAL_ACCOUNT_ORDER_MESSAGE
    # Real-account reads stay available.
    assert dependencies.get_kiwoom_client(request) is request.app.state.kiwoom_client


def test_order_dependency_returns_mock_client_only_when_orders_are_enabled():
    client = _mock_client()
    assert dependencies.require_order_kiwoom_client(_request(client)) is client
    for disabled in (_request(client, enable_order_api=False), _request(client, token=None),
                     _request(client, order_key=None)):
        assert dependencies.get_order_kiwoom_client(disabled) is None
        assert not dependencies.orders_available(disabled)
        with pytest.raises(KiwoomNotReadyError):
            dependencies.require_order_kiwoom_client(disabled)


def test_orders_available_follows_the_per_account_order_permission():
    for permitted in (True, False):
        request = _request(None)
        request.app.state.kiwoom_default_account = "acct"
        request.app.state.kiwoom_accounts = {"acct": SimpleNamespace(
            order_client=_mock_client(), permits_order=lambda _scope, ok=permitted: ok)}
        assert dependencies.orders_available(request) is permitted


async def test_default_settings_path_enables_orders_only_through_the_app_spawn_env(monkeypatch):
    for name in ("ATHENA_ENABLE_ORDER_API", "ATHENA_ORDER_KEY", "ATHENA_LOCAL_BEARER_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("ATHENA_LOCAL_BEARER_TOKEN", "synthetic")
    plain = Settings(_env_file=None)
    assert plain.enable_order_api is False and plain.order_key is None
    app = create_app(plain)
    app.state.kiwoom_order_client = _mock_client()
    request = SimpleNamespace(headers={}, query_params={}, app=app)
    assert await llm_tools.get_order_environment(request) == {
        "order_environment": "mock", "mock": True, "orders_available": False}

    # What Electron's backend spawn env sets (app/lib/main/backend-launcher.js).
    monkeypatch.setenv("ATHENA_ENABLE_ORDER_API", "true")
    monkeypatch.setenv("ATHENA_ORDER_KEY", ORDER_KEY)
    spawned = Settings(_env_file=None)
    assert spawned.enable_order_api is True
    assert spawned.order_key.get_secret_value() == ORDER_KEY
    app = create_app(spawned)
    # The key is read once; children of the backend cannot inherit it.
    assert "ATHENA_ORDER_KEY" not in os.environ
    app.state.kiwoom_order_client = _mock_client()
    request = SimpleNamespace(headers={}, query_params={}, app=app)
    assert await llm_tools.get_order_environment(request) == {
        "order_environment": "mock", "mock": True, "orders_available": True}


class _Reached(Exception):
    pass


class _BrokerProbe:
    base_url = KIWOOM_MOCK_BASE_URL
    is_ready = True

    async def post_with_headers(self, *_args, **_kwargs):
        raise _Reached


def _order_request(**headers):
    state = SimpleNamespace(
        settings=SimpleNamespace(order_key=SecretStr(ORDER_KEY)), local_bearer_token="synthetic",
        order_idempotency_lock=asyncio.Lock(), order_idempotency_cache=OrderedDict(),
    )
    return SimpleNamespace(headers=Headers(headers=headers), app=SimpleNamespace(state=state))


async def test_order_route_requires_the_launch_key_and_refuses_model_callers():
    payload = TR_REGISTRY["kt10000"].request_model.model_validate(
        {"dmst_stex_tp": "KRX", "stk_cd": "005930", "ord_qty": "1", "trde_tp": "3"})

    async def place(request):
        return await call_order_tr("kt10000", payload, request, None, _BrokerProbe(),
                                   "Bearer synthetic", "true", "key-1")

    for headers in ({}, {"X-Athena-Order-Key": "wrong"},
                    {"X-Athena-Order-Key": ORDER_KEY, "X-Athena-Caller": "model"}):
        with pytest.raises(HTTPException) as caught:
            await place(_order_request(**headers))
        assert caught.value.status_code == 403
    no_key_configured = _order_request(**{"X-Athena-Order-Key": ORDER_KEY})
    no_key_configured.app.state.settings.order_key = None
    with pytest.raises(HTTPException) as caught:
        await place(no_key_configured)
    assert caught.value.status_code == 403
    with pytest.raises(_Reached):
        await place(_order_request(**{"X-Athena-Order-Key": ORDER_KEY}))


async def test_order_endpoint_rechecks_mock_host_before_any_order_state():
    # app.state has no idempotency cache: reaching it would raise AttributeError instead.
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace()))
    for client in (_real_client(), SimpleNamespace(is_ready=True), None):
        with pytest.raises(HTTPException) as caught:
            await call_order_tr("kt10000", SimpleNamespace(), request, None, client,
                                "Bearer synthetic", "true", "key-1")
        assert caught.value.status_code == 403
        assert caught.value.detail == REAL_ACCOUNT_ORDER_MESSAGE


class _Selector:
    def __init__(self):
        self.calls = []

    def search(self, payload):
        self.calls.append(("search", payload.intent))
        return "searched"

    def describe(self, payload):
        self.calls.append(("describe", payload.intent))
        return "described"

    def resolve(self, payload, account=""):
        self.calls.append(("resolve", payload.intent))
        return "resolved"


async def test_llm_order_discovery_is_mock_only_and_queries_stay_open():
    real, mock = _request(_real_client()), _request(_mock_client())
    selector = _Selector()
    order_calls = (
        lambda request: llm_tools.search_operations(
            SearchRequest(query="삼성전자 1주 매수", intent="order"), request, selector),
        lambda request: llm_tools.describe_operation(
            DescribeRequest(operation_ref="base:kt10000", intent="order"), request, selector),
        lambda request: llm_tools.resolve_operation(
            ResolveRequest(question="삼성전자 1주 매수", intent="order"), request, selector, ""),
    )
    for call in order_calls:
        with pytest.raises(HTTPException) as caught:
            await call(real)
        assert caught.value.status_code == 403
    assert selector.calls == []
    assert await llm_tools.search_operations(
        SearchRequest(query="삼성전자 현재가", intent="query"), real, selector) == "searched"
    for call in order_calls:
        await call(mock)
    assert [name for name, _ in selector.calls] == ["search", "search", "describe", "resolve"]
    real_env = {"order_environment": "real", "mock": False, "orders_available": False}
    assert await llm_tools.get_order_environment(real) == real_env
    assert await llm_tools.get_order_environment(_request(None)) == real_env
    mock_env = {"order_environment": "mock", "mock": True, "orders_available": True}
    assert await llm_tools.get_order_environment(mock) == mock_env


async def test_app_selector_dispatch_refuses_order_intent_for_real_account():
    selector = _Selector()
    payload = canvas_push.SelectorDispatchRequest(
        question="삼성전자 1주 시장가 매수", intent="order")
    with pytest.raises(HTTPException) as caught:
        await canvas_push.selector_dispatch(payload, _request(_real_client()), None, None, None,
                                            selector, "")
    assert caught.value.status_code == 403
    assert selector.calls == []


def _gateway_client(mock, requests, available=None):
    available = mock if available is None else available

    def respond(request):
        requests.append(request.url.path)
        if request.url.path == "/api/v1/llm/order-environment":
            return httpx.Response(200, json={"order_environment": "mock" if mock else "real",
                                             "mock": mock, "orders_available": available})
        return httpx.Response(200, json={"synthetic": True})
    return httpx.AsyncClient(base_url="http://synthetic", transport=httpx.MockTransport(respond))


@pytest.mark.parametrize("tool", selector_tools.SELECTOR_TOOL_NAMES[:3])
async def test_gateway_blocks_order_discovery_for_real_or_unknown_account(tool, tmp_path):
    result = await selector_tools.dispatch(tool, {"intent": "order"}, None)
    assert result.isError
    assert result.meta["athena/error_origin"] == "gateway-blocked"
    assert result.content[0].text == REAL_ACCOUNT_ORDER_MESSAGE
    requests = []
    async with _gateway_client(False, requests) as client:
        result = await selector_tools.dispatch(tool, {"intent": "order"}, client,
                                               timing_log_path=tmp_path / "timing.jsonl")
    assert result.meta["athena/error_origin"] == "gateway-blocked"
    assert requests == ["/api/v1/llm/order-environment"]
    requests = []
    async with _gateway_client(True, requests, available=False) as client:
        result = await selector_tools.dispatch(tool, {"intent": "order"}, client,
                                               timing_log_path=tmp_path / "timing.jsonl")
    assert result.meta["athena/error_origin"] == "gateway-blocked"
    assert result.content[0].text == selector_tools.ORDERS_UNAVAILABLE_MESSAGE
    assert requests == ["/api/v1/llm/order-environment"]


async def test_gateway_allows_order_discovery_for_mock_account_without_cache(tmp_path):
    class _Cache:
        def get(self, *_args):
            raise AssertionError("order discovery must not be served from cache")

        def put(self, *_args):
            raise AssertionError("order discovery must not be cached")

    requests = []
    async with _gateway_client(True, requests) as client:
        result = await selector_tools.dispatch(
            "athena_search", {"query": "삼성전자 1주 매수", "intent": "order"}, client,
            timing_log_path=tmp_path / "timing.jsonl", cache=_Cache())
    assert not result.isError
    assert requests == ["/api/v1/llm/order-environment", "/api/v1/llm/tools/search"]


async def test_gateway_keeps_query_discovery_and_backtest_results(tmp_path):
    requests = []
    def respond(request):
        requests.append(request.url.path)
        return httpx.Response(200, json={'synthetic': True})
    async with httpx.AsyncClient(base_url='http://synthetic', transport=httpx.MockTransport(respond)) as client:
        result = await selector_tools.dispatch('athena_search', {'query': '삼성전자 현재가', 'intent': 'query'},
                                              client, timing_log_path=tmp_path / 'timing.jsonl')
        assert not result.isError
        result = await backtest_tools.dispatch({'action': 'result', 'run_id': 'synthetic-run'}, client)
        assert not result.isError
    assert len(requests) == 2


async def test_gateway_surface_offers_order_intent_but_no_deployment_navigation():
    for tool in selector_tools.builtin_tool_defs():
        intent = tool.inputSchema['properties'].get('intent')
        if intent:
            assert 'order' in intent['enum']
            assert 'query' in intent['enum']
    search = next(t for t in selector_tools.builtin_tool_defs() if t.name == 'athena_search')
    assert '모의투자' in search.description and '자동매매' in search.description
    result = await backtest_tools.dispatch({'action': 'navigate', 'navigate': {'tab': 'deploy'}}, None)
    assert result.isError
    result = await backtest_tools.dispatch({'action': 'navigate', 'navigate': {'tab': 'history'}}, None)
    assert not result.isError


async def test_automated_deployment_orders_stay_blocked_even_for_mock_account():
    class _Client:
        base_url = KIWOOM_MOCK_BASE_URL
        is_ready = True

        async def post_with_headers(self, *_args, **_kwargs):
            raise AssertionError("automated orders must never reach the broker client")

    plan = deploy_orders.OrderPlan(tr_id="kt10000", body={"stk_cd": "005930"},
                                   idempotency_key="deploy-synthetic", qty=1, side="buy")
    app = SimpleNamespace(state=SimpleNamespace())
    outcome = await deploy_orders.submit_order(app, _Client(), plan)
    assert outcome.stage == "blocked"
    assert outcome.blocked_reason == deploy_orders.AUTOMATED_ORDER_BLOCKED_REASON
    assert deploy_orders.AUTOMATED_ORDERS_IN_SCOPE is False


async def test_deployment_runner_never_hands_out_the_order_client(monkeypatch):
    from athena_api.api import backtest as backtest_api

    seen = []

    async def evaluate(_app, _store, row, *, order_client, params):
        seen.append(order_client)

    class _Store:
        async def deployments(self):
            return ("armed-row",)

    monkeypatch.setattr(backtest_api, "evaluate_deployment_once", evaluate)
    monkeypatch.setattr(deploy_runner, "armed_rows", lambda rows: list(rows))
    app = SimpleNamespace(state=SimpleNamespace(
        backtest_store=_Store(), kiwoom_order_client=_mock_client()))
    await deploy_runner.make_runner(app)()
    assert seen == [None]


async def test_startup_keeps_alerts_and_candle_cache_without_restoring_deployment_worker(tmp_path):
    paths = {name: tmp_path / name for name, field in Settings.model_fields.items()
             if field.annotation is Path}
    settings = Settings(_env_file=None, **paths, kiwoom_accounts=[], kiwoom_app_key=None,
                        kiwoom_secret_key=None, brain_enabled=False, backtest_enabled=True,
                        routines_enabled=True, enable_order_api=True,
                        local_bearer_token='synthetic', backtest_max_workers=1)
    app = FastAPI()
    async with build_lifespan(settings)(app):
        scheduler = app.state.routines_runtime.scheduler
        assert scheduler.run_deployments_once is None
        assert scheduler._tasks
        assert all('_deployment_loop' not in task.get_coro().__qualname__ for task in scheduler._tasks)
        assert app.state.backtest_store is not None


async def test_once_draft_keeps_schedule_and_note_instead_of_using_update_proposal():
    requests = []
    draft = {
        'symbol': '005930',
        'condition': {'source': 'schedule.once', 'op': 'at', 'value': '2030-09-30T19:33:00+09:00'},
        'note': 'ATHENA-QA 알림 문구만 출력. 시세 조회 금지.',
        'main_card_candidate': {'operation_ref': 'base:ka10001', 'args': {'stk_cd': '005930'}, 'title': '종목 정보'},
    }
    def respond(request):
        requests.append(request)
        return httpx.Response(200, json={'id': 'synthetic-draft', 'status': 'draft', **draft})
    async with httpx.AsyncClient(base_url='http://synthetic', transport=httpx.MockTransport(respond)) as client:
        result = await routine_tools.dispatch({'action': 'draft', 'draft': draft}, client)
    assert not result.isError
    assert len(requests) == 1
    assert requests[0].method == 'POST'
    assert requests[0].url.path == '/api/v1/routines/draft'
    assert json.loads(requests[0].content) == draft
    payload = json.loads(result.content[0].text)
    assert payload['id'] == 'synthetic-draft'
    assert payload['status'] == 'draft'
    assert '승인' in payload['notice']


def test_order_key_is_redacted_from_logs():
    from athena_api.logging_config import _collect_secrets

    settings = SimpleNamespace(
        local_bearer_token=None,
        order_key=SecretStr("per-launch-order-key"),
        kiwoom_accounts=[],
    )
    assert "per-launch-order-key" in _collect_secrets(settings)
