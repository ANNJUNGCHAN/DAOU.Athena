"""Separate session quotes and preserve the gold history's actual row identity."""
from athena_api.card_surface_contract import bind_surface_values, build_board_surface_contract
from athena_api.card_surface_templates import get_registry


def test_afterhours_depths_bind_all_five_levels_without_regular_session_fields():
    bound = {}
    for side in ('sell', 'buy'):
        key = 'sel' if side == 'sell' else 'buy'
        for group, suffix in [('prices', ''), ('quantities', '_qty')]:
            bound.update(bind_surface_values(f'detail:ka10087:{side}_bid_{group}', {
                f'ovt_sigpric_{key}_bid{suffix}_{i}': str(i * 100) for i in range(1, 6)
            }))
    for board_id in ('2QRP-1', '3JT4-0'):
        board = get_registry().boards[board_id]
        assert not any(b.mapping_id in ('base:0D', 'detail:ka10007:session')
                       for slot in board.binding_slots for b in slot.bindings)
        result = build_board_surface_contract(board_id, bound)
        observed = {entry['slot_id']: entry['value'] for entry in result['slot_values']}
        depths = [slot for slot in board.binding_slots if slot.mapping_id in (
            'detail:ka10087:sell_bid_prices', 'detail:ka10087:buy_bid_prices',
            'detail:ka10087:sell_bid_quantities', 'detail:ka10087:buy_bid_quantities')]
        assert len({slot.f for slot in depths}) == 20
        assert all(observed[slot.slot_id] == str(int(slot.f[-1]) * 100) for slot in depths)


def test_gold_summary_best_quotes_and_history_do_not_reuse_other_rows_as_depth():
    source = {'gold_bid': [
        {'cntr_pric': '100001', 'pri_sel_bid_unit': '100002', 'pri_buy_bid_unit': '100000', 'tm': '110001', 'cntr_trde_qty': '0'},
        {'cntr_pric': '90001', 'pri_sel_bid_unit': '90002', 'pri_buy_bid_unit': '90000', 'tm': '110000', 'cntr_trde_qty': '5'},
    ]}
    result = build_board_surface_contract('2QX1-1', bind_surface_values('base:ka50101', source))
    values = {entry['slot_id']: entry['value'] for entry in result['slot_values']}
    assert values['s010'] == values['s048'] == values['s090'] == '100001'
    assert values['s014'] == values['s044'] == '100002'
    assert values['s017'] == values['s051'] == '100000'
    assert values['s096'] == '90001'
    assert values['s092'] == '0'
    assert values['s098'] == '5'
    assert not any(slot.f == 'gold_bid' for slot in get_registry().boards['2QX1-1'].binding_slots)
    for unavailable in ('s015', 's018', 's032', 's034', 's053', 's065'):
        assert unavailable not in values


def test_empty_gold_response_never_recreates_specimen_quotes():
    result = build_board_surface_contract('2QX1-1', bind_surface_values('base:ka50101', {'gold_bid': []}))
    assert result['slot_values'] == []
