"""Minute and daily tables bind distinct, real observations from public models."""
from athena_api.card_surface_contract import bind_surface_values, build_board_surface_contract
from athena_api.card_surface_templates import get_registry


def test_minute_and_daily_rows_keep_their_own_source_and_missing_positions():
    minute = {'stk_cd': '005930', 'stk_min_pole_chart_qry': [
        {'cntr_tm': '20261001101500', 'cur_prc': '-101', 'open_pric': '100', 'pred_pre': '+7', 'trde_qty': '0'},
        {'cntr_tm': '20261001101400', 'cur_prc': '102', 'pred_pre': '-8', 'trde_qty': '9'},
    ]}
    daily = {'stk_ddwkmm': [
        {'date': '20261001', 'close_pric': '201', 'pre': '+11', 'trde_qty': '1000'},
        {'date': '20260930', 'close_pric': '202', 'pre': '-12', 'trde_qty': '2000'},
    ]}
    bound = {**bind_surface_values('base:ka10080', minute), **bind_surface_values('base:ka10005', daily)}
    surface = build_board_surface_contract('3FR6-0', bound)
    values = {v['slot_id']: v['value'] for v in surface['slot_values']}
    assert values['s044'] == '20261001101500'
    assert values['s048'] == '-101'
    assert values['s049'] == '+7'
    assert values['s050'] == '0'
    assert values['s052'] == '20261001101400'
    assert 's053' not in values  # a missing second-row open cannot shift another row
    assert values['s056'] == '102'
    assert values['s157'] == '20261001'
    assert values['s161'] == '201'
    assert values['s165'] == '20260930'
    assert values['s169'] == '202'
    assert values['s005'] == '201'
    assert values['s032'] == '-101'
    assert 's051' not in values  # minute turnover is not supplied by ka10080


def test_minute_contract_does_not_reuse_daily_price_deltas_or_scalar_daily_rows():
    board = get_registry().boards['3FR6-0']
    assert not any(b.mapping_id == 'base:ka10006' for s in board.binding_slots for b in s.bindings)
    for slot in board.binding_slots:
        if slot.f in ('pre', 'pred_pre'):
            assert slot.format.get('kind') == 'number'
            assert slot.format.get('suffix') == '원'
    assert build_board_surface_contract('3FR6-0', {})['slot_values'] == []
