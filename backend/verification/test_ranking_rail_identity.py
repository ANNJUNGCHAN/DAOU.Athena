"""Ranking rails project one received list; response positions are not join keys."""

import pytest

from athena_api.card_surface_contract import bind_surface_values, build_board_surface_contract
from athena_api.card_surface_templates import get_registry


def test_explorer_default_source_changes_only_its_eleven_rail_slots():
    from athena_api.card_surface_contract import with_ranking_rail_rows, attach_surface_contract
    sources = {
        'base:ka10032': {'trde_prica_upper': [dict(stk_cd=f'00020{i}', stk_nm=f'금액 {i}', cur_prc='100',
            pred_pre_sig='5', sel_bid='99', flu_rt='-1') for i in range(4)]},
        'base:ka00198': {'item_inq_rank': [dict(stk_cd=f'00030{i}', stk_nm=f'조회 {i}', flu_rt='2') for i in range(4)]},
    }
    bound = {}
    for op, payload in sources.items():
        bound.update(bind_surface_values(op, payload))
    default = build_board_surface_contract('13K0-2', bound)
    explicit = build_board_surface_contract('13K0-2', bound, active_operation_refs=['base:ka00198'])
    values = lambda c: {e['slot_id']: e['value'] for e in c['slot_values']}
    left, right = values(default), values(explicit)
    rail = {'s128', 's129', 's131', 's132', 's134', 's145', 's146', 's147', 's148', 's149', 's150'}
    assert {sid for sid in left.keys() | right.keys() if left.get(sid) != right.get(sid)} == rail
    assert left['s129'] == '000200' and right['s129'] == '000300' and 's131' not in right
    for contract, active, expected in [(default, (), '00020'), (explicit, ('base:ka00198',), '00030')]:
        rows = with_ranking_rail_rows(contract, sources, active_operation_refs=active)['ranking_rail_rows']
        assert [row['code'] for row in rows] == [expected + str(i) for i in range(4)]
    initial = attach_surface_contract({}, 'base:ka10032', sources['base:ka10032'])['surface_contract']
    assert initial['ranking_rail_rows'][2]['code'] == '000202'
    search = attach_surface_contract({}, 'base:ka00198', sources['base:ka00198'])['surface_contract']
    assert search['ranking_rail_rows'][2]['code'] == '000302'


@pytest.mark.parametrize('present,expected', [({}, []), ({'cur_prc': None}, ['s131']), ({'cur_prc': ''}, ['s131']), ({'cur_prc': '0'}, [])])
def test_rail_metadata_keeps_absent_null_and_zero_distinct_in_typed_models(present, expected):
    from athena_api.generated.models import Ka10032Response
    from athena_api.card_surface_contract import with_ranking_rail_rows
    response = Ka10032Response.model_validate({'trde_prica_upper': [dict(stk_cd='000201', stk_nm='합성', **present)]})
    contract = build_board_surface_contract('13K0-2', bind_surface_values('base:ka10032', response.model_dump(by_alias=True)))
    rows = with_ranking_rail_rows(contract, {'base:ka10032': response})['ranking_rail_rows']
    assert rows[0]['code'] == '000201' and rows[0]['empty_slots'] == expected
    if present.get('cur_prc') == '0':
        assert next(e['value'] for e in contract['slot_values'] if e['slot_id'] == 's131') == '0'
    assert all(row['code'] is None for row in rows[1:])
    assert with_ranking_rail_rows(build_board_surface_contract('13K0-2', {}), {})['ranking_rail_rows'] == []


