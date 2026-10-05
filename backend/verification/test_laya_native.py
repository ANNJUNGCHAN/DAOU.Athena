import asyncio
from collections import Counter
from copy import deepcopy
import unittest

import httpx
import jsonschema

from athena_api.laya.native import plan_native, refine_native
from athena_api.laya.service import SemanticService
from athena_mcp.laya_bridge import expose_ticket, refine, turn_headers
from athena_mcp import graph_view_tools, routine_tools, nudge_guard_tools, brain_tools


class Predictor:
    def __init__(self, choices):
        self.choices, self.requests, self.counts = choices, [], Counter()
        self.deployment_sha256 = "fixture"

    async def decide(self, requests):
        self.requests.extend(deepcopy(requests))
        result = []
        for request in requests:
            label = self.choices.get(request["task_id"], "defer")
            result.append({"task_id": request["task_id"], "label": label, "accepted": label != "defer",
                           "reason": "accepted" if label != "defer" else "defer",
                           "confidence": 0.99, "threshold": 0.9})
        return result


def setup(choices, *, origin="shell", protected=None):
    client = Predictor(choices)
    service = SemanticService(client)
    ticket = service.register(lease_id="x" * 32, generation_id="generation", conversation_id="one",
        turn_id="turn", utterance="user original", context={"canvasMode": "graph"},
        origin=origin, protected_fields=protected)
    return service, ticket, client


class NativeTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_graph_dispatch_uses_accepted_values_once_and_plan_is_not_execution(self):
        service, ticket, client = setup({"general.builtin_tool": "athena_graph_view", "graph.action": "navigate",
                                        "graph.surface": "map"})
        plan = await plan_native(service, ticket)
        self.assertTrue(plan["complete"])
        self.assertNotIn("result", plan)
        calls = []
        async def dispatch(tool, args):
            calls.append((tool, args))
            return (await graph_view_tools.dispatch(args)).model_dump(mode="json")
        first, second = await asyncio.gather(service.direct_dispatch(ticket, dispatch), service.direct_dispatch(ticket, dispatch))
        self.assertEqual(first, second)
        self.assertTrue(first["applied"])
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1], {"action": "navigate", "surface": "map"})
        self.assertEqual(len(client.requests), 3)
        self.assertTrue(all(row["utterance"] == "user original" for row in client.requests))

    async def test_partial_filter_never_short_circuits_remaining_user_requirements(self):
        service, ticket, client = setup({"general.builtin_tool": "athena_graph_view", "graph.action": "filter",
                                        "graph.window_days": "90"})
        plan = await plan_native(service, ticket)
        self.assertFalse(plan["complete"])
        async def forbidden(*args):
            self.fail("Partial filter cannot bypass provider supplementation")
        self.assertFalse((await service.direct_dispatch(ticket, forbidden))["applied"])
        refined = await refine_native(service, ticket, "athena_graph_view",
            {"action": "filter", "window_days": 30, "min_degree": 3, "summary_sort": "recent"})
        self.assertEqual(refined["arguments"], {"action": "filter", "window_days": 90, "min_degree": 3, "summary_sort": "recent"})
        self.assertFalse((await graph_view_tools.dispatch(refined["arguments"])).isError)
        self.assertEqual({row["task_id"] for row in client.requests}, {
            "general.builtin_tool", "graph.action", "graph.window_days", "graph.min_degree", "graph.summary_sort"})

    async def test_handler_exception_never_reexecutes(self):
        service, ticket, _ = setup({"general.builtin_tool": "athena_graph_view", "graph.action": "fit"})
        count = 0
        async def fail(tool, args):
            nonlocal count
            count += 1
            raise ValueError("private")
        first = await service.direct_dispatch(ticket, fail)
        self.assertFalse(first["applied"])
        self.assertTrue(first["result"]["isError"])
        await service.direct_dispatch(ticket, fail)
        self.assertEqual(count, 1)

    async def test_cancelled_dispatch_keeps_unknown_outcome_without_duplicate_execution(self):
        service, ticket, _ = setup({"general.builtin_tool": "athena_graph_view", "graph.action": "fit"})
        entered = asyncio.Event()
        calls = []
        async def dispatch(*args):
            calls.append(args)
            entered.set()
            await asyncio.Future()
        running = asyncio.create_task(service.direct_dispatch(ticket, dispatch))
        await entered.wait()
        running.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await running
        result = await service.direct_dispatch(ticket, dispatch)
        self.assertEqual(result["reason"], "dispatch_outcome_unknown")
        self.assertFalse(result["applied"])
        self.assertEqual(len(calls), 1)

    async def test_explicit_human_field_is_authoritative(self):
        service, ticket, client = setup({"graph.action": "navigate", "graph.surface": "map"},
                                       protected={"athena_graph_view.surface": "summary"})
        result = await refine_native(service, ticket, "athena_graph_view", {"action": "navigate", "surface": "settings"})
        self.assertEqual(result["arguments"]["surface"], "summary")
        self.assertNotIn("graph.surface", [row["task_id"] for row in client.requests])

    async def test_rejected_heads_preserve_llm_arguments(self):
        service, ticket, _ = setup({})
        original = {"action": "navigate", "surface": "map"}
        result = await refine_native(service, ticket, "athena_graph_view", original)
        self.assertEqual(result["arguments"], original)
        self.assertFalse(any(row["accepted"] for row in result["decisions"]))

    async def test_routine_numeric_only_and_proposal_control(self):
        service, ticket, client = setup({"routine.action": "draft", "routine.source": "schedule.once", "routine.goal": "false"})
        original = {"action": "draft", "draft": {"symbol": "005930", "condition": {"source": "schedule.daily", "op": "at", "value": "time"}}}
        result = await refine_native(service, ticket, "athena_routine", original)
        self.assertEqual(result["arguments"]["draft"]["condition"]["source"], "schedule.once")
        self.assertEqual(result["arguments"]["draft"]["condition"]["op"], "at")
        self.assertNotIn("routine.operator", [row["task_id"] for row in client.requests])
        self.assertIs(result["arguments"]["draft"]["goal"], False)

    async def test_plugin_single_action_refines_but_multiple_targets_are_not_overwritten(self):
        service, ticket, client = setup({"plugin.action": "set_enabled", "plugin.enabled": "false"})
        result = await refine_native(service, ticket, "athena_plugin", {"actions": [{"action": "remove", "target": "notes"}]})
        self.assertEqual(result["arguments"]["actions"], [{"action": "set_enabled", "target": "notes", "enabled": False}])
        original = {"actions": [{"action": "remove", "target": "one"}, {"action": "install", "target": "two"}]}
        before = len(client.requests)
        self.assertEqual((await refine_native(service, ticket, "athena_plugin", original))["arguments"], original)
        self.assertEqual(len(client.requests), before)

    async def test_sealed_canvas_and_backtest_remain_code_owned(self):
        service, ticket, client = setup({"canvas.type": "free", "canvas.layout": "full"})
        original = {"plan_token": "sealed", "canvas_type": "chart", "layout": "half"}
        self.assertEqual((await refine_native(service, ticket, "athena__render_canvas", original))["arguments"], original)
        self.assertEqual(client.requests, [])
        service, ticket, client = setup({"graph.action": "fit"}, origin="backtest")
        self.assertEqual((await refine_native(service, ticket, "athena_graph_view", {"action": "navigate"}))["arguments"], {"action": "navigate"})
        self.assertEqual(client.requests, [])

    async def test_briefing_uses_distinct_head_and_freeform_content_is_incomplete(self):
        service, ticket, client = setup({"briefing.builtin_tool": "athena__render_canvas", "canvas.type": "table", "canvas.layout": "full"}, origin="briefing")
        plan = await plan_native(service, ticket)
        self.assertFalse(plan["complete"])
        self.assertEqual(plan["arguments"], {"canvas_type": "table", "layout": "full"})
        self.assertEqual(client.requests[0]["task_id"], "briefing.builtin_tool")

    async def test_remaining_native_heads_reach_existing_handlers_and_proposal_guards(self):
        calls = []
        def response(request):
            calls.append(request)
            return httpx.Response(200, json={"routines": [], "show_rationale": True,
                                            "learn_from_dismissals": False})
        cases = [
            ("athena_graph_view", {"graph.action": "propose_edit", "graph.edit_op": "remove"},
             {"action": "fit", "edit": {"op": "change", "object": "반도체", "relation": "interested_in"}}, graph_view_tools),
            ("athena_routine", {"routine.action": "propose", "routine.control": "pause"},
             {"action": "list", "propose": {"control": "resume", "routine_id": "fixture"}}, routine_tools),
            ("athena_routine", {"routine.action": "draft", "routine.source": "price.current", "routine.goal": "true", "routine.operator": ">="},
             {"action": "draft", "draft": {"symbol": "005930", "condition": {"source": "price.current", "op": "<", "value": 90000},
              "main_card_candidate": {"operation_ref": "base:ka10003", "args": {"stk_cd": "005930"}, "title": "체결"}}}, routine_tools),
            ("athena_nudge_guard", {"nudge.action": "propose", "nudge.show_rationale": "false", "nudge.learn_from_dismissals": "true"},
             {"action": "get", "propose": {}}, nudge_guard_tools),
            ("athena_brain", {"brain.action": "entity"}, {"action": "profile", "entity": "반도체"}, brain_tools),
        ]
        observed = set()
        async with httpx.AsyncClient(base_url="http://127.0.0.1", transport=httpx.MockTransport(response)) as http:
            for tool, choices, arguments, module in cases:
                service, ticket, client = setup(choices)
                result = await refine_native(service, ticket, tool, arguments)
                jsonschema.validate(result["arguments"], module.builtin_tool_defs()[0].inputSchema)
                envelope = await module.dispatch(result["arguments"]) if module is graph_view_tools else await module.dispatch(result["arguments"], http)
                self.assertFalse(envelope.isError, envelope)
                observed.update(row["task_id"] for row in client.requests)
        self.assertTrue({"graph.edit_op", "routine.control", "routine.operator", "routine.source", "routine.goal",
                         "nudge.action", "nudge.show_rationale", "nudge.learn_from_dismissals", "brain.action"} <= observed)
        self.assertFalse(any(request.method != "GET" and request.url.path != "/api/v1/routines/draft" for request in calls))

    async def test_query_native_heads_use_original_turn_and_preserve_human_intent(self):
        choices = {"query.intent": "websocket", "query.response_mode": "full"}
        service, ticket, client = setup(choices, protected={"athena_resolve.intent": "query"})
        result = await refine_native(service, ticket, "athena_resolve", {"question": "원래 질문", "intent": "auto"})
        from athena_api.selector.schemas import ResolveRequest
        validated = ResolveRequest.model_validate(result["arguments"])
        self.assertEqual(validated.intent.value, "query")
        self.assertEqual(validated.response_mode.value, "full")
        self.assertNotIn("query.intent", [row["task_id"] for row in client.requests])
        service, ticket, client = setup(choices)
        result = await refine_native(service, ticket, "athena_search", {"query": "실시간 조건검색", "intent": "auto"})
        self.assertEqual(result["arguments"]["intent"], "websocket")
        self.assertEqual(client.requests[0]["utterance"], "user original")


