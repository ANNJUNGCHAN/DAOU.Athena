"""Exact WATCH source identity projections; generic binder remains unchanged."""
import re
from dataclasses import replace
from athena_api.card_surface_templates import get_registry
from athena_api.card_surface_contract import bind_surface_values, build_board_surface_contract, _empty_rows, _empty_columns
BOARD = '2U5L-1'
MEMBERS = 'base:ka01301'
QUOTES = 'base:ka10095'
GROUPS = 'base:ka01300'
UNSUPPORTED = {'s003', 's019', 's020', 's191', 's207', 's210', 's213', 's216', 's219'}

def plain(source):
    return source.model_dump(by_alias=True, exclude_unset=True) if hasattr(source, 'model_dump') else source

def code(value):
    return value.strip() if isinstance(value, str) and re.fullmatch('[0-9A-Z]{6}(?:_(?:AL|NX))?', value.strip()) and (value.strip() != '000000') else None

def member_codes(source):
    data = plain(source)
    rows = data.get('nofj') if isinstance(data, dict) else None
    if not isinstance(rows, list):
        return []
    return list(dict.fromkeys((c for r in rows[:8] if isinstance(r, dict) and (c := code(r.get('cod2'))))))

def project_watchlist(contract, sources, *, registry=None, group=None):
    if not contract or contract.get('board_id') != BOARD:
        return contract
    registry = registry or get_registry()
    board = registry.boards[BOARD]
    data = {op: plain(source) for op, source in sources.items()}
    member_data = data.get(MEMBERS)
    members = member_data.get('nofj') if isinstance(member_data, dict) else None
    quote_data = data.get(QUOTES)
    quotes = quote_data.get('atn_stk_infr') if isinstance(quote_data, dict) else None
    membership_received = isinstance(members, list) or (isinstance(member_data, dict) and 'nofj' in member_data)
    members = members if isinstance(members, list) else []
    quote_received = isinstance(quotes, list) or (isinstance(quote_data, dict) and 'atn_stk_infr' in quote_data)
    quotes = quotes if isinstance(quotes, list) else []
    quote_indices = {}
    for index, row in enumerate(quotes):
        c = code(row.get('stk_cd')) if isinstance(row, dict) else None
        if c:
            quote_indices.setdefault(c, []).append(index)
    slots_by_source = {op: [] for op in (GROUPS, MEMBERS, QUOTES)}
    metadata = []
    for index in range(8):
        member = members[index] if index < len(members) and isinstance(members[index], dict) else {}
        c = code(member.get('cod2'))
        matches = quote_indices.get(c, [])
        quote_index = matches[0] if c and len(matches) == 1 else None
        quote = quotes[quote_index] if quote_index is not None else {}
        owned = [s for s in board.binding_slots if s.row_index == index and s.mapping_id in (MEMBERS, QUOTES)]
        if index == 0:
            owned += [board.slot('s002'), board.slot('s192')]
        empties, present, quote_slots, member_slots = ([], [], [], [])
        for slot in owned:
            if slot.slot_id in UNSUPPORTED:
                continue
            binding = slot.bindings[0]
            if slot.f == 'stk_cd':
                binding = next((b for b in slot.bindings if b.mapping_id == MEMBERS and b.f == 'cod2'))
            source_op = binding.mapping_id
            (member_slots if source_op == MEMBERS else quote_slots).append(slot.slot_id)
            source_row = member if source_op == MEMBERS else quote
            source_index = index if source_op == MEMBERS else quote_index
            projected = replace(slot, mapping_id=source_op, f=binding.f, occurrence_id=binding.occurrence_id, declared_occurrence_id=binding.declared_occurrence_id, json_path=binding.json_path, alt_mappings=(), row_index=source_index if source_index is not None else len(quotes))
            if source_op == MEMBERS or quote_index is not None:
                slots_by_source[source_op].append(projected)
            if binding.f in source_row:
                present.append(slot.slot_id)
                value = source_row[binding.f]
                if value is None or (isinstance(value, str) and (not value.strip())):
                    empties.append(slot.slot_id)
        metadata.append({'row': index, 'code': c, 'slot_ids': [s.slot_id for s in owned], 'present_slots': present, 'quote_slot_ids': quote_slots, 'member_slot_ids': member_slots, 'empty_slots': empties, 'quote_row_index': quote_index, 'quote_state': 'received' if quote_index is not None else 'ambiguous' if len(matches) > 1 else 'empty' if quote_received else 'absent'})
    for slot in board.binding_slots:
        if slot.mapping_id == GROUPS and slot.slot_id not in UNSUPPORTED:
            slots_by_source[GROUPS].append(replace(slot, alt_mappings=()))
    entries, empty_slots = ({}, set())
    for operation, slots in slots_by_source.items():
        if not isinstance(data.get(operation), dict):
            continue
        scoped_board = replace(board, slots=tuple(slots))
        scoped_registry = replace(registry, boards={**registry.boards, BOARD: scoped_board})
        result = build_board_surface_contract(BOARD, bind_surface_values(operation, data[operation]), scoped_registry)
        entries.update({entry['slot_id']: entry for entry in result['slot_values']})
        empty_slots.update(result['empty_value_slots'])
    filled = set(entries)
    result = {**contract, 'slot_values': list(entries.values()), 'unbound_slots': [s.slot_id for s in board.slots if s.slot_id not in filled], 'empty_value_slots': sorted(empty_slots | UNSUPPORTED), 'empty_rows': _empty_rows(board, filled), 'empty_columns': _empty_columns(board, filled), 'watchlist_rows': {'group': group, 'membership_received': membership_received, 'rows': metadata}}
    return result

