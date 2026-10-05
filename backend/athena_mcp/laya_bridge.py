"""Private session binding for LAYA refinement; external/backtest tools are untouched."""
from copy import deepcopy
import logging
import os

import httpx

TOOLS = frozenset({"athena_search", "athena_describe", "athena_resolve", "athena_call",
    "athena_routine", "athena_brain", "athena_graph_view", "athena_nudge_guard", "athena_plugin",
    "athena__render_canvas", "athena__save_canvas"})
TICKET_KEY = "_athena_turn_ticket"
log = logging.getLogger("athena.laya")


def turn_headers(arguments, *, env=None):
    values = os.environ if env is None else env
    ticket = arguments.get(TICKET_KEY)
    lease, generation = values.get("ATHENA_LAYA_LEASE_ID"), values.get("ATHENA_LAYA_GENERATION_ID")
    if (not isinstance(ticket, str) or not lease or not generation or len(ticket) > 128
            or not ticket.replace("-", "").replace("_", "").isalnum()):
        return {}
    return {"X-Athena-Laya-Ticket": ticket, "X-Athena-Laya-Lease": lease,
            "X-Athena-Laya-Generation": generation}


def expose_ticket(tool):
    if tool.name not in TOOLS:
        return tool
    schema = deepcopy(tool.inputSchema)
    schema.setdefault("properties", {})[TICKET_KEY] = {
        "type": "string", "description": "Copy the exact current Athena turn ticket from this turn's instructions. Never reuse an older ticket."}
    return tool.model_copy(update={"inputSchema": schema})


async def refine(tool, arguments, client, *, env=None):
    if tool not in TOOLS:
        return arguments, None
    output = dict(arguments)
    ticket = output.pop(TICKET_KEY, None)
    values = os.environ if env is None else env
    lease, generation = values.get("ATHENA_LAYA_LEASE_ID"), values.get("ATHENA_LAYA_GENERATION_ID")
    if not ticket or not lease or not generation:
        log.info("semantic_fallback tool=%s reason=missing_turn_binding", tool)
        return output, None
    # Existing order exclusion and sealed execution arguments are code-owned.
    if output.get("intent") == "order":
        return output, None
    if not isinstance(ticket, str) or not ticket.replace("-", "").replace("_", "").isalnum() or len(ticket) > 128:
        log.info("semantic_fallback tool=%s reason=invalid_ticket", tool)
        return output, None
    try:
        response = await client.post(f"/api/v1/laya/turns/{ticket}/refine",
            json={"tool_name": tool, "arguments": output},
            headers={"X-Athena-Laya-Lease": lease, "X-Athena-Laya-Generation": generation}, timeout=8)
        response.raise_for_status()
        result = response.json()
        if result.get("blocked") is True:
            return output, "현재 요청의 도구 선택과 다르다. 먼저 " + str(result.get("expected_tool")) + " 경로를 사용하라."
        if result.get("blocked") is not False or not isinstance(result.get("arguments"), dict):
            raise ValueError("invalid_response")
        log.info("semantic_refinement tool=%s accepted=%s", tool,
                 sum(row.get("accepted") is True for row in result.get("decisions", [])))
        return result["arguments"], None
    except (httpx.HTTPError, ValueError, TypeError):
        log.info("semantic_fallback tool=%s reason=unavailable_or_expired", tool)
        return output, None
