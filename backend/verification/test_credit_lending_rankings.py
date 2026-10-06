"""Ranking rows and summaries cannot borrow observations from unrelated queries."""
from athena_api.card_surface_contract import bind_surface_values, build_board_surface_contract
from athena_api.card_surface_templates import get_registry


def observed(board, bound):
    result = build_board_surface_contract(board, bound)
    assert result is not None
    return {v['slot_id']: v['value'] for v in result['slot_values']}


def test_credit_ranking_uses_same_list_row_for_main_header_and_rail():
    ranking = {'crd_rt_upper': [
        {'stk_cd': '000001', 'stk_nm': '합성가', 'cur_prc': '101', 'crd_rt': '1.23', 'now_trde_qty': '0', 'sel_req': '11'},
        {'stk_cd': '000002', 'stk_nm': '합성나', 'cur_prc': '202', 'crd_rt': '2.34', 'now_trde_qty': '9', 'sel_req': '22'},
    ]}
    wrong = {'crd_trde_trend': [{'cur_prc': '999', 'remn': '888', 'new': '777', 'trde_qty': '666'}]}
    values = observed('2YS8-0', {**bind_surface_values('base:ka10033', ranking), **bind_surface_values('base:ka10013', wrong)})
    assert values['s042'] == values['s014'] == values['s166'] == '합성가'
    assert values['s043'] == values['s167'] == '000001'
    assert values['s045'] == '101'
    assert values['s054'] == values['s016'] == '0'
    assert values['s171'] == '11'
    for slot in ['s048', 's049', 's050', 's051', 's052', 's053', 's175', 's193']:
        assert slot not in values


def test_lending_rows_and_six_names_preserve_source_positions_without_global_ratio_copies():
    rows = [{'stk_cd': f'{i+1:06d}', 'stk_nm': f'합성{i}', 'rmnd': str(100+i),
             'dbrt_trde_cntrcnt': str(10+i), 'dbrt_trde_rpy': str(i), 'remn_amt': str(20+i)} for i in range(8)]
    source = {'dbrt_trde_upper_10stk': rows, 'rmnd_sum': '901', 'rmnd_rt': '1898', 'remn_amt_sum': '41'}
    values = observed('2ZBB-0', bind_surface_values('base:ka10069', source))
    assert values['s042'] == values['s014'] == values['s172'] == '합성0'
    assert values['s050'] == values['s013'] == values['s173'] == '100'
    assert values['s128'] == '합성6' and values['s142'] == '합성7'
    assert values['s136'] == '106' and values['s150'] == '107'
    assert [values[f's{172+i*2:03}'] for i in range(6)] == [f'합성{i}' for i in range(6)]
    assert [values[f's{173+i*2:03}'] for i in range(6)] == [str(100+i) for i in range(6)]
    assert values['s016'] == '901'
    assert values['s167'] == '1898'
    for slot in ['s044', 's045', 's047', 's049', 's052', 's053', 's054']:
        assert slot not in values


def test_only_matching_ranking_operations_remain_and_empty_results_have_no_example_names():
    registry = get_registry()
    for board, operation in [('2YS8-0', 'base:ka10033'), ('2ZBB-0', 'base:ka10069')]:
        assert {b.mapping_id for slot in registry.boards[board].binding_slots for b in slot.bindings} == {operation}
        assert observed(board, {}) == {}