def theme_contract(list_source, detail_source, requested_code, detail_requested_code):
    rows = list_source.get('thema_grp', [])
    found = [i for i, row in enumerate(rows) if row.get('thema_grp_cd') == requested_code]
    selected = found[0] if requested_code and len(found) == 1 else None
    indices = [i for i in range(len(rows)) if i != selected][:3]
    registry = get_registry()
    board = registry.boards['2UBO-1']
    overrides = {}
    for sid in ['s108', 's114', 's115', 's119']:
        overrides[sid] = selected if selected is not None else len(rows)
    for index, slots in enumerate([['s122', 's123', 's124'], ['s125', 's126', 's127'], ['s128', 's129', 's130']]):
        for sid in slots:
            overrides[sid] = indices[index] if index < len(indices) else len(rows)
    projected = replace(board, slots=tuple((replace(s, row_index=overrides[s.slot_id]) if s.slot_id in overrides else s for s in board.slots)))
    scoped = replace(registry, boards={**registry.boards, '2UBO-1': projected})
    bound = bind_surface_values('base:ka90001', list_source)
    if requested_code and detail_requested_code == requested_code:
        bound.update(bind_surface_values('base:ka90002', detail_source))
    return build_board_surface_contract('2UBO-1', bound, scoped)

def detail_contract(board_id, source, target_code):
    registry = get_registry()
    board = registry.boards[board_id]
    rows = source.get('atn_stk_infr', [])
    matching = [i for i, r in enumerate(rows) if r.get('stk_cd') == target_code]
    target = matching[0] if target_code and len(matching) == 1 else len(rows)
    others = [i for i in range(len(rows)) if i != target][:3] if target < len(rows) else []
    other_slots = {f's{115 + r * 4 + c:03}': others[r] if r < len(others) else len(rows) for r in range(3) for c in range(4)} if board_id == '3EWN-0' else {}
    scoped_board = replace(board, slots=tuple((replace(s, row_index=other_slots.get(s.slot_id, target)) if s.mapping_id == 'base:ka10095' else s for s in board.slots)))
    scoped_registry = replace(registry, boards={**registry.boards, board_id: scoped_board})
    return build_board_surface_contract(board_id, bind_surface_values('base:ka10095', source), scoped_registry)

def dumped(value):
    return value.model_dump(by_alias=True, exclude_unset=True) if hasattr(value, 'model_dump') else value

