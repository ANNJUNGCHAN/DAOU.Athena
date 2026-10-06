import json

import httpx
import pytest

from athena_mcp.nudge_guard_tools import builtin_tool_defs, dispatch


def test_quiet_hours_are_discoverable_without_exposing_a_save_action():
    tool = builtin_tool_defs()[0]
    assert '방해 금지' in tool.description
    assert '조용 시간' in tool.inputSchema['properties']['propose']['properties']['quiet_hours']['description']
    assert tool.inputSchema['properties']['action']['enum'] == ['propose', 'get']


@pytest.mark.asyncio
async def test_overnight_proposal_only_reads_current_settings():
    current = {'max_daily_nudges': 2, 'quiet_hours': {'start': '23:00', 'end': '07:00'},
               'show_rationale': True, 'learn_from_dismissals': True}
    proposal = {'quiet_hours': {'start': '22:00', 'end': '08:00'}}
    requests = []

    def handle(request):
        requests.append((request.method, request.url.path))
        return httpx.Response(200, json=current)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle), base_url='http://synthetic') as client:
        result = await dispatch({'action': 'propose', 'propose': proposal}, client)
    assert not result.isError
    body = json.loads(result.content[0].text)
    assert body['current'] == current
    assert body['proposed'] == proposal
    assert requests == [('GET', '/api/v1/nudge-guard')]
    assert current['quiet_hours'] == {'start': '23:00', 'end': '07:00'}


@pytest.mark.asyncio
async def test_save_is_rejected_before_any_http_request():
    requests = []
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: requests.append(request)),
                                base_url='http://synthetic') as client:
        result = await dispatch({'action': 'set', 'propose': {'quiet_hours': {'start': '22:00', 'end': '08:00'}}}, client)
    assert result.isError
    assert requests == []