class BridgeTests(unittest.IsolatedAsyncioTestCase):
    async def test_private_binding_headers_and_ticket_stripped_before_original_validator(self):
        requests = []
        def handler(request):
            requests.append(request)
            return httpx.Response(200, json={"blocked": False, "arguments": {"action": "fit"}, "decisions": []})
        original = {"action": "navigate", "_athena_turn_ticket": "ticket_123"}
        env = {"ATHENA_LAYA_LEASE_ID": "private", "ATHENA_LAYA_GENERATION_ID": "generation"}
        async with httpx.AsyncClient(base_url="http://127.0.0.1", transport=httpx.MockTransport(handler)) as client:
            args, blocked = await refine("athena_graph_view", original, client, env=env)
        self.assertEqual(args, {"action": "fit"})
        self.assertIsNone(blocked)
        self.assertEqual(requests[0].headers["X-Athena-Laya-Lease"], "private")
        self.assertNotIn("_athena_turn_ticket", requests[0].content.decode())
        self.assertEqual(turn_headers(original, env=env)["X-Athena-Laya-Ticket"], "ticket_123")

    async def test_external_tool_and_missing_ticket_do_not_call_runtime(self):
        def handler(request):
            self.fail("Unexpected runtime call")
        async with httpx.AsyncClient(base_url="http://127.0.0.1", transport=httpx.MockTransport(handler)) as client:
            original = {"action": "fit"}
            self.assertEqual(await refine("athena_graph_view", original, client, env={}), (original, None))
            self.assertEqual(await refine("external__tool", original, client, env={}), (original, None))
        tool = graph_view_tools.builtin_tool_defs()[0]
        exposed = expose_ticket(tool)
        self.assertIn("_athena_turn_ticket", exposed.inputSchema["properties"])
        self.assertNotIn("_athena_turn_ticket", tool.inputSchema["properties"])


if __name__ == "__main__":
    unittest.main()
