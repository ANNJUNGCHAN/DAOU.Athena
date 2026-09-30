"""Product scope regressions, with synthetic inputs and isolated lifecycle storage."""
import json
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI, HTTPException

from athena_api import dependencies
from athena_api.config import Settings
from athena_api.lifespan import build_lifespan
from athena_mcp import backtest_tools, routine_tools, selector_tools


def test_saved_order_opt_in_cannot_supply_execution_client_but_data_client_stays_available():
    data_client = SimpleNamespace(is_ready=True)
    request = SimpleNamespace(headers={}, query_params={}, app=SimpleNamespace(state=SimpleNamespace(
        settings=SimpleNamespace(enable_order_api=True, local_bearer_token='synthetic'),
        kiwoom_order_client=SimpleNamespace(is_ready=True), kiwoom_client=data_client,
    )))
    assert dependencies.get_order_kiwoom_client(request) is None
    with pytest.raises(HTTPException) as caught:
        dependencies.require_order_kiwoom_client(request)
    assert caught.value.status_code == 403
    assert dependencies.get_kiwoom_client(request) is data_client


@pytest.mark.parametrize('tool', selector_tools.SELECTOR_TOOL_NAMES[:3])
async def test_gateway_rejects_order_discovery_before_cache_or_http(tool):
    result = await selector_tools.dispatch(tool, {'intent': 'order'}, None)
    assert result.isError
    assert result.meta['athena/error_origin'] == 'gateway-blocked'
    assert '제공하지 않는다' in result.content[0].text


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


async def test_gateway_surface_excludes_order_and_deployment_navigation():
    for tool in selector_tools.builtin_tool_defs():
        intent = tool.inputSchema['properties'].get('intent')
        if intent:
            assert 'order' not in intent['enum']
            assert 'query' in intent['enum']
    result = await backtest_tools.dispatch({'action': 'navigate', 'navigate': {'tab': 'deploy'}}, None)
    assert result.isError
    result = await backtest_tools.dispatch({'action': 'navigate', 'navigate': {'tab': 'history'}}, None)
    assert not result.isError


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
