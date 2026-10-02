"""Synthetic public response shapes; no account data or external requests."""
from athena_api.card_surface_contract import bind_surface_values, build_board_surface_contract
from athena_api.card_surface_templates import get_registry
from athena_api.surface_display_units import annotate_surface_display_units
from athena_api.mock_unsupported import is_mock_unsupported


def test_limit_increase_kpis_never_borrow_subjects_between_queries():
    values = values_for('2ZTA-0', {
        'base:ka10036': {'for_limit_exh_rt_incrs_upper': [
            {'stk_nm': '증가조회 종목', 'stk_cd': '111111', 'exh_rt_incrs': '0.1', 'gain_pos_stkcnt': '0'}]},
        'base:ka10035': {'for_cont_nettrde_upper': [
            {'stk_nm': '연속조회 종목', 'stk_cd': '222222', 'limit_exh_rt': '0'}]},
    })
    assert values['s014'] == values['s158'] == '증가조회 종목'
    assert values['s159'] == '111111'
    assert values['s017'] == '연속조회 종목'
    assert values['s016'] == values['s165'] == '0'


def test_equal_trade_summary_and_six_results_follow_their_own_source_rows():
    rows = [{'stk_nm': f'조회 종목{i}', 'stk_cd': f'{111111+i}', 'nettrde_amt': str(i)} for i in range(6)]
    values = values_for('31CL-0', {'base:ka10062': {'eql_nettrde_rank': rows}})
    assert values['s019'] == values['s158'] == rows[0]['stk_nm']
    assert values['s159'] == rows[0]['stk_cd']
    assert values['s020'] == '0'
    for i, row in enumerate(rows):
        assert values[f's{176+2*i:03}'] == row['stk_nm']
        assert values[f's{177+2*i:03}'] == row['nettrde_amt']
    assert not {'s126', 's172', 's173'}.intersection(values)


def test_foreign_window_main_rows_do_not_borrow_another_broker_amount():
    board = get_registry().boards['30TY-0']
    values = values_for('30TY-0', {
        'base:ka10037': {'frgn_wicket_trde_upper': [{'stk_nm': '창구 종목', 'stk_cd': '111111', 'buy_trde_qty': '0', 'sel_trde_qty': '123'}]},
        'base:ka10039': {'sec_trde_upper': [{'stk_nm': '증권사 종목', 'stk_cd': '222222', 'buy_amt': '999999', 'sell_amt': '888888', 'prid_stkpc_flu': '0'}]},
    })
    for slot in board.slots:
        if slot.table and slot.table.table_id == '362Z-0' and slot.binds_a_field:
            assert slot.mapping_id == 'base:ka10037'
    assert values['s179'] == '0'
    assert '999999' not in values.values() and '888888' not in values.values()


def test_foreign_window_missing_primary_never_uses_other_query_names_or_quantities():
    board = get_registry().boards['30TY-0']
    main_ids = {s.slot_id for s in board.slots if s.table and s.table.table_id == '362Z-0'}
    other = {'base:ka10039': {'sec_trde_upper': [
        {'stk_cd': f'{999990+i}', 'stk_nm': f'다른 조회{i}', 'netprps': '987654',
         'buy_trde_qty': '876543', 'sel_trde_qty': '765432'} for i in range(8)]},
        'base:ka10078': {'sec_stk_trde_trend': [
            {'dt': f'2026090{i+1}', 'acc_trde_qty': '654321', 'netprps_qty': '0'} for i in range(8)]}}
    assert not main_ids.intersection(values_for('30TY-0', other))
    for row in [{}, {'stk_cd': '111111', 'buy_trde_qty': '0'},
                {'stk_nm': '주조회 종목', 'stk_cd': '111111', 'netprps_trde_qty': '0',
                 'buy_trde_qty': '0', 'sel_trde_qty': '0', 'trde_qty': '0'}]:
        values = values_for('30TY-0', {**other, 'base:ka10037': {'frgn_wicket_trde_upper': [row]}})
        expected = {s.slot_id: row[s.f] for s in board.slots
                    if s.table and s.table.table_id == '362Z-0' and s.table.row == '0'
                    and s.mapping_id == 'base:ka10037' and s.f in row}
        assert {key: value for key, value in values.items() if key in main_ids} == expected
        assert values['s195'] == '다른 조회0'
    for slot in board.slots:
        if slot.slot_id in main_ids and slot.binds_a_field:
            assert slot.mapping_id == 'base:ka10037'
            assert not slot.alt_mappings


