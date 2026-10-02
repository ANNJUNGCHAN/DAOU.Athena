"""Unit metadata is from public fields and synthetic query arguments only."""

import copy

import pytest

from athena_api.semantic_presentation_registry import get_semantic_presentation_registry
from athena_api.surface_display_units import annotate_surface_display_units


@pytest.mark.parametrize('operation', ['ka20004', 'ka20005', 'ka20006', 'ka20007', 'ka20008', 'ka20019'])
def test_sector_chart_prices_use_documented_packed_units_without_scaling_other_fields(operation):
    from decimal import Decimal
    from athena_api.surface_display_units import sector_chart_index
    op = 'base:' + operation
    for field in ['cur_prc', 'open_pric', 'high_pric', 'low_pric']:
        assert sector_chart_index(op, field, '-272127') == Decimal('2721.27')
        assert sector_chart_index(op, field, {'value': 0, 'text': 'stale'}) == 0
    for field in ['pred_pre', 'flu_rt', 'trde_qty', 'trde_prica', 'dt']:
        assert sector_chart_index(op, field, '272127') is None
    for value in [None, True, '', 'NaN', 'Infinity', {'value': None, 'text': '2721.27'}]:
        assert sector_chart_index(op, 'cur_prc', value) is None


def test_sector_slot_annotation_preserves_raw_observation_and_unrelated_decimal_sources():
    from athena_api.surface_display_units import sector_chart_index
    occurrence = 'base:ka20006|$.inds_dt_pole_qry[].cur_prc|1'
    entry = {'slot_id': 's004', 'value': '-272127', 'observation_id': 'obs_public', 'occurrence_id': occurrence}
    source = {'board_id': '32S7-0', 'slot_values': [entry]}
    result = annotate_surface_display_units(source, {'base:ka20006': {}})
    assert result['slot_values'][0]['value'] == {'value': '-272127', 'text': '2,721.27', 'display_unit': '지수', 'tone': 'flat'}
    assert result['slot_values'][0]['occurrence_id'] == occurrence
    assert result['slot_values'][0]['observation_id'] == 'obs_public'
    assert source['slot_values'][0]['value'] == '-272127'
    for op in ['base:ka20003', 'base:0J', 'base:ka10081']:
        assert sector_chart_index(op, 'cur_prc', '2721.27') is None


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


def test_listed_share_count_cannot_inherit_contradictory_currency_metadata():
    from athena_api.semantic_presentation_registry import get_semantic_presentation_registry
    for operation in ['detail:ka10001:identity_and_capital']:
        field = next(f for f in get_semantic_presentation_registry().for_operation(operation)
                     if f.json_path == '$.flo_stk')
        for raw in ['1234567', '0', None]:
            source = {'slot_values': [{'slot_id': 'shares', 'value': raw,
                       'format': {'kind': 'korean'}, 'occurrence_id': field.wire_occurrence_id}]}
            before = copy.deepcopy(source)
            actual = annotate_surface_display_units(source, {operation: {}})['slot_values'][0]['value']
            if raw is None:
                assert actual is None
            else:
                assert actual['value'] == raw
                assert actual['text'] == ('1,234,567' if raw != '0' else '0') + ' (단위 미확인)'
                assert actual['display_unit'] == 'unknown'
            assert source == before


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


@pytest.mark.parametrize('operation', ['base:ka10059', 'base:ka10060', 'base:ka10061'])
@pytest.mark.parametrize('args,suffix', [({}, ' (단위 미확인)'), ({'amt_qty_tp':'1'}, '백만원'), ({'amt_qty_tp':'2','unit_tp':'1'}, '주'), ({'amt_qty_tp':'2','unit_tp':'1000'}, '천주')])
def test_natn_inherits_exact_request_measure_and_preserves_zero(operation, args, suffix):
    field = next(f for f in get_semantic_presentation_registry().for_operation(operation) if f.json_path.endswith('.natn'))
    for raw in ['0', '-1234', {'value':'0','text':'old specimen'}]:
        source = {'slot_values':[{'slot_id':'s073','occurrence_id':field.wire_occurrence_id,'value':raw,'format':{'tone':'change'}}]}
        value = annotate_surface_display_units(source,{operation:args})['slot_values'][0]['value']
        assert value['value'] == (raw['value'] if isinstance(raw,dict) else raw)
        assert value['text'] == ('-1,234' if raw == '-1234' else '0') + suffix


def investor_source(operation, field='frgnr_invsr'):
    occurrence = next(f for f in get_semantic_presentation_registry().for_operation(operation) if f.json_path.endswith('.'+field))
    return {'board_id':'2QFO-2','slot_values':[{'slot_id':'s038','occurrence_id':occurrence.wire_occurrence_id,'value':'0','format':{'tone':'change'}}]}


def test_caption_context_follows_actual_source_and_excludes_private_keys():
    source=investor_source('base:ka10061')
    args={'stk_cd':'123456','strt_dt':'20260901','end_dt':'20261002','trde_tp':'0','amt_qty_tp':'2','unit_tp':'1','account_no':'synthetic-private','token':'synthetic-secret','nested':{'any':'value'}}
    context=annotate_surface_display_units(source,{'base:ka10059':{'stk_cd':'654321','amt_qty_tp':'1'},'base:ka10061':args})['flow_query_context']
    assert context['operation_ref']=='base:ka10061'
    assert context['operation_args']=={k:v for k,v in args.items() if k not in {'account_no','token','nested'}}
    assert 'flow_query_context' not in source


def test_empty_reply_uses_only_one_unambiguous_successful_investor_request():
    source={'board_id':'2QFO-2','slot_values':[]}
    assert annotate_surface_display_units(source,{'base:ka10059':{'stk_cd':'123456'}})['flow_query_context']['operation_ref']=='base:ka10059'
    assert annotate_surface_display_units(source,{'base:ka10059':{},'base:ka10061':{}})['flow_query_context'] is None
    assert annotate_surface_display_units(source,{'base:ka10066':{}})['flow_query_context'] is None


def test_mixed_investor_sources_are_not_reported_as_one_query():
    source=investor_source('base:ka10059')
    source['slot_values'].extend(investor_source('base:ka10061','orgn')['slot_values'])
    assert annotate_surface_display_units(source,{'base:ka10059':{},'base:ka10061':{}})['flow_query_context'] is None


def test_context_is_limited_to_exact_investor_board():
    for board in ['137X-2','2QM7-2','2S4E-1',None]:
        source=investor_source('base:ka10059')
        source['board_id']=board
        assert 'flow_query_context' not in annotate_surface_display_units(source,{'base:ka10059':{'stk_cd':'123456'}})
