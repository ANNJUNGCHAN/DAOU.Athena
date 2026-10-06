"""Deterministic screen selection for one record-specific decision head."""
from copy import deepcopy
import json


class ContextSelectionUnresolved(ValueError):
    pass


def decision_context(task_id, context):
    result = deepcopy(context)
    if task_id != "routine.control" or not isinstance(result, dict):
        return result
    agent = result.get("agentContext")
    if not isinstance(agent, dict) or not agent.get("selectedRoutineId"):
        return result
    selected = agent["selectedRoutineId"]
    routines = agent.get("routines")
    if (not isinstance(selected, str) or not isinstance(routines, dict)
            or routines.get("status") != "success" or not isinstance(routines.get("items"), list)):
        raise ContextSelectionUnresolved()
    rows = routines["items"]
    screen_fields = {"id", "title", "status", "symbol", "mode", "nextFireAt"}
    if any(not isinstance(row, dict) or not isinstance(row.get("id"), str)
           or set(row) - screen_fields for row in rows):
        raise ContextSelectionUnresolved()
    matches = [row for row in rows if row["id"] == selected]
    if len(matches) != 1:
        raise ContextSelectionUnresolved()
    # Selection alone does not prove a selected-only request. Keep every visible
    # candidate's identity/status so aggregate and other-record references remain
    # visible; never treat this projection as a complete snapshot of each row.
    overview_fields = ("id", "title", "status", "symbol", "mode")
    routines["candidate_overview"] = [{key: row[key] for key in overview_fields if key in row} for row in rows]
    routines["items"] = matches
    routines["context_projection"] = {
        "selected_id": selected, "full_row_ids": [selected],
        "overview_fields": list(overview_fields), "visible_candidate_count": len(rows),
    }
    size = lambda value: len(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
    return result if size(result) < size(context) else deepcopy(context)
