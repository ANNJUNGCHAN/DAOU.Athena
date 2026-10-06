from copy import deepcopy
import unittest

from athena_api.laya.service import SemanticService


class Client:
    def __init__(self):
        self.requests = []

    async def decide(self, requests):
        self.requests.extend(deepcopy(requests))
        return [{"task_id": row["task_id"], "accepted": False, "reason": "defer"} for row in requests]


class ContextTests(unittest.IsolatedAsyncioTestCase):
    def setup_turn(self, context, origin="shell"):
        client = Client()
        service = SemanticService(client)
        ticket = service.register(lease_id="fixture-lease", generation_id="fixture-generation",
            conversation_id="fixture-conversation", turn_id="fixture-turn", utterance="선택한 작업을 잠시 멈춰줘",
            context=context, origin=origin, protected_fields={"athena_routine.propose.routine_id": "selected"})
        return service, client, ticket

    def context(self):
        return {"canvasMode": "agent", "explicit_constraints": {"account": "fixture"}, "agentContext": {
            "selectedRoutineId": "selected", "routines": {"status": "success", "total": 30, "items": [
                {"id": "other", "title": "다른 작업", "status": "active", "symbol": "005930", "mode": "paper", "nextFireAt": "2026-10-07T09:00:00+09:00"},
                {"id": "selected", "title": "선택 작업", "status": "paused", "symbol": "000660", "mode": "paper", "nextFireAt": "2026-10-07T09:00:00+09:00"},
            ] + [{"id": f"fixture-{i}", "title": "대기 작업", "status": "active", "symbol": "005930", "mode": "paper", "nextFireAt": "2026-10-07T09:00:00+09:00"} for i in range(28)]},
            "history": {"status": "not_requested", "items": None}}}

    async def test_control_retrieves_exact_selected_row_and_preserves_other_candidate_overview(self):
        original = self.context()
        service, client, ticket = self.setup_turn(original)
        await service.decide(ticket, [{"task_id": "routine.control"}])
        request = client.requests[0]
        self.assertEqual(request["utterance"], "선택한 작업을 잠시 멈춰줘")
        context = request["context"]
        rows = context["agentContext"]["routines"]
        self.assertEqual(rows["items"], [original["agentContext"]["routines"]["items"][1]])
        self.assertEqual(rows["candidate_overview"][0], {"id": "other", "title": "다른 작업", "status": "active", "symbol": "005930", "mode": "paper"})
        self.assertEqual(len(rows["candidate_overview"]), 30)
        self.assertEqual(rows["total"], 30)
        self.assertEqual(context["explicit_constraints"], original["explicit_constraints"])
        self.assertEqual(context["agentContext"]["history"], original["agentContext"]["history"])
        self.assertEqual(service.context(ticket)["context"], original)
        self.assertEqual(service.context(ticket)["protected_fields"], {"athena_routine.propose.routine_id": "selected"})

    async def test_unresolved_selection_falls_back_without_inference_and_is_cached(self):
        for case in ["missing", "duplicate", "pending", "malformed", "unknown_fields"]:
            context = self.context()
            routines = context["agentContext"]["routines"]
            if case == "missing": context["agentContext"]["selectedRoutineId"] = "missing"
            elif case == "duplicate": routines["items"].append(deepcopy(routines["items"][1]))
            elif case == "pending": routines["status"] = "pending"
            elif case == "malformed": routines["items"].append(None)
            else: routines["items"][0]["explicit_constraints"] = {"keep": True}
            service, client, ticket = self.setup_turn(context)
            result = await service.decide(ticket, [{"task_id": "routine.control"}])
            self.assertEqual(result, [{"task_id": "routine.control", "accepted": False, "reason": "context_selection_unresolved"}])
            self.assertEqual(await service.decide(ticket, [{"task_id": "routine.control"}]), result)
            self.assertEqual(client.requests, [])

    async def test_general_and_action_heads_and_absent_selection_preserve_full_context(self):
        for task in ["general.builtin_tool", "routine.action", "routine.goal"]:
            original = self.context()
            service, client, ticket = self.setup_turn(original)
            await service.decide(ticket, [{"task_id": task}])
            self.assertEqual(client.requests[0]["context"], original)
        original = self.context()
        original["agentContext"]["selectedRoutineId"] = None
        service, client, ticket = self.setup_turn(original)
        await service.decide(ticket, [{"task_id": "routine.control"}])
        self.assertEqual(client.requests[0]["context"], original)

    async def test_small_context_is_not_expanded_by_projection_metadata(self):
        original = self.context()
        original["agentContext"]["routines"]["items"] = original["agentContext"]["routines"]["items"][:2]
        service, client, ticket = self.setup_turn(original)
        await service.decide(ticket, [{"task_id": "routine.control"}])
        self.assertEqual(client.requests[0]["context"], original)

    async def test_mixed_batch_keeps_results_aligned_and_backtest_remains_excluded(self):
        context = self.context()
        context["agentContext"]["selectedRoutineId"] = "missing"
        service, client, ticket = self.setup_turn(context)
        result = await service.decide(ticket, [{"task_id": "routine.control"}, {"task_id": "routine.action"}])
        self.assertEqual([r["reason"] for r in result], ["context_selection_unresolved", "defer"])
        self.assertEqual([r["task_id"] for r in client.requests], ["routine.action"])
        service, client, ticket = self.setup_turn(context, "backtest")
        self.assertEqual((await service.decide(ticket, [{"task_id": "routine.control"}]))[0]["reason"], "excluded_scope")
        self.assertEqual(client.requests, [])
