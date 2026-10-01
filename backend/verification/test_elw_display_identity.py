"""Synthetic public ELW codes only; no account data or live requests."""

from athena_api.elw_display_identity import elw_detail_source


def test_detail_uses_matching_security_even_when_another_list_puts_it_second():
    source = {'elwcnd_qry': [
        {'stk_cd': 'A10001', 'stk_nm': '합성 다른 종목', 'srvive_dys': '106'},
        {'stk_cd': 'A52M001', 'stk_nm': '합성 요청 종목', 'srvive_dys': '12', 'trde_qty': '0'},
    ]}
    result = elw_detail_source('15P5-2', 'base:ka30005', source, {'stk_cd': '52M001'})
    assert result['elwcnd_qry'] == [source['elwcnd_qry'][1]]
    assert len(source['elwcnd_qry']) == 2
    assert result['elwcnd_qry'][0]['trde_qty'] == '0'


def test_unknown_or_missing_detail_subject_never_promotes_the_first_list_item():
    source = {'elwdispty_rt': [{'stk_cd': '52M001', 'base_aset_nm': '합성 기초자산'}]}
    for target in [{}, {'stk_cd': '52M002'}]:
        assert elw_detail_source('3DZ1-0', 'base:ka30004', source, target)['elwdispty_rt'] == []


def test_ranking_and_requested_instrument_history_are_not_filtered():
    source = {'elwcnd_qry': [{'stk_cd': '52M001'}, {'stk_cd': '52M002'}]}
    assert elw_detail_source('2ZN9-0', 'base:ka30005', source, {}) is source
    history = {'elwlpposs_daly_trnsn': [{'dt': '20261001', 'cur_prc': '123'}]}
    assert elw_detail_source('15P5-2', 'base:ka30003', history, {'stk_cd': '52M001'}) is history