def test_exact_equal_trade_card_preserves_raw_average_and_actual_quantity_units():
    from copy import deepcopy
    for field in ['for_nettrde_avg_pric', 'orgn_nettrde_avg_pric', 'for_nettrde_qty', 'orgn_nettrde_qty', 'nettrde_qty']:
        for raw in ['-123456.25', '0', None, {'value': '0', 'text': 'obsolete'}]:
            source = {'board_id': '31CL-0', 'slot_values': [{'slot_id': 'public', 'occurrence_id': f'base:ka10062|$.eql_nettrde_rank[].{field}|1', 'value': raw}]}
            before = deepcopy(source)
            for unit, suffix in [('1', '주'), ('1000', '천주'), ('', ' (단위 미확인)')]:
                result = annotate_surface_display_units(source, {'base:ka10062': {'unit_tp': unit}})['slot_values'][0]['value']
                if raw is None:
                    assert result is None
                else:
                    assert result['value'] == (raw['value'] if isinstance(raw, dict) else raw)
                    expected = '-123,456.25' if raw == '-123456.25' else '0'
                    assert result['text'] == expected + (' (단위 확인 필요)' if field.endswith('avg_pric') else suffix)
            assert source == before


def values_for(board, responses):
    bound = {}
    for operation, response in responses.items():
        bound.update(bind_surface_values(operation, response))
    surface = build_board_surface_contract(board, bound_values=bound, active_operation_refs=list(responses))
    assert surface is not None
    return {entry['slot_id']: entry['value'] for entry in surface['slot_values']}


INVESTORS = {
    's038': 'frgnr_invsr', 's045': 'penfnd_etc', 's052': 'etc_corp', 's059': 'bank',
    's066': 'etc_fnnc', 's073': 'natn', 's080': 'natfor', 's087': 'insrnc',
    's094': 'samo_fund', 's101': 'invtrt', 's109': 'ind_invsr', 's116': 'fnnc_invt', 's124': 'orgn',
}
BUY = [('s036','s037','s042'), ('s048','s049','s054'), ('s060','s061','s066'), ('s072','s073','s077'), ('s083','s084','s088')]
SELL = [('s039','s040','s043'), ('s051','s052','s055'), ('s063','s064','s067'), ('s074','s075','s078'), ('s085','s086','s089')]


def test_investor_rows_share_the_same_observation_day_and_one_requested_trade_value():
    first = {field: str(i - 6) for i, field in enumerate(INVESTORS.values())}
    first['dt'] = '20261001'
    second = {field: '999999' for field in INVESTORS.values()}
    second['dt'] = '20260930'
    values = values_for('2QFO-2', {'base:ka10059': {'stk_invsr_orgn': [first, second]}})
    assert values == {'s027': '20261001', **{slot: first[field] for slot, field in INVESTORS.items()}}


def test_investor_period_sum_uses_its_own_response_without_fabricating_a_day():
    row = {field: '0' for field in INVESTORS.values()}
    values = values_for('2QFO-2', {'base:ka10061': {'stk_invsr_orgn_tot': [row]}})
    assert values == {slot: '0' for slot in INVESTORS}


def test_active_period_sum_is_not_replaced_by_a_hydrated_daily_response():
    period = {field: str(-i) for i, field in enumerate(INVESTORS.values())}
    daily = {field: '999999' for field in INVESTORS.values()}
    daily['dt'] = '20260930'
    values = values_for('2QFO-2', {
        'base:ka10061': {'stk_invsr_orgn_tot': [period]},
        'base:ka10059': {'stk_invsr_orgn': [daily]},
    })
    assert values == {'s027': '20260930', **{slot: period[field] for slot, field in INVESTORS.items()}}


