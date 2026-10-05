"""propose_optimize forwards explicit search ranges only when every axis is well formed."""
import json

import pytest

from athena_mcp import backtest_tools


def _propose(ranges):
    return backtest_tools.dispatch(
        {'action': 'propose_optimize', 'propose_optimize': {'method': 'grid', 'ranges': ranges}},
        None,
    )


async def test_valid_ranges_are_forwarded_to_canvas():
    ranges = [{'name': 'fast', 'start': 5, 'stop': 20, 'step': 5},
              {'name': 'slow', 'start': 40, 'stop': 40, 'step': 0.5, 'is_int': False}]
    result = await _propose(ranges)
    assert not result.isError
    payload = json.loads(result.content[0].text)
    assert payload['kind'] == 'optimize_request'
    assert payload['ranges'] == ranges


async def test_omitted_ranges_stay_null():
    result = await backtest_tools.dispatch(
        {'action': 'propose_optimize', 'propose_optimize': {'method': 'random'}}, None)
    assert not result.isError
    assert json.loads(result.content[0].text)['ranges'] is None


@pytest.mark.parametrize('ranges', [
    [],
    [{'name': 'fast', 'start': 20, 'stop': 5, 'step': 5}],
    [{'name': 'fast', 'start': 5, 'stop': 20, 'step': 0}],
    [{'name': 'fast', 'start': 5, 'stop': 20, 'step': -1}],
    ['fast'],
    {'name': 'fast', 'start': 5, 'stop': 20, 'step': 5},
    [{'name': '', 'start': 5, 'stop': 20, 'step': 5}],
    [{'name': 'fast', 'start': '5', 'stop': 20, 'step': 5}],
    [{'name': 'fast', 'start': 5, 'stop': 20}],
])
async def test_malformed_ranges_are_blocked(ranges):
    result = await _propose(ranges)
    assert result.isError
    assert 'ranges' in result.content[0].text
