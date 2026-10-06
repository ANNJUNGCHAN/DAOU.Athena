"""The investor grid transposes actual day/time rows, not unrelated observations."""
import copy

from athena_api.card_surface_contract import bind_surface_values, build_board_surface_contract
from athena_api.surface_display_units import annotate_surface_display_units


def test_daily_columns_and_all_investor_rows_share_the_same_six_dates():
    rows = [{'dt': f'202609{30-i:02d}', 'orgn': str(100+i),
             'ind_invsr': str(200+i), 'frgnr_invsr': str(300+i), 'acc_trde_prica': '17'}
            for i in range(6)]
    rows[1].pop('ind_invsr')
    rows[2]['ind_invsr'] = '0'
    result = build_board_surface_contract('3DI2-0', bind_surface_values('base:ka10060', {'stk_invsr_orgn_chart': rows}))
    values = {v['slot_id']: v['value'] for v in result['slot_values']}
    for i, slot in enumerate(['s037', 's039', 's041', 's043', 's045', 's048']):
        assert values[slot] == rows[i]['dt']
    assert values['s032'] == values['s115'] == '100'
    assert values['s051'] == '200'
    assert 's052' not in values
    assert values['s053'] == '0'
    assert values['s056'] == '205'  # sixth observation, never an invented cumulative sum
    assert values['s058'] == '300'
    assert values['s063'] == '305'


def test_intraday_columns_use_three_observed_times_without_deriving_intervals():
    rows = [{'tm': tm, 'frgnr_invsr': str(i), 'orgn': str(i+10)}
            for i, tm in enumerate(['101500', '101000', '100500'])]
    result = build_board_surface_contract('3DI2-0', bind_surface_values('base:ka10064', {'opmr_invsr_trde_chart': rows}))
    values = {v['slot_id']: v['value'] for v in result['slot_values']}
    for slot, tm in zip(['s153', 's155', 's158'], ['101500', '101000', '100500']):
        assert values[slot] == tm
    assert [values[s] for s in ['s165', 's166', 's167']] == ['0', '1', '2']
    assert [values[s] for s in ['s198', 's199', 's200']] == ['10', '11', '12']
    assert 's161' not in values  # ka10064 has no individual-investor field


def test_daily_investor_units_follow_request_and_do_not_rescale_turnover():
    raw = build_board_surface_contract('3DI2-0', bind_surface_values('base:ka10060', {
        'stk_invsr_orgn_chart': [{'dt': '20261001', 'orgn': '-23', 'acc_trde_prica': '17'}]}))
    before = copy.deepcopy(raw)
    for args, expected in [
        ({'amt_qty_tp': '1', 'unit_tp': '1'}, '-23백만원'),
        ({'amt_qty_tp': '2', 'unit_tp': '1'}, '-23주'),
        ({'amt_qty_tp': '2', 'unit_tp': '1000'}, '-23천주'),
        ({}, '-23 (단위 미확인)'),
    ]:
        result = annotate_surface_display_units(raw, {'base:ka10060': args})
        values = {v['slot_id']: v['value'] for v in result['slot_values']}
        assert values['s032']['text'] == expected
        assert values['s032']['value'] == '-23'
        assert values['s019'] == '17'
    assert raw == before
