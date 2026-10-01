"""Unit metadata is from public fields and synthetic query arguments only."""

import copy

from athena_api.surface_display_units import annotate_surface_display_units


def flow_surface():
    # Public occurrence identities, independent of a particular card's row layout.
    return {'slot_values': [
        {'slot_id': 'foreign', 'value': '-1234', 'format': {'tone': 'change'},
         'occurrence_id': 'base:ka10059|$.stk_invsr_orgn[].frgnr_invsr|1'},
        {'slot_id': 'institution', 'value': '0', 'format': {'tone': 'change'},
         'occurrence_id': 'base:ka10059|$.stk_invsr_orgn[].orgn|1'},
    ]}


def foreign_value(surface):
    return next(entry['value'] for entry in surface['slot_values']
                if '.frgnr_invsr|' in entry.get('occurrence_id', ''))


def test_actual_query_selects_million_won_thousand_shares_or_single_shares():
    source = flow_surface()
    before = copy.deepcopy(source)
    for args, expected in [
        ({'amt_qty_tp': '1', 'unit_tp': '1000'}, '-1,234백만원'),
        ({'amt_qty_tp': '2', 'unit_tp': '1000'}, '-1,234천주'),
        ({'amt_qty_tp': '2', 'unit_tp': '1'}, '-1,234주'),
    ]:
        result = annotate_surface_display_units(source, {'base:ka10059': args})
        value = foreign_value(result)
        assert value['value'] == '-1234'
        assert value['text'] == expected
    assert source == before


def test_unknown_arguments_are_explicit_and_never_guessed_from_the_paper_unit():
    result = annotate_surface_display_units(flow_surface(), {'base:ka10059': {}})
    assert foreign_value(result)['text'] == '-1,234 (단위 미확인)'


def test_true_zero_quantity_remains_visible_with_its_received_unit():
    result = annotate_surface_display_units(flow_surface(), {'base:ka10059': {'amt_qty_tp': '2', 'unit_tp': '1'}})
    observed = [entry['value'] for entry in result['slot_values'] if '.orgn|' in entry.get('occurrence_id', '')]
    assert observed and all(value['text'] == '0주' and value['value'] == '0' for value in observed)


def test_unit_modes_follow_each_official_request_not_a_global_numeric_convention():
    from athena_api.surface_display_units import _unit
    assert _unit('base:ka10051', {'amt_qty_tp': '0'}) == '억원'
    assert _unit('base:ka10051', {'amt_qty_tp': '1'}) == '천주'
    assert _unit('base:ka10065', {'amt_qty_tp': '1', 'trde_tp': '2'}) == '백만원'
    assert _unit('base:ka10086', {'indc_tp': '0'}) == '주'
    assert _unit('base:ka10013', {'qry_tp': '2'}) == '백만주'
    assert _unit('base:ka90007', {'amt_qty_tp': '2'}) == '천주'


def test_alternative_fixed_currency_source_does_not_inherit_the_primary_million_scale():
    from athena_api.semantic_presentation_registry import get_semantic_presentation_registry
    field = next(f for f in get_semantic_presentation_registry().for_operation('base:ka50083')
                 if f.wire_occurrence_id.endswith('.acc_trde_prica|1'))
    source = {'slot_values': [{'slot_id': 'amount', 'value': '1234',
                             'format': {'kind': 'korean', 'scale': '백만', 'suffix': '원'},
                             'occurrence_id': field.wire_occurrence_id}]}
    result = annotate_surface_display_units(source, {'base:ka50083': {}})
    assert result['slot_values'][0]['value']['text'] == '1,234원'
    assert source['slot_values'][0]['value'] == '1234'


def test_million_won_alternative_does_not_inherit_the_primary_unscaled_won_unit():
    from athena_api.semantic_presentation_registry import get_semantic_presentation_registry
    field = next(f for f in get_semantic_presentation_registry().for_operation('base:ka90008')
                 if f.wire_occurrence_id.endswith('.prm_sell_amt|1'))
    source = {'slot_values': [{'slot_id': 'amount', 'value': '1234',
                             'format': {'unit': 'krw_ko'},
                             'occurrence_id': field.wire_occurrence_id}]}
    result = annotate_surface_display_units(source, {'base:ka90008': {}})
    assert result['slot_values'][0]['value']['text'] == '1,234백만원'
    assert result['slot_values'][0]['value']['value'] == '1234'
