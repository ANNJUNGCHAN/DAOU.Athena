"""Public synthetic identities only; no upstream requests or account records."""

from athena_api.card_surface_contract import bind_surface_values, build_board_surface_contract
from athena_api.stock_display_identity import stock_detail_source


def test_flow_headers_select_the_requested_stock_from_differently_ordered_collections():
    target = {'stk_cd': '123456'}
    first = {'opaf_invsr_trde': [
        {'stk_cd': '654321_AL', 'stk_nm': '합성 다른 종목', 'cur_prc': '999'},
        {'stk_cd': '123456_NX', 'stk_nm': '합성 요청 종목', 'cur_prc': '101'},
    ]}
    second = {'for_cont_nettrde_upper': [
        {'stk_cd': 'A123456', 'stk_nm': '합성 요청 종목', 'cur_prc': '202'},
        {'stk_cd': '654321', 'stk_nm': '합성 다른 종목', 'cur_prc': '888'},
    ]}
    bound = bind_surface_values('base:ka10066', stock_detail_source('2S4E-1', first, target))
    bound.update(bind_surface_values('base:ka10035', stock_detail_source('2S4E-1', second, target)))
    result = build_board_surface_contract('2S4E-1', bound)
    values = {slot['slot_id']: slot['value'] for slot in result['slot_values']}
    assert values['s001'] == '합성 요청 종목'
    assert values['s003'] == 'A123456'
    assert '합성 다른 종목' not in values.values()
    assert len(first['opaf_invsr_trde']) == len(second['for_cont_nettrde_upper']) == 2


def test_unmatched_or_missing_target_does_not_promote_a_collection_first_row():
    source = {'opaf_invsr_trde': [{'stk_cd': '654321', 'stk_nm': '합성 다른 종목'}]}
    for target in ({}, {'stk_cd': '123456'}, {'stk_cd': '52M001'}):
        assert stock_detail_source('2S4E-1', source, target)['opaf_invsr_trde'] == []


def test_requested_history_without_per_row_stock_codes_and_actual_zeroes_are_retained():
    source = {'stk_cd': '123456_AL', 'history': [{'dt': '20260317', 'volume': '0'}]}
    assert stock_detail_source('137X-2', source, {'stk_cd': '123456'}) == source
    assert stock_detail_source('137X-2', source, {'stk_cd': '654321'}) == {}


def test_ranking_and_non_stock_cards_keep_the_complete_collection():
    source = {'ranking': [{'stk_cd': '123456'}, {'stk_cd': '654321'}]}
    for board in ('2V71-0', '2VDA-0', '2VO0-0', '2VIN-0', '32S7-0', '133H-0'):
        assert stock_detail_source(board, source, {'stk_cd': '123456'}) is source


def test_initial_surface_projection_filters_subject_but_keeps_full_semantic_observations():
    from athena_api.api.canvas_push import _bind_semantic_values, _integrated_card_contract
    source = {'opaf_invsr_trde': [
        {'stk_cd': '654321', 'stk_nm': '합성 다른 종목', 'ind_invsr': '999'},
        {'stk_cd': '123456', 'stk_nm': '합성 요청 종목', 'ind_invsr': '101'},
    ]}
    contract = _integrated_card_contract('base:ka10066')
    _bind_semantic_values(contract, 'base:ka10066', source, surface_target={'stk_cd': '123456'})
    values = [s['value'] for s in contract['surface_contract']['slot_values']]
    assert '999' not in values
    assert '101' in values
    observed = [s.get('value') for s in contract['semantic_observations']]
    assert '999' in observed and '101' in observed
    assert len(source['opaf_invsr_trde']) == 2
