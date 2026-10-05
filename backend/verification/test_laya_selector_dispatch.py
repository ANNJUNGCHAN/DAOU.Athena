import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import Response
from fastapi.responses import JSONResponse
from starlette.requests import Request

from athena_api.api import canvas_push
from athena_api.dependencies import build_selector_service
from athena_api.laya.query import refine_dispatch_request
from athena_api.laya.service import SemanticService
from athena_api.selector.schemas import SearchRequest
from test_laya_query_memory import Client


CATALOG = Path(__file__).resolve().parents[2] / "datasets/laya-athena/versions/v008/source-contracts.json"


def request_for(service, *, authenticated=True):
    return Request({"type": "http", "method": "POST", "path": "/api/v1/selector/dispatch",
        "headers": [(b"authorization", b"Bearer test")] if authenticated else [],
        "app": SimpleNamespace(state=SimpleNamespace(laya_service=service, local_bearer_token="test"))})


class PrimarySelectorTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.selector = build_selector_service()
        self.catalog = json.loads(CATALOG.read_text(encoding="utf-8"))

    def service(self, predict):
        service = SemanticService(Client(predict))
        service.catalog = self.catalog
        service.selector_catalog_version = self.selector.catalog.version
        return service

    async def test_actual_dispatch_fills_missing_enum_then_original_selector_seals_it(self):
        market = {row["candidate_id"]: row["value"] for row in self.catalog["query_argument_candidates"]
                  if any(alias["operation_ref"] == "base:ka10030" and alias["field"] == "mrkt_tp"
                         for alias in row.get("qualified_aliases", [row]))}
        def predict(row):
            if row["task_id"] == "query.intent":
                return "query"
            if row["task_id"] == "query.response_mode":
                return "full"
            return "relevant" if market[row["candidate_id"]] == "001" else "not_relevant"
        service = self.service(predict)
        arguments = {"sort_tp": "1", "mang_stk_incls": "0", "crd_tp": "0", "trde_qty_tp": "0",
                     "pric_tp": "0", "trde_prica_tp": "0", "mrkt_open_tp": "0", "stex_tp": "1"}
        payload = canvas_push.SelectorDispatchRequest(question="base:ka10030", arguments=arguments,
            original_question="코스피 거래량 순위 전체 보여줘", semantic_context={"canvasMode": "query"})
        calls = []
        async def render(render_payload, request, response, *rest):
            plan = self.selector.signer.verify(render_payload.plan_token, self.selector.catalog, expected_account="fixture")
            calls.append(plan)
            return JSONResponse({"status": "fixture-render-no-network"})
        with patch.object(canvas_push, "canvas_render_plan", render):
            response = await canvas_push.selector_dispatch(payload, request_for(service), Response(), None, None, self.selector, "fixture")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0].operation_ref, "base:ka10030")
        self.assertEqual(calls[0].arguments, {**arguments, "mrkt_tp": "001"})
        self.assertEqual(payload.arguments, arguments)
        self.assertTrue(all(row["utterance"] == payload.original_question for row in service.client.requests))
        self.assertEqual(service.client.requests[0]["context"], payload.semantic_context)
        self.assertEqual({row["task_id"] for row in service.client.requests}, {
            "query.intent", "query.response_mode", "query.argument_value_relevance"})

    async def test_actual_preflight_shortlist_reranks_without_resolve_or_trade_guard_bypass(self):
        question = "삼성전자 거래량 순위"
        search = self.selector.search(SearchRequest(query=question, limit=3))
        target = next(hit.operation_ref for hit in reversed(search.results) if hit.generic_callable)
        service = self.service(lambda row: ("relevant" if row["candidate_id"] == target else "not_relevant")
                               if row["task_id"] == "query.operation_relevance" else "defer")
        result = await canvas_push.selector_dispatch(canvas_push.SelectorDispatchRequest(question=question),
            request_for(service), Response(), None, None, self.selector, "fixture")
        content = json.loads(result.body)
        self.assertEqual(content["status"], "needs_inference")
        self.assertEqual(content["candidates"][0]["operation_ref"], target)
        self.assertNotIn("plan_token", content)
        self.assertIn("query.operation_relevance", {row["task_id"] for row in service.client.requests})

    async def test_explicit_structured_values_and_authorization_surface_are_preserved(self):
        service = self.service(lambda row: "websocket" if row["task_id"] == "query.intent" else "defer")
        original = canvas_push.SelectorDispatchRequest(question="base:ka10171", intent="query",
            preferred_ref="base:ka10171", arguments={"trnm": "CNSRLST"}, response_mode="full")
        result = await refine_dispatch_request(request_for(service), original, self.selector)
        self.assertEqual(result, original)
        self.assertEqual(service.client.requests, [])
        automatic = original.model_copy(update={"intent": SearchRequest(query="조건검색", intent="auto").intent})
        result = await refine_dispatch_request(request_for(service), automatic, self.selector)
        self.assertEqual(result.intent.value, "auto")  # Inference cannot grant streaming scope.
        service.client.requests.clear()
        self.assertIs(await refine_dispatch_request(request_for(service, authenticated=False), automatic, self.selector), automatic)
        self.assertEqual(service.client.requests, [])


if __name__ == "__main__":
    unittest.main()
