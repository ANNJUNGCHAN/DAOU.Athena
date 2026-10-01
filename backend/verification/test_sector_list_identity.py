"""An authored visual group must not restart a single market response's rows."""

from athena_api.card_surface_contract import bind_surface_values, build_board_surface_contract
from athena_api.card_surface_templates import get_registry


def _project(rows):
    bound = bind_surface_values('base:ka10101', {'list': rows})
    contract = build_board_surface_contract('3BQB-0', bound, active_operation_refs=['base:ka10101'])
    return {s['slot_id']: s['value'] for s in contract['slot_values']}


def test_single_market_list_keeps_every_sector_once_across_authored_groups():
    rows = [dict(code=f'{i:03d}', name=f'합성 업종 {i}', marketCode='0', group='합성 그룹') for i in range(21)]
    values = _project(rows)
    slots = get_registry().boards['3BQB-0'].slots
    names = [values[s.slot_id] for s in slots if s.f == 'name']
    codes = [values[s.slot_id] for s in slots if s.f == 'code']
    assert names == [r['name'] for r in rows]
    assert codes == [r['code'] for r in rows]
    assert len(set(names)) == len(names) == 21
    assert values['s050'] == '합성 업종 11'
    assert values['s064'] == '합성 업종 17'


def test_short_list_never_repeats_its_first_rows_in_the_later_groups():
    values = _project([dict(code='001', name='합성 하나', marketCode='1')])
    assert values['s024'] == '001' and values['s025'] == '합성 하나'
    assert 's049' not in values and 's050' not in values
    assert 's063' not in values and 's064' not in values
    assert all(s not in values for s in ['s022','s023','s047','s048','s061','s062','s072'])


def test_vi_summary_uses_one_actual_event_and_does_not_restore_specimen_on_empty():
    operation = 'base:ka10054'
    bound = bind_surface_values(operation, {'motn_stk': [
        dict(stk_nm='합성 VI 하나', stk_cd='A00001', trde_cntr_proc_time='101112', virelis_time='101314'),
        dict(stk_nm='합성 VI 둘', stk_cd='A00002', trde_cntr_proc_time='111213', virelis_time='111415')
    ]})
    contract = build_board_surface_contract('31II-0', bound, active_operation_refs=[operation])
    values = {s['slot_id']: s['value'] for s in contract['slot_values']}
    assert values['s136'] == '합성 VI 하나'
    assert values['s137'] == '101112'
    assert values['s141'] == values['s150'] == '101314'
    assert 's139' not in values
    empty = build_board_surface_contract('31II-0', bind_surface_values(operation, {'motn_stk': []}), active_operation_refs=[operation])
    assert not {'s136','s137','s139','s141','s150'} & {s['slot_id'] for s in empty['slot_values']}