def test_missing_investor_data_does_not_fall_back_to_other_rankings():
    values = values_for('2QFO-2', {'base:ka10052': {'trde_ori_mont_trde': [{'frgnr_invsr': '555'}]}})
    assert values == {}


def test_buy_and_sell_brokers_keep_independent_names_codes_and_quantities():
    responses = {}
    for side, prefix in [('buy','buy'), ('sell','sel')]:
        data = {}
        for i in range(1, 6):
            data[f'{prefix}_trde_ori_nm_{i}'] = f'합성 {side} 거래원 {i}'
            data[f'{prefix}_trde_ori_{i}'] = f'{i:03}'
            data[f'{prefix}_trde_qty_{i}'] = str(i * (101 if side == 'buy' else 307))
        responses[f'detail:ka10002:{side}_brokers'] = data
    values = values_for('2QM7-2', responses)
    assert len(values) == 30
    for side, rows in [('buy', BUY), ('sell', SELL)]:
        for i, (name, code, quantity) in enumerate(rows, 1):
            assert [values[name], values[code], values[quantity]] == [f'합성 {side} 거래원 {i}', f'{i:03}', str(i * (101 if side == 'buy' else 307))]


def test_short_broker_response_keeps_real_zero_and_does_not_repeat_top_broker():
    values = values_for('2QM7-2', {'detail:ka10002:buy_brokers': {'buy_trde_ori_nm_1':'합성 영수량', 'buy_trde_ori_1':'007', 'buy_trde_qty_1':'0'}})
    assert values == {'s036':'합성 영수량', 's037':'007', 's042':'0'}


def test_realtime_broker_fields_use_the_same_rank_and_side():
    # Surface registry reads the normalized data row after wire FID flattening.
    values = values_for('2QM7-2', {'base:0F': {'data': [{'151':'매수 1', '156':'001', '171':'111', '145':'매도 5', '150':'005', '165':'555'}]}})
    assert values == {'s036':'매수 1', 's037':'001', 's042':'111', 's085':'매도 5', 's086':'005', 's089':'555'}


def test_stock_trend_broker_names_match_the_side_and_rank_of_their_quantities():
    responses = {}
    for side, prefix in [('buy', 'buy'), ('sell', 'sel')]:
        row = {}
        for rank in range(1, 4):
            row[f'{prefix}_trde_ori_{rank}'] = f'합성 {side} 거래원 {rank}'
            row[f'{prefix}_trde_ori_qty_{rank}'] = str(rank * (101 if side == 'buy' else -307))
        responses[f'detail:ka10040:{side}_brokers'] = row
    values = values_for('2S4E-1', responses)
    for side, slots in [('buy', [('s114','s115'), ('s116','s117'), ('s118','s119')]),
                        ('sell', [('s121','s122'), ('s123','s124'), ('s125','s126')])]:
        for rank, (name, quantity) in enumerate(slots, 1):
            assert values[name] == f'합성 {side} 거래원 {rank}'
            assert values[quantity] == str(rank * (101 if side == 'buy' else -307))


def test_stock_trend_missing_broker_names_never_inherit_specimens_and_keep_zero_quantity():
    values = values_for('2S4E-1', {
        'detail:ka10040:buy_brokers': {'buy_trde_ori_qty_1':'0'},
        'detail:ka10040:sell_brokers': {'sel_trde_ori_2':'합성 매도2', 'sel_trde_ori_qty_2':'-5'},
    })
    assert values['s115'] == '0'
    assert values['s123'] == '합성 매도2'
    assert values['s124'] == '-5'
    assert all(slot not in values for slot in ['s114','s116','s118','s121','s125'])


SPECS = {
    '2V71-0': ('base:ka90003', 'prm_netprps_upper_50', '2WBN-0',
        ['rank','stk_cd','stk_nm','cur_prc','pred_pre','prm_netprps_amt','prm_buy_amt','prm_sell_amt','acc_trde_qty']),
    '3063-0': ('base:ka10065', 'opmr_invsr_trde_upper', '35L4-0',
        ['stk_cd','stk_nm','buy_qty','sel_qty','netslmt']),
    '30HY-0': ('base:ka10131', 'orgn_frgnr_cont_trde_prst', '34IW-0',
        ['rank','stk_cd','stk_nm','frgnr_nettrde_amt','frgnr_nettrde_qty','orgn_nettrde_amt','orgn_nettrde_qty','nettrde_amt','nettrde_qty','tot_cont_netprps_dys','tot_cont_nettrde_qty','tot_cont_netprps_amt']),
}

