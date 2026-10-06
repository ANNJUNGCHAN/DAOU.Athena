"""Subscription-right quotes preserve response order instead of inventing rankings."""
from athena_api.card_surface_contract import bind_surface_values, build_board_surface_contract


def _values(rows):
    operation = 'base:ka10011'
    contract = build_board_surface_contract(
        '32XM-0', bind_surface_values(operation, {'newstk_recvrht_mrpr': rows}),
        active_operation_refs=[operation],
    )
    return {s['slot_id']: s['value'] for s in contract['slot_values']}


def test_first_response_summary_does_not_sort_or_claim_the_maximum():
    rows = [
        dict(stk_nm='합성 첫 종목', stk_cd='J000001D', flu_rt='-3.56', cur_prc='812', acc_trde_qty='0'),
        dict(stk_nm='합성 둘째 종목', stk_cd='J000002D', flu_rt='+14.83', cur_prc='103', acc_trde_qty='25000'),
    ]
    values = _values(rows)
    assert values['s023'] == '-3.56'
    assert values['s024'] == '합성 첫 종목'
    for row, name_slot, code_slot, quantity_slot in [(0, 's042', 's043', 's049'), (1, 's055', 's056', 's062')]:
        assert values[name_slot] == rows[row]['stk_nm']
        assert values[code_slot] == rows[row]['stk_cd']
        assert values[quantity_slot] == rows[row]['acc_trde_qty']


def test_list_container_and_direction_code_are_not_counts_or_rank_values():
    values = _values([dict(stk_nm='합성 종목', stk_cd='J000007D', pred_pre_sig='5')])
    assert not {'s004', 's005', 's020', 's021', 's032', 's041', 's054'} & values.keys()
    assert not {'s055', 's068', 's051', 's052', 's053', 's228', 's230', 's232'} & values.keys()


def test_empty_subscription_rights_response_has_no_specimen_summary_or_rows():
    assert _values([]) == {}
