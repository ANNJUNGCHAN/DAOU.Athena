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


def test_absent_leaf_does_not_move_the_next_stock_price_into_the_previous_row():
    from athena_api.card_surface_contract import json_path_values
    source = {'elwalacc_rt': [
        {'stk_nm': '합성 가격 미제공', 'stk_cd': 'A10001'},
        {'stk_nm': '합성 가격 수신', 'stk_cd': 'A10002', 'cur_prc': '202'},
    ]}
    # The shared semantic observation evaluator keeps its established behavior.
    assert json_path_values(source, '$.elwalacc_rt[].cur_prc') == ['202']
    bound = bind_surface_values('base:ka30011', source)
    contract = build_board_surface_contract('2XY6-0', bound, active_operation_refs=['base:ka30011'])
    values = {s['slot_id']: s['value'] for s in contract['slot_values']}
    assert values['s048'] == '합성 가격 미제공'
    assert 's050' not in values and 's050' in contract['empty_value_slots']
    assert values['s061'] == '합성 가격 수신'
    assert values['s063'] == '202'
    assert 'cur_prc' not in source['elwalacc_rt'][0]
    from athena_api.api.canvas_push import _bind_semantic_values, _integrated_card_contract
    card = _integrated_card_contract('base:ka30011')
    _bind_semantic_values(card, 'base:ka30011', source)
    observed = next(s for s in card['semantic_observations'] if s['value'] == '202')
    assert observed['array_index'] == 1
    projected = next(s for s in card['surface_contract']['slot_values'] if s['slot_id'] == 's063')
    assert projected['observation_id'] == observed['observation_id']


def test_invalid_or_missing_nested_array_leaf_preserves_all_row_positions():
    from athena_api.card_surface_contract import json_path_values
    source = {'rows': [{}, {'item': {'price': '0'}}, {'item': None}, {'item': {'price': '42'}}]}
    assert json_path_values(source, '$.rows[].item.price', preserve_array_rows=True) == [None, '0', None, '42']
    assert json_path_values({'rows': []}, '$.rows[].item.price', preserve_array_rows=True) == []


def test_etf_whole_quote_hero_uses_first_response_row_without_borrowing_missing_leaves():
    board = get_registry().boards['2VIN-0']
    hero_slots = ['s386', 's387', 's388', 's389', 's391', 's395', 's399', 's400']
    rows = [
        {'stk_nm': '합성 ETF A', 'stk_cd': '000001', 'close_pric': '12000',
         'pre_rt': '0', 'nav': '12001', 'trace_eor_rt': '0', 'txbs': '12002', 'dvid_bf_base': '12003'},
        {'stk_nm': '합성 ETF B', 'stk_cd': '000002', 'close_pric': '23000',
         'pre_rt': '2', 'nav': '23001', 'trace_eor_rt': '3', 'txbs': '23002', 'dvid_bf_base': '23003'},
    ]
    bound = bind_surface_values('base:ka40004', {'etfall_mrpr': rows})
    contract = build_board_surface_contract(board.board_id, bound, active_operation_refs=['base:ka40004'])
    values = {slot['slot_id']: slot['value'] for slot in contract['slot_values']}
    for sid in hero_slots:
        slot = board.slot(sid)
        assert slot.row_index == 0
        assert values[sid] == rows[0][slot.f]
    del rows[0]['stk_nm']
    bound = bind_surface_values('base:ka40004', {'etfall_mrpr': rows})
    contract = build_board_surface_contract(board.board_id, bound, active_operation_refs=['base:ka40004'])
    values = {slot['slot_id']: slot['value'] for slot in contract['slot_values']}
    assert 's386' not in values
    assert 's386' in contract['empty_value_slots']
    assert values['s387'] == '000001'