def fixture_bound(zero=False):
    bound = {}
    for source, (operation, array, _, fields) in enumerate(SPECS.values(),1):
        rows=[]
        for row in range(8):
            rows.append({field: (f'합성{source}-{row}' if field=='stk_nm' else f'{source*100+row:06d}' if field=='stk_cd' else str(row+1) if field=='rank' else '0' if zero else str(-source*10000-row)) for field in fields})
        bound.update(bind_surface_values(operation,{array:rows}))
    bound.update(bind_surface_values('base:ka10034',{'for_dt_trde_upper':[{'stk_nm':'다른 조회 종목','stk_cd':'999999','cur_prc':'987654','pred_pre':'-54321'} for _ in range(8)]}))
    return bound

def contract(board,zero=False):
    return build_board_surface_contract(board,fixture_bound(zero),get_registry())

def test_three_main_lists_keep_one_source_and_each_explicit_row():
    registry=get_registry()
    for board,(operation,_,table,_) in SPECS.items():
        values={v['slot_id']:v for v in contract(board)['slot_values']}
        names=[]
        for slot in registry.boards[board].slots:
            if not slot.table or slot.table.table_id!=table or not slot.table.row.isdigit():continue
            if slot.binds_a_field:
                entry=values[slot.slot_id]
                assert entry['occurrence_id'].startswith(operation+'|')
                assert entry['row_index']==int(slot.table.row)
                if slot.f=='stk_nm': names.append(entry['value'])
            else: assert slot.slot_id not in values
        assert len(names)==len(set(names))==8

def test_selected_pairs_match_received_first_stock_and_last_row_is_distinct():
    for board, selected, first in [('2V71-0',('s168','s169'),('s042','s043')),('3063-0',('s170','s171'),('s046','s047')),('30HY-0',('s158','s159'),('s042','s043'))]:
        values={v['slot_id']:v['value'] for v in contract(board)['slot_values']}
        assert tuple(values[s] for s in selected)==tuple(values[s] for s in first)

def test_real_zero_is_present_and_empty_response_invents_nothing():
    for board in SPECS:
        result=contract(board,True)
        assert any(v['value']=='0' for v in result['slot_values'])
        assert not build_board_surface_contract(board,{},get_registry())['slot_values']

def test_investor_amount_quantity_and_unknown_keep_raw_and_no_subject_assertion():
    raw=contract('3063-0')
    for mode,unit in [('1','백만원'),('2','주'),('', 'unknown')]:
        annotated=annotate_surface_display_units(raw,{'base:ka10065':{'amt_qty_tp':mode}})
        nums=[v for v in annotated['slot_values'] if v['occurrence_id'].split('|')[1].rsplit('.',1)[-1] in ('buy_qty','sel_qty','netslmt')]
        assert len(nums)==33
        originals={v['slot_id']:v['value'] for v in raw['slot_values']}
        assert all(v['value']['display_unit']==unit and v['value']['value']==originals[v['slot_id']] for v in nums)
    assert 'flow_query_context' not in annotated

def test_credit_list_cannot_borrow_foreign_ranking_prices():
    board=get_registry().boards['31OF-0']
    assert is_mock_unsupported('base:kt20016') and is_mock_unsupported('base:kt20017')
    assert not board.operation_refs
    assert not board.binding_slots
    assert any(key.startswith('base:ka10034|') and '.cur_prc|' in key for key in fixture_bound())
    assert not contract('31OF-0')['slot_values']

def test_program_summary_public_units_are_raw_thousand_shares_and_unknown():
    slots={s.slot_id:s for s in get_registry().boards['2V71-0'].slots}
    assert all(slots[s].format.get('suffix')=='천주' for s in ['s186','s189'])
    assert slots['s194'].format.get('suffix')==' (단위 미확인)'
