import asyncio
from types import SimpleNamespace
from typing import Literal
import unittest
from unittest.mock import patch

from pydantic import BaseModel, Field

from athena_api.api import llm_tools
from athena_api.dependencies import build_selector_service
from athena_api.laya.service import SemanticService
from athena_api.selector.schemas import ResolveRequest, SearchRequest
from test_laya_query_memory import Client, request_for


class DelayedClient(Client):
    def __init__(self, predict, delay=0):
        super().__init__(predict)
        self.delay = delay
        self.started = asyncio.Event()
        self.cancelled = False

    async def decide(self, requests):
        self.started.set()
        try:
            await asyncio.sleep(self.delay)
            return await super().decide(requests)
        except asyncio.CancelledError:
            self.cancelled = True
            raise


class LlmToolTimeoutTests(unittest.IsolatedAsyncioTestCase):
    def search_case(self, delay=0):
        selector = build_selector_service()
        payload = SearchRequest(query="다우기술 023590 기업 정보", limit=10)
        original = selector.search(payload)
        self.assertGreater(len(original.results), 1)
        target = original.results[-1].operation_ref
        client = DelayedClient(
            lambda row: "relevant" if row["candidate_id"] == target else "not_relevant",
            delay,
        )
        service = SemanticService(client)
        service.selector_catalog_version = selector.catalog.version
        service.catalog = {"query_candidates": [
            {"candidate_id": hit.operation_ref, "operation_ref": hit.operation_ref,
             "name": hit.name, "domain": hit.domain,
             "kind": selector.catalog.find_exact(hit.operation_ref).kind}
            for hit in original.results
        ]}
        return selector, payload, original, service, target

    def resolve_case(self, delay=0):
        class Args(BaseModel):
            market: Literal["0", "1"] = Field(description="Market: 0 all, 1 KOSPI")

        document = SimpleNamespace(operation_ref="base:actual", kind="query",
                                   generic_callable=True, request_model=Args)
        selector = SimpleNamespace(
            catalog=SimpleNamespace(version="catalog", find_exact=lambda ref: document),
            resolve=lambda payload, account: payload,
        )
        client = DelayedClient(
            lambda row: "relevant" if row["candidate_id"] == "market:1" else "not_relevant",
            delay,
        )
        service = SemanticService(client)
        service.selector_catalog_version = "catalog"
        service.catalog = {"query_argument_candidates": [
            {"candidate_id": "market:" + value, "operation_ref": "base:actual",
             "field": "market", "value": value,
             "field_description": Args.model_fields["market"].description}
            for value in ("0", "1")
        ]}
        payload = ResolveRequest(question="코스피만", preferred_ref="base:actual")
        return selector, payload, service

    async def test_slow_authenticated_search_returns_original_candidates(self):
        selector, payload, original, service, _ = self.search_case(delay=0.05)
        with patch.object(llm_tools, "_SEMANTIC_TIMEOUT_SECONDS", 0.005, create=True):
            result = await llm_tools.search_operations(payload, request_for(service), selector)
        self.assertEqual(result, original)
        self.assertTrue(service.client.cancelled)
        self.assertEqual(service.client.counts["query_search_timeout"], 1)

    async def test_fast_authenticated_search_keeps_semantic_ranking(self):
        selector, payload, original, service, target = self.search_case()
        result = await llm_tools.search_operations(payload, request_for(service), selector)
        self.assertEqual(result.results[0].operation_ref, target)
        self.assertTrue(result.semantic_ranking["reordered"])
        self.assertCountEqual(result.results, original.results)

    async def test_slow_argument_refinement_preserves_original_request(self):
        selector, payload, service = self.resolve_case(delay=0.05)
        with patch.object(llm_tools, "_SEMANTIC_TIMEOUT_SECONDS", 0.005, create=True):
            result = await llm_tools.resolve_operation(payload, request_for(service), selector, "fixture")
        self.assertIs(result, payload)
        self.assertEqual(payload.arguments, {})
        self.assertTrue(service.client.cancelled)
        self.assertEqual(service.client.counts["query_resolve_timeout"], 1)

    async def test_fast_argument_refinement_keeps_accepted_value(self):
        selector, payload, service = self.resolve_case()
        result = await llm_tools.resolve_operation(payload, request_for(service), selector, "fixture")
        self.assertEqual(result.arguments, {"market": "1"})
        self.assertEqual(payload.arguments, {})

    async def test_caller_cancellation_propagates_to_semantic_inference(self):
        for endpoint in ("search", "resolve"):
            with self.subTest(endpoint=endpoint):
                if endpoint == "search":
                    selector, payload, _, service, _ = self.search_case(delay=60)
                    call = llm_tools.search_operations(payload, request_for(service), selector)
                else:
                    selector, payload, service = self.resolve_case(delay=60)
                    call = llm_tools.resolve_operation(payload, request_for(service), selector, "fixture")
                task = asyncio.create_task(call)
                await asyncio.wait_for(service.client.started.wait(), timeout=1)
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
                self.assertTrue(service.client.cancelled)
                self.assertEqual(service.client.counts["query_" + endpoint + "_timeout"], 0)


if __name__ == "__main__":
    unittest.main()
