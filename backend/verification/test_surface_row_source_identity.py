"""A list index is not a join key across unrelated ranking queries."""

from athena_api.card_surface_contract import bind_surface_values, build_board_surface_contract
from athena_api.card_surface_templates import get_registry


def test_elw_proximity_rows_do_not_borrow_terms_from_another_ordered_list():
    registry = get_registry()
    board = registry.boards['2XY6-0']
    proximity = 'base:ka30011'
    other = 'base:ka30005'
    bound = bind_surface_values(proximity, {'elwalacc_rt': [
        {'stk_nm': '합성 근접 A', 'stk_cd': 'A10001', 'cur_prc': '101', 'alacc_rt': '1.1'},
        {'stk_nm': '합성 근접 B', 'stk_cd': 'A10002', 'cur_prc': '202', 'alacc_rt': '2.2'},
    ]})
    bound.update(bind_surface_values(other, {'elwcnd_qry': [
        {'stk_nm': '다른 순위 B', 'stk_cd': 'A10002', 'cur_prc': '999', 'exec_pric': '98765', 'srvive_dys': '106', 'lpmmcm_nm': '다른 LP'},
        {'stk_nm': '다른 순위 A', 'stk_cd': 'A10001', 'cur_prc': '888', 'exec_pric': '87654', 'srvive_dys': '205', 'lpmmcm_nm': '다른 LP'},
    ]}))
    contract = build_board_surface_contract(board.board_id, bound, active_operation_refs=[proximity])
    table_slots = {s.slot_id for s in board.slots if s.table}
    values = [s['value'] for s in contract['slot_values'] if s['slot_id'] in table_slots]
    assert '합성 근접 A' in values and '합성 근접 B' in values
    assert '101' in values and '202' in values
    assert not {'98765', '87654', '106', '205', '다른 LP', '999', '888'} & set(values)


def test_empty_cell_in_selected_list_cannot_fall_back_to_another_list_price():
    board = get_registry().boards['2XY6-0']
    bound = bind_surface_values('base:ka30011', {'elwalacc_rt': [
        {'stk_nm': '합성 근접 A', 'stk_cd': 'A10001', 'cur_prc': None},
    ]})
    bound.update(bind_surface_values('base:ka30005', {'elwcnd_qry': [
        {'stk_nm': '다른 순위', 'stk_cd': 'A10002', 'cur_prc': '999'},
    ]}))
    contract = build_board_surface_contract(board.board_id, bound, active_operation_refs=['base:ka30011'])
    table_slots = {s.slot_id for s in board.slots if s.table}
    values = [s['value'] for s in contract['slot_values'] if s['slot_id'] in table_slots]
    assert '합성 근접 A' in values
    assert '999' not in values
    assert contract['empty_value_slots']