@pytest.mark.parametrize('active,slots', [(None, None), ('base:ka10032', None), ('base:ka00198', None), ('base:ka00198', ['s131'])])
def test_explorer_http_hydrate_uses_real_dispatch_and_typed_mock_responses(monkeypatch, active, slots):
    from types import SimpleNamespace
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from athena_api.api import canvas_push as canvas
    from athena_api.dependencies import get_selector_service, get_kiwoom_client
    from athena_api.generated.registry import TR_REGISTRY
    seen, authorized = [], []
    sources = {
        'ka10032': {'trde_prica_upper': [dict(stk_cd='000201', stk_nm='금액 합성', cur_prc='0'), dict(stk_cd='000202', stk_nm='금액 비교')]},
        'ka00198': {'item_inq_rank': [dict(stk_cd='000301', stk_nm='검색 합성', flu_rt='0'), dict(stk_cd='000302', stk_nm='검색 비교')]},
    }
    def document(op):
        spec = TR_REGISTRY[op.split(':')[1]]
        return SimpleNamespace(operation_ref=op, tr_id=spec.tr_id, kind='query', generic_callable=True, request_model=spec.request_model)
    async def call(tr_id, args, request, response, client):
        seen.append(tr_id)
        return TR_REGISTRY[tr_id].response_model.model_validate(sources[tr_id])
    monkeypatch.setattr(canvas, 'call_typed_tr', call)
    monkeypatch.setattr(canvas, 'require_local_bearer', lambda request, token: authorized.append(token))
    app = FastAPI()
    app.include_router(canvas.router)
    app.dependency_overrides[get_kiwoom_client] = lambda: SimpleNamespace(is_ready=True)
    app.dependency_overrides[get_selector_service] = lambda: SimpleNamespace(catalog=SimpleNamespace(find_exact=document))
    with TestClient(app) as client:
        response = client.post('/api/v1/internal/canvas/board-hydrate', headers={'Authorization': 'fixture-bearer'},
            json={'board_id': '13K0-2', 'ranking_operation_ref': active, 'slot_ids': slots})
        assert response.status_code == 200, response.text
        body = response.json()
        contract = body['surface_contract']
        values = {e['slot_id']: e['value'] for e in contract['slot_values']}
        assert set(seen) == {'ka10032', 'ka00198'} and len(seen) == 2
        assert values['s129'] == ('000301' if active == 'base:ka00198' else '000201')
        assert contract['ranking_rail_rows'][1]['code'] == ('000302' if active == 'base:ka00198' else '000202')
        assert body['ranking_result'] is None
        assert all(op['status'] == 'bound' for op in body['operations'])
        assert authorized == ['fixture-bearer']
        # Empty received collections clear rows; absent source fields are not empty updates.
        sources['ka10032'] = {'trde_prica_upper': []}
        sources['ka00198'] = {'item_inq_rank': []}
        empty = client.post('/api/v1/internal/canvas/board-hydrate', json={'board_id': '13K0-2'}).json()['surface_contract']
        assert len(empty['ranking_rail_rows']) == 4 and all(r['code'] is None for r in empty['ranking_rail_rows'])
        sources['ka10032'] = {}; sources['ka00198'] = {}
        absent = client.post('/api/v1/internal/canvas/board-hydrate', json={'board_id': '13K0-2'}).json()['surface_contract']
        assert absent['ranking_rail_rows'] == []
        count = len(seen)
        for board, operation in [('13K0-2', 'base:ka10100'), ('2X5N-0', 'base:ka00198')]:
            rejected = client.post('/api/v1/internal/canvas/board-hydrate', json={'board_id': board, 'ranking_operation_ref': operation})
            assert rejected.status_code == 422
        assert len(seen) == count
        expanded = client.post('/api/v1/internal/canvas/board-hydrate', json={
            'board_id': '4B22-1', 'ranking_operation_ref': 'base:ka00198'}).json()
        assert seen[count:] == ['ka00198']
        assert expanded['ranking_result']['operation_ref'] == 'base:ka00198'
        assert expanded['ranking_result']['rows'] == []
        assert 'ranking_rail_rows' not in expanded['surface_contract']


CASES = [
    ('13K0-2', 'ka10032', 'trde_prica_upper', 's128'),
    ('2VDA-0', 'ka10016', 'ntl_pric', 's270'),
    ('2VO0-0', 'ka30010', 'elwreq_rank', 's307'),
    ('2XA5-0', 'ka30009', 'elwflu_rt_rank', 's307'),
    ('2XG6-0', 'ka10031', 'pred_trde_qty_upper', 's134'),
    ('2XKO-0', 'ka10027', 'pred_pre_flu_rt_upper', 's139'),
    ('2XP6-0', 'ka10029', 'exp_cntr_flu_rt_upper', 's134'),
    ('2XTO-0', 'ka10020', 'bid_req_upper', 's140'),
    ('2XY6-0', 'ka30011', 'elwalacc_rt', 's307'),
    ('2Y47-0', 'ka30001', 'elwpric_jmpflu', 's307'),
    ('2YA8-0', 'ka10021', 'bid_req_sdnin', 's135'),
    ('2YEQ-0', 'ka10022', 'req_rt_sdnin', 's135'),
    ('2YJ8-0', 'ka10023', 'trde_qty_sdnin', 's134'),
    ('2YNQ-0', 'ka10098', 'ovt_sigpric_flu_rt_rank', 's133'),
    ('2ZN9-0', 'ka30005', 'elwcnd_qry', 's166'),
    ('32XM-0', 'ka10011', 'newstk_recvrht_mrpr', 's223'),
]


