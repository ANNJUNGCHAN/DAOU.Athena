"""Expanded ranking rows use only the current typed query and validated criteria."""
import asyncio
import copy
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from athena_api.generated.registry import TR_REGISTRY
from athena_api.hydrate_defaults import fill_missing_arguments
from athena_api.ranking_expanded_result import (
    EXPANDED_BOARD, RANKING_BOARD_OPERATIONS, build_ranking_result,
)
from athena_api.semantic_presentation_registry import get_semantic_presentation_registry


def args_for(operation, **overrides):
    model = TR_REGISTRY[operation.split(':')[1]].request_model
    aliases = {(f.alias or name): f.is_required() for name, f in model.model_fields.items()}
    return model.model_validate(fill_missing_arguments(operation, overrides, aliases))


def source_for(operation, count):
    fields = get_semantic_presentation_registry().for_operation(operation)
    identity = next(f for f in fields if f.alias == 'stk_nm' and '[].' in f.json_path)
    container = identity.json_path.removeprefix('$.').split('[]')[0]
    return {container: [dict(stk_nm=f'합성 {i}', stk_cd=f'{i:06d}', cur_prc=str(-1000-i),
                            trde_qty='0', now_trde_qty='0', trde_prica='1234', trde_amt='4321',
                            pred_pre='-2', flu_rt='0.25', internal_note='NOT_PUBLIC')
                        for i in range(count)]}


@pytest.mark.parametrize('board,operation', RANKING_BOARD_OPERATIONS.items())
def test_each_supported_ranking_uses_its_own_public_rows(board, operation):
    source = source_for(operation, 103)
    before = copy.deepcopy(source)
    result = build_ranking_result(board, operation, source, args_for(operation))
    assert result['source_board_id'] == board and result['board_id'] == EXPANDED_BOARD
    assert result['operation_ref'] == operation
    assert result['received_count'] == 103 and result['displayed_count'] == 100
    assert result['limit'] == 100 and result['truncated'] is True
    assert result['rows'][0]['stk_cd'] == '000000'
    assert result['rows'][-1]['stk_nm'] == '합성 99'
    assert all('internal_note' not in r for r in result['rows'])
    assert source == before
    keys = {column['key'] for column in result['columns']}
    assert set(result['rows'][0]) == keys
    assert next(c for c in result['columns'] if c['key'] == 'stk_cd')['role'] == 'identifier'


def test_current_query_args_rows_and_units_never_reuse_previous_ranking():
    volume = build_ranking_result(EXPANDED_BOARD, 'base:ka10030', source_for('base:ka10030', 1),
                                 args_for('base:ka10030', mrkt_tp='101', sort_tp='1'))
    money = build_ranking_result(EXPANDED_BOARD, 'base:ka10032', source_for('base:ka10032', 2),
                                args_for('base:ka10032', mrkt_tp='001'))
    assert volume['operation_args']['mrkt_tp'] == '101'
    assert money['operation_args']['mrkt_tp'] == '001'
    assert volume['rows'][0]['trde_qty'] == '0'
    assert volume['rows'][0]['cur_prc'] == '-1000'
    amount = next(c for c in money['columns'] if c['key'] == 'trde_prica')
    assert amount['format']['suffix'] == '백만원'
    assert money['displayed_count'] == 2
    assert build_ranking_result(EXPANDED_BOARD, 'base:ka10030', {}, args_for('base:ka10030')) is None
    empty = build_ranking_result(EXPANDED_BOARD, 'base:ka10030', source_for('base:ka10030', 0), args_for('base:ka10030'))
    assert empty['rows'] == [] and empty['received_count'] == 0 and not empty['truncated']


def test_nonranking_operations_boards_and_invalid_arguments_are_never_projected():
    source = source_for('base:ka10030', 1)
    args = args_for('base:ka10030').model_dump(by_alias=True)
    assert build_ranking_result('133H-2', 'base:ka10030', source, args) is None
    assert build_ranking_result(EXPANDED_BOARD, 'base:kt10000', source, args) is None
    assert build_ranking_result(EXPANDED_BOARD, 'base:ka10030', source, {**args, 'plan_token':'not-a-field'}) is None


def test_hydrate_dispatches_only_current_allowlisted_ranking_and_returns_fresh_result(monkeypatch):
    from athena_api.api import canvas_push as canvas
    seen = []
    auth = []
    monkeypatch.setattr(canvas, 'require_local_bearer', lambda request, token: auth.append(token))
    monkeypatch.setattr(canvas, '_hydrate_data_client', lambda *args: SimpleNamespace(is_ready=True))

    async def hydrate(operation, document, payload, request, client, fetched, semaphore, selector, chained, results):
        seen.append(operation)
        arguments = args_for(operation, **payload.target)
        response = TR_REGISTRY[operation.split(':')[1]].response_model.model_validate(source_for(operation, 73))
        results[operation] = (response, arguments)
        return {'operation_ref':operation, 'status':'bound', 'reason':None, 'bound_count':0}, {}

    monkeypatch.setattr(canvas, '_hydrate_operation', hydrate)
    selector = SimpleNamespace(catalog=SimpleNamespace(find_exact=lambda operation: None))
    request = SimpleNamespace()
    payload = canvas.BoardHydrateRequest(board_id=EXPANDED_BOARD, slot_ids=[],
        ranking_operation_ref='base:ka10030', target={'mrkt_tp':'101'})
    response = asyncio.run(canvas.internal_canvas_board_hydrate(payload, request, None, selector, 'synthetic-bearer'))
    result = json.loads(response.body)['ranking_result']
    assert auth == ['synthetic-bearer'] and seen == ['base:ka10030']
    assert result['received_count'] == 73 and result['operation_args']['mrkt_tp'] == '101'
    assert result['operation_ref'] == 'base:ka10030'
    for board, operation in [(EXPANDED_BOARD,'base:kt10000'),('133H-2','base:ka10030')]:
        with pytest.raises(HTTPException) as error:
            asyncio.run(canvas.internal_canvas_board_hydrate(
                canvas.BoardHydrateRequest(board_id=board, ranking_operation_ref=operation),
                request, None, selector, 'synthetic-bearer'))
        assert error.value.status_code == 422
    assert seen == ['base:ka10030']
