"""Display provenance for two FLOW boards; no fetches or numeric projections."""
import re
from collections.abc import Mapping

SOURCES = {
    "2QFO-2": {"base:ka10059", "base:ka10061"},
    "2ROJ-1": {"base:ka10059", "base:ka10061", "base:ka10037", "base:ka90005",
               "base:ka90006", "base:ka90007", "base:ka90008", "base:ka90010", "base:ka90013"},
}
PUBLIC_ARGS = ("stk_cd", "dt", "date", "strt_dt", "end_dt", "trde_tp", "amt_qty_tp",
               "unit_tp", "mrkt_tp", "min_tic_tp", "stex_tp")


def _code(value):
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value[:6] if re.fullmatch(r"\d{6}(?:_(?:AL|NX))?", value) and value[:6] != "000000" else None


def _plain(value):
    return value.model_dump(by_alias=True, exclude_none=True) if hasattr(value, "model_dump") else value


def annotate_flow_display_context(contract, sources, target, identity_index=None):
    if not contract or contract.get("board_id") not in SOURCES:
        return contract
    board = contract["board_id"]
    code = _code(target.get("stk_cd"))
    context = {"board_id": board, "stk_cd": code, "identity": None, "queries": []}
    if code:
        # This index contains received ka10099 records. resolve is a local read,
        # not another quote request and not a name inferred from the prompt.
        identity = identity_index.resolve(code) if identity_index is not None else None
        if identity is not None and _code(identity.code) == code and isinstance(identity.name, str) and identity.name.strip():
            context["identity"] = {"code": code, "name": identity.name.strip(), "source": "base:ka10099"}
        for operation, (_result, arguments) in sources.items():
            if operation not in SOURCES[board]:
                continue
            args = _plain(arguments)
            if not isinstance(args, Mapping) or ("stk_cd" in args and _code(args["stk_cd"]) != code):
                continue
            context["queries"].append({"operation_ref": operation, "operation_args": {
                key: args[key] for key in PUBLIC_ARGS if isinstance(args.get(key), str)
            }})
    return {**contract, "flow_display_context": context}
