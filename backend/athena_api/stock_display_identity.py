"""Project collection supplements onto the requested stock on single-stock cards."""

import re
from collections.abc import Mapping
from typing import Any


# These surfaces describe one requested stock. Ranking/comparison/sector/ETF
# lists deliberately remain outside the projection.
_DETAIL_BOARDS = frozenset({
    '137X-2', '2R3M-1', '2RBO-1', '3DI2-0', '3FR6-0',
    '2QFO-2', '2QM7-2', '2ROJ-1', '2RWK-1', '2S4E-1',
})


def _stock_code(value: Any) -> str:
    text = str(value or '').strip().upper()
    # The websocket transport and public REST descriptions use these exchange
    # suffixes for the same six-digit stock, not a second security identity.
    if text.endswith(('_AL', '_NX')):
        text = text[:-3]
    if len(text) == 7 and text.startswith('A'):
        text = text[1:]
    return text if re.fullmatch(r'\d{6}', text) else ''


def stock_detail_source(board_id: str, source: dict[str, Any],
                        target: Mapping[str, Any]) -> dict[str, Any]:
    if board_id not in _DETAIL_BOARDS:
        return source
    symbol = _stock_code(target.get('stk_cd'))

    def project(value: Any) -> Any:
        if isinstance(value, list):
            if any(isinstance(row, dict) and 'stk_cd' in row for row in value):
                return [project(row) for row in value
                        if symbol and isinstance(row, dict)
                        and _stock_code(row.get('stk_cd')) == symbol]
            return [project(row) for row in value]
        if isinstance(value, dict):
            if value.get('stk_cd') and _stock_code(value['stk_cd']) != symbol:
                return {}
            return {key: project(item) for key, item in value.items()}
        return value

    return project(source)
