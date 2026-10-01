"""Ranking rails project one received list; response positions are not join keys."""

import pytest

from athena_api.card_surface_contract import bind_surface_values, build_board_surface_contract
from athena_api.card_surface_templates import get_registry


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
