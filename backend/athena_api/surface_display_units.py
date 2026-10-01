"""Label conditional monetary/quantity values using the actual query arguments."""

import re
from collections.abc import Mapping
from decimal import Decimal, InvalidOperation
from typing import Any

from athena_api.semantic_presentation_registry import get_semantic_presentation_registry

# ka10060's response descriptions say 백만원, while its request explicitly
# selects amount/quantity and the quantity unit. Only investor fields vary;
# acc_trde_prica remains a fixed monetary observation.
_KA10060_INVESTORS = frozenset({
    'ind_invsr', 'frgnr_invsr', 'orgn', 'fnnc_invt', 'insrnc', 'invtrt',
    'etc_fnnc', 'bank', 'penfnd_etc', 'samo_fund', 'natn', 'etc_corp', 'natfor',
})


def _unit(operation: str, arguments: Mapping[str, Any]) -> str:
    tr_id = operation.split(':')[1]
    mode = str(arguments.get('amt_qty_tp', ''))
    if tr_id == 'ka10051':
        return {'0': '억원', '1': '천주'}.get(mode, '')
    if tr_id in {'ka10059', 'ka10060', 'ka10061'}:
        if mode == '1':
            return '백만원'
        if mode == '2':
            return {'1': '주', '1000': '천주'}.get(str(arguments.get('unit_tp', '')), '')
    if tr_id in {'ka10064', 'ka10065', 'ka10066'}:
        return {'1': '백만원', '2': '주'}.get(mode, '')
    if tr_id == 'ka90007':
        return {'1': '백만원', '2': '천주'}.get(mode, '')
    if tr_id == 'ka10086':
        return {'0': '주', '1': '백만원'}.get(str(arguments.get('indc_tp', '')), '')
    if tr_id == 'ka10013':
        return {'1': '백만원', '2': '백만주'}.get(str(arguments.get('qry_tp', '')), '')
    return ''


def _display(value: Any, unit: str, signed_tone: bool) -> Any:
    raw = value.get('value') if isinstance(value, Mapping) else value
    if raw is None or isinstance(raw, (dict, list, bool)):
        return value
    literal = str(raw).strip().replace(',', '')
    match = re.fullmatch(r'([+-]*)(\d+(?:\.\d+)?)', literal)
    if not match:
        return value
    try:
        number = Decimal(('-' if '-' in match[1] else '') + match[2])
    except InvalidOperation:
        return value
    rendered = format(number, ',f')
    if '.' in rendered:
        rendered = rendered.rstrip('0').rstrip('.')
    if number > 0 and '+' in match[1]:
        rendered = '+' + rendered
    text = rendered + (unit if unit else ' (단위 미확인)')
    result = {'value': raw, 'text': text, 'display_unit': unit or 'unknown'}
    if signed_tone:
        result['tone'] = 'up' if number > 0 else 'down' if number < 0 else 'flat'
    return result


def annotate_surface_display_units(surface: dict[str, Any],
                                   arguments_by_operation: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
    """Keep raw values/observations intact; only wrap affected surface displays.

    Dual-unit fields require actual query arguments. A fixed monetary source is
    wrapped only when its explicit unit differs from the canonical scale, as can
    happen for an alternative. Names alone never determine the unit.
    """
    registry = get_semantic_presentation_registry()
    metadata = {
        field.wire_occurrence_id: field
        for operation in arguments_by_operation
        for field in registry.for_operation(operation)
        if '단위' in (field.description or '') and '원' in (field.description or '')
    }
    values = []
    for entry in surface.get('slot_values') or []:
        field = metadata.get(entry.get('occurrence_id'))
        if field is None:
            values.append(entry)
            continue
        operation = field.wire_occurrence_id.split('|', 1)[0]
        arguments = arguments_by_operation.get(operation, {})
        description = field.description or ''
        investor_chart = operation == 'base:ka10060' and field.json_path.rsplit('.', 1)[-1] in _KA10060_INVESTORS
        if operation.split(':')[1] == 'ka10001' and field.json_path == '$.flo_stk':
            # The public contract labels this share count as currency. Preserve
            # the raw count until the source's contradictory unit is resolved.
            unit = ''
        elif '주' in description or investor_chart:
            unit = _unit(operation, arguments)
        else:
            fixed = re.search(r'단위:\s*(천원|백만원|억원|원)', description)
            scale = entry.get('format', {}).get('scale')
            format_spec = entry.get('format', {})
            expected = {'천': '천원', '백만': '백만원', '억': '억원'}.get(scale)
            if scale is None and (format_spec.get('kind') == 'korean'
                                  or format_spec.get('unit') == 'krw_ko'):
                expected = '원'
            # Canonical formatting handles its own fixed scale. This branch is
            # only for an actual alternative with a different explicit unit.
            if fixed is None or expected is None or fixed[1] == expected or '%' in description:
                values.append(entry)
                continue
            unit = fixed[1]
        wrapped = _display(entry.get('value'), unit,
                           entry.get('format', {}).get('tone') in {'signed', 'change'})
        values.append({**entry, 'value': wrapped})
    return {**surface, 'slot_values': values}
