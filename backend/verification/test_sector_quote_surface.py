"""A sector quote list must not turn its array container into an aggregate."""
from athena_api.card_surface_contract import bind_surface_values, build_board_surface_contract


def _project(rows):
    operation = 'base:ka20002'
    return build_board_surface_contract(
        '15J9-2', bind_surface_values(operation, {'inds_stkpc': rows}),
        active_operation_refs=[operation],
    )


def test_sector_quote_rows_preserve_actual_subjects_and_values():
    rows = [dict(stk_nm=f'합성 업종종목 {i}', stk_cd=f'{i:06d}', cur_prc=str(-12000-i),
                 pred_pre=str(101+i), now_trde_qty=str(i), open_pric=str(10000+i),
                 high_pric=str(13000+i), sel_bid=str(14000+i), buy_bid=str(11000+i))
            for i in range(1, 4)]
    values = {s['slot_id']: s['value'] for s in _project(rows)['slot_values']}
    for i, start in enumerate([15, 26, 37]):
        assert values[f's{start:03d}'] == rows[i]['stk_nm']
        assert values[f's{start+1:03d}'] == rows[i]['stk_cd']
        assert values[f's{start+2:03d}'] == rows[i]['cur_prc']
        assert values[f's{start+5:03d}'] == rows[i]['now_trde_qty']
    assert not {'s006', 's007', 's008', 's048', 's052', 's069'} & values.keys()


def test_short_and_empty_sector_lists_never_restore_specimen_rows_or_a_count():
    for rows in [[], [dict(stk_nm='합성 하나', stk_cd='000007', now_trde_qty='0')]]:
        values = {s['slot_id']: s['value'] for s in _project(rows)['slot_values']}
        assert not {'s026', 's027', 's037', 's038', 's048'} & values.keys()
        if rows:
            assert values['s015'] == '합성 하나'
            assert values['s020'] == '0'