def project_theme_detail(contract, results, target):
    board = contract.get('board_id') if contract else None
    if board not in {'2UBO-1', '3D4I-0', '3EWN-0'}:
        return contract
    sources = {op: dumped(result) for op, (result, args) in results.items()}
    arguments = {op: dumped(args) for op, (result, args) in results.items()}
    collections = {'base:ka90001': 'thema_grp', 'base:ka90002': 'thema_comp_stk', 'base:ka10095': 'atn_stk_infr'}
    if board == '2UBO-1':
        actual = arguments.get('base:ka90002', {}).get('thema_grp_cd')
        requested = target.get('thema_grp_cd', actual)
        requested = requested if isinstance(requested, str) and requested.strip() else None
        result = theme_contract(sources.get('base:ka90001', {}), sources.get('base:ka90002', {}), requested, actual)
        result['watch_source_context'] = {'kind': 'theme', 'requested_code': requested, 'detail_requested_code': actual, 'list_period': arguments.get('base:ka90001', {}).get('date_tp'), 'detail_period': arguments.get('base:ka90002', {}).get('date_tp')}
    else:
        actual = arguments.get('base:ka10095', {}).get('stk_cd')
        requested = target.get('stk_cd')
        valid = isinstance(requested, str) and requested == actual and ('|' not in requested)
        result = detail_contract(board, sources.get('base:ka10095', {}), requested if valid else None)
        result['watch_source_context'] = {'kind': 'detail', 'requested_code': requested if valid else None, 'source_requested_code': actual}
    entries = {entry['slot_id']: entry for entry in result['slot_values']}
    result['watch_source_context']['collection_states'] = {op: 'absent' if key not in sources.get(op, {}) else 'received' if isinstance(sources[op][key], list) and sources[op][key] else 'empty' for op, key in collections.items() if op in sources}
    registry = get_registry()
    presence = []
    slot_context = []
    for slot in registry.boards[board].binding_slots:
        entry = entries.get(slot.slot_id)
        binding = next((b for b in slot.bindings if b.occurrence_id == (entry or {}).get('occurrence_id')), slot.bindings[0])
        data = sources.get(binding.mapping_id)
        if not isinstance(data, dict):
            continue
        if board == '2UBO-1' and binding.mapping_id == 'base:ka90002' and (not requested or requested != actual):
            continue
        path = binding.json_path or ''
        if not path and '|' in (binding.occurrence_id or ''):
            path = binding.occurrence_id.split('|')[1]
        owner = data
        identity = requested
        row_state = "received"
        if '[].' in path:
            container = path.removeprefix('$.').split('[]')[0]
            rows = data.get(container, [])
            rows = rows if isinstance(rows, list) else []
            index = (entry or {}).get('row_index', slot.row_index)
            if board == '2UBO-1' and container == 'thema_grp':
                matches = [i for i, row in enumerate(rows) if isinstance(row, dict) and row.get('thema_grp_cd') == result['watch_source_context']['requested_code']]
                selected = matches[0] if len(matches) == 1 else None
                if slot.slot_id in {'s108', 's114', 's115', 's119'}:
                    index = selected
                elif slot.slot_id in {f's{i:03}' for i in range(122, 131)}:
                    others = [i for i in range(len(rows)) if i != selected][:3]
                    other = (int(slot.slot_id[1:]) - 122) // 3
                    index = others[other] if other < len(others) else None
            if board in {'3D4I-0', '3EWN-0'}:
                matches = [i for i, row in enumerate(rows) if isinstance(row, dict) and row.get('stk_cd') == result['watch_source_context']['requested_code']]
                selected = matches[0] if len(matches) == 1 else None
                index = selected
                if board == '3EWN-0' and slot.slot_id in {f's{i:03}' for i in range(115, 127)}:
                    others = [i for i in range(len(rows)) if i != selected][:3] if selected is not None else []
                    other = (int(slot.slot_id[1:]) - 115) // 4
                    index = others[other] if other < len(others) else None
            owner = rows[index] if isinstance(rows, list) and isinstance(index, int) and (index < len(rows)) else {}
        if '[].' in path:
            key = 'thema_grp_cd' if container == 'thema_grp' else 'stk_cd'
            identity = owner.get(key) if isinstance(owner, dict) else None
            row_state = 'received' if identity else 'empty' if container in data else 'absent'
        slot_context.append({'slot_id':slot.slot_id, 'mapping_id':binding.mapping_id,
                             'identity':identity, 'row_state':row_state})
        if isinstance(owner, dict) and binding.f in owner:
            value = owner[binding.f]
            presence.append({'slot_id': slot.slot_id, 'empty': value is None or (isinstance(value, str) and (not value.strip()))})
    result['watch_source_context']['presence'] = presence
    result['watch_source_context']['slots'] = slot_context
    return result

def project_watch_surface(contract, results, target):
    if not contract:
        return contract
    if contract.get('board_id') == '2UHM-1':
        return project_watch_market(contract, results)
    if contract.get('board_id') == BOARD:
        captured = results.get(MEMBERS)
        group = dumped(captured[1]).get('arn_grp_id') if captured else target.get('arn_grp_id')
        return project_watchlist(contract, {op: result for op, (result, _arguments) in results.items()}, group=group)
    return project_theme_detail(contract, results, target)


def project_watch_market(contract, results):
    if not contract or contract.get('board_id') != '2UHM-1':
        return contract
    source = dumped(results.get('base:0s', ({}, {}))[0])
    rows = source.get('data') if isinstance(source, dict) else None
    registry = get_registry()
    board = registry.boards['2UHM-1']
    # A normalized event has exactly one source row. Multiple venue events need
    # an explicit selected event, which this card's request does not provide.
    index = 0 if isinstance(rows, list) and len(rows) == 1 else len(rows or [])
    slots = tuple(replace(s, row_index=index, alt_mappings=()) for s in board.binding_slots if s.mapping_id == 'base:0s')
    scoped = replace(registry, boards={**registry.boards, board.board_id: replace(board, slots=slots)})
    projected = build_board_surface_contract(board.board_id, bind_surface_values('base:0s', source or {}), scoped)
    owned = {s.slot_id for s in slots}
    values = [e for e in contract['slot_values'] if e['slot_id'] not in owned] + projected['slot_values']
    filled = {e['slot_id'] for e in values}
    return {**contract, 'slot_values':values, 'unbound_slots':[s.slot_id for s in board.slots if s.slot_id not in filled],
            'empty_value_slots':sorted(set(contract.get('empty_value_slots', [])) - owned | set(projected['empty_value_slots'])),
            'empty_rows':_empty_rows(board, filled), 'empty_columns':_empty_columns(board, filled)}
