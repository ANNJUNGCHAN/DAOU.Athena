"""Bounded public ranking rows for the expanded result view; no cached raw page."""
from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, ValidationError

from athena_api.generated.registry import TR_REGISTRY
from athena_api.semantic_presentation_registry import get_semantic_presentation_registry

EXPANDED_BOARD = "4B22-1"
LIMIT = 100
RANKING_BOARD_OPERATIONS = {
    "13K0-2": "base:ka10032", "2X5N-0": "base:ka10030",
    "2XG6-0": "base:ka10031", "2XKO-0": "base:ka10027",
    "2XP6-0": "base:ka10029", "2XTO-0": "base:ka10020",
    "2YA8-0": "base:ka10021", "2YEQ-0": "base:ka10022",
    "2YJ8-0": "base:ka10023", "2YNQ-0": "base:ka10098",
}
_COMMON = ("stk_nm", "stk_cd", "cur_prc", "pred_pre", "flu_rt")
_FIELDS = {
    "base:ka10030": (*_COMMON, "trde_qty", "trde_amt", "pred_rt", "trde_tern_rt"),
    "base:ka10031": (*_COMMON, "trde_qty"),
    "base:ka10032": (*_COMMON, "now_trde_qty", "trde_prica"),
    "base:ka10027": (*_COMMON, "now_trde_qty", "sel_req", "buy_req", "cntr_str"),
    "base:ka10029": ("stk_nm", "stk_cd", "exp_cntr_pric", "pred_pre", "flu_rt", "exp_cntr_qty", "sel_req", "buy_req"),
    "base:ka10020": (*_COMMON, "trde_qty", "tot_sel_req", "tot_buy_req", "netprps_req", "buy_rt"),
    "base:ka10021": (*_COMMON, "int", "now", "sdnin_qty", "sdnin_rt", "tot_buy_qty"),
    "base:ka10022": (*_COMMON, "int", "now_rt", "sdnin_rt", "tot_sel_req", "tot_buy_req"),
    "base:ka10023": (*_COMMON, "prev_trde_qty", "now_trde_qty", "sdnin_qty", "sdnin_rt"),
    "base:ka10098": (*_COMMON, "acc_trde_qty", "acc_trde_prica", "sel_tot_req", "buy_tot_req"),
    "base:ka00198": ("stk_nm", "stk_cd", "bigd_rank", "rank_chg", "past_curr_prc", "base_comp_chgr", "dt", "tm"),
}


def is_expanded_ranking_operation(operation_ref: str | None) -> bool:
    return operation_ref in _FIELDS


def _column(field: str, label: str, description: str) -> dict[str, Any]:
    result: dict[str, Any] = {"key": field, "label": label, "format": {"unit": "text"}}
    if field == "stk_cd":
        result["format"] = {"unit": "text", "literal": True}
        result["role"] = "identifier"
    elif field in {"cur_prc", "exp_cntr_pric", "past_curr_prc"}:
        result["format"] = {"kind": "number", "absolute": True}
        result["role"] = "price"
    elif field == "dt":
        result["format"] = {"kind": "date"}
    elif field == "tm":
        result["format"] = {"kind": "time"}
    elif "단위: %" in description:
        result["format"] = {"kind": "percent", "precision": 2, "sign": field in {"flu_rt", "base_comp_chgr"}}
    elif "단위: 백만원" in description:
        result["format"] = {"kind": "number", "suffix": "백만원"}
    elif "단위: 1주" in description:
        result["format"] = {"kind": "number", "suffix": "주"}
    elif "단위: 원" in description:
        result["format"] = {"kind": "number", "suffix": "원", "sign": field == "pred_pre"}
    return result


def build_ranking_result(
    board_id: str, operation_ref: str, source: Any, arguments: Mapping[str, Any] | BaseModel,
) -> dict[str, Any] | None:
    if board_id not in {*RANKING_BOARD_OPERATIONS, EXPANDED_BOARD} or operation_ref not in _FIELDS:
        return None
    if not isinstance(source, Mapping):
        return None
    spec = TR_REGISTRY[operation_ref.split(":", 1)[1]]
    raw_arguments = arguments.model_dump(by_alias=True) if isinstance(arguments, BaseModel) else arguments
    try:
        validated = spec.request_model.model_validate(raw_arguments)
    except ValidationError:
        return None
    contracts = {item.alias: item for item in get_semantic_presentation_registry().for_operation(operation_ref)
                 if item.user_visible and "[]." in item.json_path}
    identity = contracts.get("stk_nm")
    if identity is None:
        return None
    # The allowlisted ranking responses all have one top-level typed array.
    container = identity.json_path.removeprefix("$.").split("[]", 1)[0]
    rows = source.get(container)
    if not isinstance(rows, list):
        return None
    fields = [field for field in _FIELDS[operation_ref] if field in contracts]
    columns = [{"key": "_position", "label": "번호", "format": {"kind": "number"}}]
    columns.extend(_column(field, contracts[field].label_ko or field, contracts[field].description or "") for field in fields)
    projected = []
    for position, row in enumerate(rows[:LIMIT], 1):
        if not isinstance(row, Mapping):
            continue
        values: dict[str, Any] = {"_position": position}
        for field in fields:
            value = row.get(field)
            if isinstance(value, bool) or isinstance(value, (dict, list, tuple, set)):
                value = None
            elif isinstance(value, float) and not math.isfinite(value):
                value = None
            elif value is not None and not isinstance(value, (str, int, float)):
                value = None
            values[field] = value
        projected.append(values)
    return {
        "board_id": EXPANDED_BOARD,
        "source_board_id": board_id,
        "operation_ref": operation_ref,
        "operation_args": validated.model_dump(mode="json", by_alias=True, exclude_none=True),
        "received_count": len(rows),
        "displayed_count": len(projected),
        "limit": LIMIT,
        "truncated": len(rows) > LIMIT,
        "columns": columns,
        "rows": projected,
    }
