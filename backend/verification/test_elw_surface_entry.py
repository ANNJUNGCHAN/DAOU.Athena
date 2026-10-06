"""Public collection contracts must enter their authored list, not an ELW specimen."""

import pytest

from athena_api.card_surface_contract import bind_surface_values, build_surface_contract
from athena_api.card_surface_templates import get_registry


@pytest.mark.parametrize(('operation', 'board'), [
    ('ka30001', '2Y47-0'), ('ka30002', '2Z49-0'), ('ka30005', '2ZN9-0'),
    ('ka30009', '2XA5-0'), ('ka30010', '2VO0-0'), ('ka30011', '2XY6-0'),
])
def test_elw_collection_uses_its_declared_ranking_surface(operation, board):
    ref = f'base:{operation}'
    contract = build_surface_contract(ref)
    assert contract['board_id'] == board
    assert contract['initial_state_board'] is None
    assert ref in get_registry().boards[board].operation_refs


def test_saved_elw_list_keeps_distinct_received_rows_on_entry():
    ref = 'base:ka30005'
    data = {'elwcnd_qry': [
        {'stk_cd': 'A10001', 'stk_nm': '합성 ELW A', 'cur_prc': '123', 'srvive_dys': '7'},
        {'stk_cd': 'A10002', 'stk_nm': '합성 ELW B', 'cur_prc': '456', 'srvive_dys': '31'},
    ]}
    contract = build_surface_contract(ref, bind_surface_values(ref, data))
    values = [slot['value'] for slot in contract['slot_values']]
    for expected in ['합성 ELW A', '합성 ELW B', '123', '456']:
        assert expected in values
    assert contract['board_id'] == '2ZN9-0'


def test_elw_product_details_still_enter_the_product_surface():
    contract = build_surface_contract('detail:ka30012:valuation_and_rights')
    assert contract['board_id'] == '15P5-2'


def test_disparity_collection_preserves_the_semantic_list_instead_of_promoting_first_row():
    # No disparity-specific ranking surface exists. Returning no authored
    # surface uses the existing semantic workspace with the actual source rows.
    assert build_surface_contract('base:ka30004', bind_surface_values('base:ka30004', {
        'elwdispty_rt': [{'stk_cd': '52M001', 'stk_nm': '합성 ELW A'},
                       {'stk_cd': '52M002', 'stk_nm': '합성 ELW B'}],
    })) is None
