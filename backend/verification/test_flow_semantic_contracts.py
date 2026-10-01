"""Synthetic public response shapes; no account data or external requests."""
from athena_api.card_surface_contract import bind_surface_values, build_board_surface_contract


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