@pytest.mark.parametrize('board_id,operation,container,hero', CASES)
def test_rail_subject_code_price_and_comparisons_follow_the_same_received_list(
    board_id, operation, container, hero,
):
    board = get_registry().boards[board_id]
    rows = [dict(stk_nm=f'합성 순위 {i}', stk_cd=f'A0000{i}',
                 cur_prc=str(101 + i), exp_cntr_pric=str(201 + i),
                 flu_rt=str(i + 0.25), pred_pre=str(i + 1), pred_pre_sig='2')
            for i in range(4)]
    source = {container: rows}
    bound = bind_surface_values(f'base:{operation}', source)
    # This unrelated detail and differently ordered collection must never supply the rail.
    bound.update(bind_surface_values('base:ka10100', dict(name='다른 개별 종목', code='999999', lastPrice='777777')))
    if operation != 'ka30005':
        bound.update(bind_surface_values('base:ka30005', {'elwcnd_qry': [
            dict(stk_nm='다른 목록 종목', stk_cd='Z99999', cur_prc='888888', exec_pric='765432')]}))
    contract = build_board_surface_contract(board_id, bound, active_operation_refs=[f'base:{operation}'])
    values = {s['slot_id']: s['value'] for s in contract['slot_values']}
    assert values[hero] == '합성 순위 0'
    for slot in board.slots:
        if slot.region != 'rail' or slot.f not in rows[0]:
            continue
        assert values[slot.slot_id] == rows[slot.row_index][slot.f]
    rail_ids = {s.slot_id for s in board.slots if s.region == 'rail'}
    assert not {'다른 개별 종목', '다른 목록 종목', '777777', '888888', '765432'} & {
        str(value) for sid, value in values.items() if sid in rail_ids}
    assert source[container] == rows


def test_missing_first_price_and_short_list_do_not_borrow_other_subject_values():
    bound = bind_surface_values('base:ka10021', {'bid_req_sdnin': [
        dict(stk_nm='합성 한 종목', stk_cd='A00001', pred_pre='0')
    ]})
    bound.update(bind_surface_values('base:ka10100', dict(name='별도 대상', code='999999', lastPrice='777777')))
    bound.update(bind_surface_values('base:ka10032', {'trde_prica_upper': [
        dict(stk_nm='다른 순위', stk_cd='A00002', cur_prc='888888', sel_bid='666666')]}))
    contract = build_board_surface_contract('2YA8-0', bound, active_operation_refs=['base:ka10021'])
    values = {s['slot_id']: s['value'] for s in contract['slot_values']}
    assert values['s135'] == '합성 한 종목' and values['s136'] == 'A00001'
    assert values['s139'] == '0'
    assert not {'s138', 's142', 's144', 's146', 's150', 's152'} & values.keys()


def test_comparison_names_and_rates_keep_distinct_row_positions():
    bound = bind_surface_values('base:ka10027', {'pred_pre_flu_rt_upper': [
        dict(stk_nm=f'합성 {i}', stk_cd=f'A0000{i}', cur_prc=str(101+i), flu_rt=str(i))
        for i in range(4)]})
    values = {s['slot_id']: s['value'] for s in build_board_surface_contract(
        '2XKO-0', bound, active_operation_refs=['base:ka10027'])['slot_values']}
    assert [(values[n], values[r]) for n, r in [('s146', 's147'), ('s148', 's149'), ('s150', 's151')]] == [
        ('합성 1', '1'), ('합성 2', '2'), ('합성 3', '3')]
