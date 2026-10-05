"""Apply accepted finite choices to native tool arguments, before existing validators."""
from copy import deepcopy

SUPPORTED_TOOLS = frozenset({
    "athena_search", "athena_describe", "athena_resolve", "athena_call",
    "athena_routine", "athena_brain", "athena_graph_view", "athena_nudge_guard",
    "athena_plugin", "athena__render_canvas", "athena__save_canvas",
})
ACTION_HEADS = {
    "athena_graph_view": "graph.action", "athena_routine": "routine.action",
    "athena_brain": "brain.action", "athena_nudge_guard": "nudge.action",
    "athena_plugin": "plugin.action",
}


def get_path(value, path):
    for key in path.split("."):
        if isinstance(value, list) and key.isdecimal() and int(key) < len(value):
            value = value[int(key)]
        elif isinstance(value, dict):
            value = value.get(key)
        else:
            return None
    return value


def set_path(value, path, replacement):
    keys = path.split(".")
    for key in keys[:-1]:
        if isinstance(value, list):
            value = value[int(key)]
        else:
            child = value.get(key)
            if not isinstance(child, (dict, list)):
                value[key] = {}
            value = value[key]
    value[keys[-1]] = replacement


def native_fields(tool, arguments):
    action = arguments.get("action")
    if tool == "athena_graph_view":
        return ({"graph.surface": "surface"} if action == "navigate" else
                {"graph.window_days": "window_days", "graph.min_degree": "min_degree",
                 "graph.summary_sort": "summary_sort"} if action == "filter" else
                {"graph.edit_op": "edit.op"} if action == "propose_edit" else {})
    if tool == "athena_routine":
        if action == "propose":
            return {"routine.control": "propose.control"}
        if action == "draft":
            return {"routine.source": "draft.condition.source", "routine.goal": "draft.goal"}
    if tool == "athena_nudge_guard" and action == "propose":
        return {"nudge.show_rationale": "propose.show_rationale",
                "nudge.learn_from_dismissals": "propose.learn_from_dismissals"}
    if tool == "athena_plugin" and len(arguments.get("actions", [])) == 1:
        if get_path(arguments, "actions.0.action") == "set_enabled":
            return {"plugin.enabled": "actions.0.enabled"}
    if tool in {"athena_search", "athena_describe", "athena_resolve"}:
        return {"query.intent": "intent", **({"query.response_mode": "response_mode"}
                                            if tool == "athena_resolve" else {})}
    if tool == "athena__render_canvas" and not arguments.get("plan_token"):
        return {"canvas.type": "canvas_type", "canvas.layout": "layout"}
    return {}


def convert(label):
    if label in {"true", "false"}:
        return label == "true"
    return int(label) if label.isdecimal() else label


async def refine_native(service, ticket, tool, arguments):
    turn = service.context(ticket)
    output, decisions = deepcopy(arguments), []
    if tool not in SUPPORTED_TOOLS or turn["origin"] == "backtest":
        return {"tool_name": tool, "arguments": output, "decisions": decisions}
    protected = turn["protected_fields"]
    for field, value in protected.items():
        if field.startswith(tool + "."):
            set_path(output, field[len(tool) + 1:], deepcopy(value))

    async def apply(fields):
        available = {task: field for task, field in fields.items() if tool + "." + field not in protected}
        if not available:
            return
        results = await service.decide(ticket, [{"task_id": task} for task in available])
        decisions.extend(results)
        for result in results:
            if result["accepted"]:
                set_path(output, available[result["task_id"]], convert(result["label"]))

    action_head = ACTION_HEADS.get(tool)
    if tool == "athena_plugin":
        # One intent cannot overwrite a list of independently targeted proposals.
        if not isinstance(output.get("actions"), list) or len(output["actions"]) != 1:
            return {"tool_name": tool, "arguments": output, "decisions": decisions}
        await apply({action_head: "actions.0.action"})
    elif action_head:
        await apply({action_head: "action"})
    await apply(native_fields(tool, output))
    if tool == "athena_routine" and get_path(output, "draft.condition.source") in {
        "price.current", "price.change_rate", "trade.strength", "volume.prev_day_ratio",
    } and output.get("action") == "draft":
        await apply({"routine.operator": "draft.condition.op"})
    service.context(ticket)  # A superseded request cannot publish refined arguments.
    return {"tool_name": tool, "arguments": output, "decisions": decisions}


async def plan_native(service, ticket):
    turn = service.context(ticket)
    if turn.get("plan") is not None:
        return turn["plan"]
    head = "briefing.builtin_tool" if turn["origin"] == "briefing" else "general.builtin_tool"
    choices = await service.decide(ticket, [{"task_id": head}])
    tool = choices[0].get("label") if choices[0]["accepted"] else None
    if tool not in SUPPORTED_TOOLS:
        result = {"tool_name": tool, "arguments": {}, "complete": False, "decisions": choices}
    else:
        refined = await refine_native(service, ticket, tool, {})
        args = refined["arguments"]
        action = args.get("action")
        complete = ((tool == "athena_graph_view" and (action == "fit"
                     or action == "navigate" and args.get("surface") is not None))
                    or tool == "athena_routine" and action == "list"
                    or tool == "athena_nudge_guard" and action == "get")
        # Filter heads cannot prove that every requested field was accepted. Keep
        # the existing provider path to complete all requested filters.
        # Brain read limits/revisions and entity references, proposal details, query
        # arguments and rendered content still require the existing structured LLM.
        result = {**refined, "complete": bool(complete), "decisions": choices + refined["decisions"]}
    service.context(ticket)
    service.turns[ticket]["plan"] = deepcopy(result)
    return result
