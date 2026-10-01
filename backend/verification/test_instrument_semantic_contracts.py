"""Public API schema fixtures; no account data or network access."""
from athena_api.card_surface_contract import bind_surface_values, build_board_surface_contract, build_surface_contract
from athena_api.card_surface_templates import get_registry


def contract_for(board, responses):
    bound = {}
    for operation, response in responses.items():
        bound.update(bind_surface_values(operation, response))
    contract = build_board_surface_contract(board, bound_values=bound, active_operation_refs=list(responses))
    assert contract is not None, board
    return contract


def values_for(board, responses):
    return {item['slot_id']: item['value'] for item in contract_for(board, responses)['slot_values']}


def test_company_ohlc_and_price_history_keep_every_labelled_part():
    responses = {
        'detail:ka10001:daily_price_band': {'open_pric': '-10100', 'high_pric': '12200', 'low_pric': '9300'},
        'detail:ka10001:price_range': {'250hgst': '18800', '250hgst_pric_dt': '20260918',
                                    '250lwst': '6700', '250lwst_pric_dt': '20260821'},
    }
    values = values_for('2RBO-1', responses)
    assert [p['value'] for p in values['s016']['composite']['parts']] == ['-10100', '12200', '9300']
    assert [p['value'] for p in values['s052']['composite']['parts']] == ['18800', '20260918']
    assert [p['value'] for p in values['s055']['composite']['parts']] == ['6700', '20260821']
    del responses['detail:ka10001:daily_price_band']['high_pric']
    del responses['detail:ka10001:price_range']['250hgst']
    partial = values_for('2RBO-1', responses)
    assert 's016' not in partial and 's052' not in partial
    assert 's055' in partial


def test_chart_period_volume_is_distinct_from_session_total_and_has_no_array_label():
    values = values_for('137X-2', {'base:ka10015': {'daly_trde_dtl': [
        {'tot_3': '123456', 'prid_trde_qty': '654321'},
    ]}})
    assert values['s120'] == '123456'
    assert values['s123'] == '654321'
    assert 's122' not in values


PER_ROWS = [
    {'stk_cd': '100001', 'stk_nm': '합성 PER 종목', 'per': '7.25', 'cur_prc': '12340', 'pred_pre': '-60', 'flu_rt': '-0.48', 'now_trde_qty': '123456', 'sel_bid': '12350'},
    {'stk_cd': '100002', 'stk_nm': '합성 PER 둘째', 'per': '8.5', 'cur_prc': '20000', 'pred_pre': '0', 'flu_rt': '0', 'now_trde_qty': '0', 'sel_bid': '20050'},
]
OPEN_ROWS = [
    {'stk_cd': '200001', 'stk_nm': '합성 시가 종목', 'cur_prc': '54320', 'pred_pre': '100', 'flu_rt': '0.18', 'open_pric': '54000', 'open_pric_pre': '0.59', 'high_pric': '55000', 'low_pric': '53000', 'now_trde_qty': '234567', 'cntr_str': '101.2'},
]
ETF_RESPONSE = {'etfprft_rt_lst': [{'etfprft_rt': '2.35', 'cntr_prft_rt': '2.1', 'for_netprps_qty': '12340', 'orgn_netprps_qty': '-4560'}]}
ELW_ROWS = [
    {'stk_cd': '58AA01', 'stk_nm': '합성 ELW 콜', 'stkpc_flu': '45', 'flu_rt': '12.16', 'trde_qty': '8300000', 'netprps': '2100000', 'buy_trde_qty': '5200000', 'sel_trde_qty': '3100000'},
    {'stk_cd': '58AA02', 'stk_nm': '합성 ELW 풋', 'stkpc_flu': '0', 'flu_rt': '0', 'trde_qty': '0', 'netprps': '0', 'buy_trde_qty': '0', 'sel_trde_qty': '0'},
]
EXECUTIONS = [
    {'cntr_tm': '091530', 'cntr_pric': '150000', 'pred_pre': '1000', 'flu_rt': '0.67', 'cntr_qty': '10', 'acc_trde_qty': '123456', 'acc_trde_prica': '18518'},
    {'cntr_tm': '091529', 'cntr_pric': '149900', 'pred_pre': '900', 'flu_rt': '0.60', 'cntr_qty': '20', 'acc_trde_qty': '123446', 'acc_trde_prica': '18516'},
]


def test_per_rows_never_join_an_unrelated_open_ranking_by_index():
    values = values_for('30ZW-0', {'base:ka10026': {'high_low_per': PER_ROWS}, 'base:ka10028': {'open_pric_pre_flu_rt': OPEN_ROWS}})
    assert [values[x] for x in ['s052','s053','s054','s055','s056','s061']] == ['합성 PER 종목','100001','12340','-60','7.25','123456']
    assert not {'s059','s060','s063'} & values.keys()


