"""Displayed quote changes use a fractional change rate, not direction or volume."""
import pytest

from athena_api.card_surface_contract import bind_surface_values, build_board_surface_contract


@pytest.mark.parametrize('board,slots', [
    ('13BC-2', ['s011', 's062']), ('1JPU-0', ['s169', 's255']),
    ('2TRW-1', ['s011', 's046']), ('3JZ3-0', ['s011', 's108']),
    ('3N4O-0', ['s085', 's178']),
])
def test_summary_and_central_rate_are_the_same_observation(board, slots):
    bound = bind_surface_values('detail:ka10007:expected_market', {
        'flu_rt': '+0.93', 'smbol': '2', 'pred_rt': '-23', 'cur_prc': '101',
    })
    result = build_board_surface_contract(board, bound)
    assert result is not None
    values = {v['slot_id']: v for v in result['slot_values']}
    for slot in slots:
        assert values[slot]['value'] == '+0.93'
        assert values[slot]['format']['precision'] == 2
        assert values[slot]['occurrence_id'].endswith('$.flu_rt|1')
