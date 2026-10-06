"""Use collection rows on ELW details only when they identify the requested ELW."""

from collections.abc import Mapping
from typing import Any

_DETAIL_BOARDS = frozenset({'15P5-2', '3DZ1-0'})
_COLLECTIONS = {
    'base:ka30001': 'elwpric_jmpflu',
    'base:ka30002': 'trde_ori_elwnettrde_upper',
    'base:ka30004': 'elwdispty_rt',
    'base:ka30005': 'elwcnd_qry',
    'base:ka30009': 'elwflu_rt_rank',
    'base:ka30010': 'elwreq_rank',
    'base:ka30011': 'elwalacc_rt',
}


def _code(value: Any) -> str:
    text = str(value or '').strip().upper()
    if len(text) == 7 and text.startswith('A'):
        text = text[1:]
    return text if len(text) == 6 and text.isalnum() else ''


def elw_detail_source(board_id: str, operation_ref: str, source: dict[str, Any],
                      target: Mapping[str, Any]) -> dict[str, Any]:
    key = _COLLECTIONS.get(operation_ref)
    if board_id not in _DETAIL_BOARDS or not key or not isinstance(source.get(key), list):
        return source
    symbol = _code(target.get('stk_cd'))
    rows = [row for row in source[key]
            if symbol and isinstance(row, dict) and _code(row.get('stk_cd')) == symbol]
    return {**source, key: rows}