def test_open_rows_never_join_an_unrelated_per_ranking_by_index():
    values = values_for('316O-0', {'base:ka10026': {'high_low_per': PER_ROWS}, 'base:ka10028': {'open_pric_pre_flu_rt': OPEN_ROWS}})
    assert [values[x] for x in ['s051','s052','s053','s054','s055','s056','s058','s060']] == ['합성 시가 종목','200001','54320','100','54000','0.59','234567','101.2']
    assert 's057' not in values  # response has no ask quote


def test_individual_rows_are_not_presented_as_uncomputed_global_extrema():
    per = values_for('30ZW-0', {'base:ka10026': {'high_low_per': PER_ROWS}})
    opening = values_for('316O-0', {'base:ka10028': {'open_pric_pre_flu_rt': OPEN_ROWS}})
    assert not {'s004','s017','s020'} & per.keys()
    assert not {'s004','s023'} & opening.keys()
    assert per['s056'] == '7.25' and opening['s056'] == '0.59'


def test_execution_rows_keep_time_price_and_cumulative_quantity_semantics():
    values = values_for('31UD-0', {'base:ka10055': {'tdy_pred_cntr_qty': EXECUTIONS}})
    assert [values[x] for x in ['s054','s055','s056','s057','s059','s060']] == ['150000','1000','091530','10','123456','18518']
    ordinal = next(s for s in get_registry().boards['31UD-0'].slots if s.slot_id == 's051')
    assert ordinal.kind == 'label' and ordinal.paper_text == '1'
    assert not {'s052','s053','s058','s061'} & values.keys()


def test_one_etf_period_does_not_fabricate_other_periods_or_other_stocks():
    values = values_for('2WZK-0', {'base:ka40001': ETF_RESPONSE, 'base:ka40002': {'stk_nm': '합성 ETF'}, 'base:ka40004': {'etfall_mrpr': [{'stk_nm': '관계없는 ETF'}]}})
    assert values == {'s004':'합성 ETF','s017':'2.35','s020':'2.1','s023':'12340','s026':'-4560'}


def test_etf_zero_is_observation_and_short_response_remains_missing():
    values = values_for('2WZK-0', {'base:ka40001': {'etfprft_rt_lst': [{'etfprft_rt':'0','for_netprps_qty':'0'}]}})
    assert values == {'s017':'0','s023':'0'}


def test_etf_period_query_enters_the_period_surface_with_all_four_received_metrics():
    ref = 'base:ka40001'
    registry = get_registry()
    assert registry.base_board_for(ref).board_id == '2WZK-0'
    assert registry.initial_state_board_for(ref) is None
    contract = build_surface_contract(ref, bind_surface_values(ref, ETF_RESPONSE))
    assert contract['board_id'] == '2WZK-0'
    assert contract['initial_state_board'] is None
    assert {item['slot_id']: item['value'] for item in contract['slot_values']} == {
        's017': '2.35', 's020': '2.1', 's023': '12340', 's026': '-4560',
    }


def test_etf_information_query_keeps_the_product_detail_entry():
    contract = build_surface_contract('base:ka40002')
    assert contract['board_id'] == '15N5-2'
    assert contract['initial_state_board'] is None


def test_nav_price_is_not_nav_index_or_quantity():
    values = values_for('15N5-2', {'base:ka40006': {'etftisl_trnsn': [{'tm':'091530','nav':'48318.25','navidex':'0.05','navetf':'0.09','trace_idex':'44862','trace_idex_pred_pre':'378','trde_prica':'1846'}]}})
    assert values['s074'] == '48318.25'
    assert values['s075'] == '0.09'
    assert values['s079'] == '1846'
    assert values['s076'] == '44862'
    assert 's089' not in values  # no fabricated next time row


def test_issuer_elw_list_does_not_become_broker_or_foreign_aggregate():
    for board in ['2Z49-0','3TOM-0']:
        values = values_for(board, {'base:ka30002': {'trde_ori_elwnettrde_upper': ELW_ROWS}})
        assert [values[x] for x in ['s049','s050','s053','s054','s055','s056']] == ['합성 ELW 콜','58AA01','3100000','5200000','2100000','8300000']
        assert values['s066'] == '0'
        assert not {'s017','s020','s023','s048','s057'} & values.keys()


def test_corrected_owned_boards_remain_loadable():
    registry = get_registry()
    for board in ['31UD-0','2WZK-0','30ZW-0','316O-0','15N5-2','2Z49-0','3TOM-0']:
        assert board in registry.boards
