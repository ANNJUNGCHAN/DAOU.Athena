"""Reuse a completed VI query in the authored market overview; no new request."""

from collections.abc import Mapping

from athena_api.card_surface_contract import bind_surface_values, build_board_surface_contract


def vi_snapshot_surface(operation_ref: str, source: object):
    if operation_ref != "base:ka10054" or not isinstance(source, Mapping):
        return None
    if not isinstance(source.get("motn_stk"), list):
        return None
    contract = build_board_surface_contract(
        "15R0-2", bound_values=bind_surface_values(operation_ref, source),
        active_operation_refs=[operation_ref],
    )
    # Its missing index/stream fields are not supplied by this completed read.
    # Never silently request an unrelated market or register another stream.
    contract["hydration_slot_ids"] = []
    return contract
