"""Authored ladders receive actual REST levels; synthetic public fields only."""
import json
from pathlib import Path

from athena_api.card_surface_contract import bind_surface_values, build_board_surface_contract
from athena_api.semantic_presentation_registry import get_semantic_presentation_registry

ROOT = Path(__file__).resolve().parents[2]
BOARDS = ('2TRW-1', '3JZ3-0', '3N4O-0')


def test_regular_authored_price_levels_have_exact_rest_fallbacks():
    bound = bind_surface_values('detail:ka10007:bid_prices', {
        **{f'sel_{i}bid': str(10000 + i) for i in range(1, 11)},
        **{f'buy_{i}bid': str(10000 - i) for i in range(1, 11)},
    })
    for board in BOARDS:
        raw = json.loads((ROOT / 'backend/ref/card-surface-templates' / board / 'slots.json').read_text(encoding='utf8'))
        result = build_board_surface_contract(board, bound)
        observed = {s['slot_id']: s['value'] for s in result['slot_values']}
        prices = [s for s in raw['slots'] if s.get('mapping_id') == 'detail:ka10007:bid_prices']
        assert len({s['f'] for s in prices}) == (10 if board == '2TRW-1' else 20)
        for s in prices:
            side, level = s['f'].split('_')
            depth = int(level.removesuffix('bid'))
            expected = 10000 + depth if side == 'sel' else 10000 - depth
            assert observed[s['slot_id']] == str(expected)


def test_all_added_rest_binding_fields_exist_in_the_public_registry():
    registry = get_semantic_presentation_registry()
    for board in BOARDS:
        raw = json.loads((ROOT / 'backend/ref/card-surface-templates' / board / 'slots.json').read_text(encoding='utf8'))
        for slot in raw['slots']:
            for binding in slot.get('alt_mappings') or []:
                if not binding['mapping_id'].startswith(('detail:ka10007:', 'detail:ka10004:')):
                    continue
                fields = registry.for_operation(binding['mapping_id'])
                assert any(f.wire_occurrence_id.split('|')[1].endswith('.' + binding['f']) for f in fields), (board, slot['slot_id'], binding)


def test_missing_levels_are_not_fabricated_and_real_zero_quantities_remain():
    bound = bind_surface_values('detail:ka10007:bid_quantities', {'sel_1bid_req': '0'})
    for board in BOARDS:
        raw = json.loads((ROOT / 'backend/ref/card-surface-templates' / board / 'slots.json').read_text(encoding='utf8'))
        result = build_board_surface_contract(board, bound)
        observed = {s['slot_id']: s['value'] for s in result['slot_values']}
        for slot in raw['slots']:
            if slot.get('mapping_id') == 'detail:ka10007:bid_prices' and slot.get('f') == 'sel_1bid':
                assert slot['slot_id'] not in observed
        assert '0' in observed.values()
