from collections import Counter
import json
from pathlib import Path
from types import SimpleNamespace
from typing import Literal
import unittest

from pydantic import BaseModel, Field

from athena_api.brain.extraction import ExtractionEnvelopeV2
from athena_api.dependencies import build_selector_service
from athena_api.laya.memory import refine_extraction
from athena_api.laya.query import refine_arguments, rerank_search
from athena_api.laya.service import SemanticService
from athena_api.selector.schemas import ResolveRequest, SearchRequest


class Client:
    def __init__(self, predict):
        self.predict, self.requests, self.counts = predict, [], Counter()
        self.deployment_sha256 = "model-pin"

    async def decide(self, requests):
        self.requests.extend(requests)
        return [{"task_id": row["task_id"], "label": self.predict(row),
                 "accepted": self.predict(row) != "defer", "reason": "fixture"} for row in requests]


def request_for(service, headers=None):
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(laya_service=service, local_bearer_token="test")),
                           headers={"authorization": "Bearer test", **(headers or {})})


class QueryTests(unittest.IsolatedAsyncioTestCase):
    async def test_actual_catalog_retrieval_is_reranked_without_relabeling_typed_confidence(self):
        selector = build_selector_service()
        query = SearchRequest(query="삼성전자 거래량 순위", limit=5)
        response = selector.search(query)
        self.assertGreater(len(response.results), 1)
        target = response.results[-1].operation_ref
        client = Client(lambda row: "relevant" if row["candidate_id"] == target else "not_relevant")
        service = SemanticService(client)
        service.selector_catalog_version = selector.catalog.version
        service.catalog = {"query_candidates": [{"candidate_id": hit.operation_ref,
            "operation_ref": hit.operation_ref, "name": hit.name, "domain": hit.domain, "kind": "query"}
            for hit in response.results]}
        result = await rerank_search(request_for(service), query, selector, response)
        self.assertEqual(result.results[0].operation_ref, target)
        self.assertTrue(result.semantic_ranking["reordered"])
        original_confidence = {hit.operation_ref: hit.confidence for hit in response.results}
        self.assertTrue(all(hit.confidence == original_confidence[hit.operation_ref] for hit in result.results))
        self.assertEqual(len(client.requests), len(response.results))
        self.assertTrue(all(row["utterance"] == query.query for row in client.requests))
        service.selector_catalog_version = "drift"
        self.assertIs(await rerank_search(request_for(service), query, selector, response), response)

    async def test_actual_trained_websocket_candidates_obey_intent_and_live_kind(self):
        selector = build_selector_service()
        catalog = json.loads((Path(__file__).resolve().parents[2] /
            "datasets/laya-athena/versions/v008/source-contracts.json").read_text(encoding="utf-8"))
        service = SemanticService(Client(lambda row: "defer"))
        service.catalog, service.selector_catalog_version = catalog, selector.catalog.version
        for ref in ("base:ka10171", "base:ka10172"):
            payload = SearchRequest(query=ref, intent="websocket", limit=5)
            response = selector.search(payload)
            self.assertIn(ref, [hit.operation_ref for hit in response.results])
            result = await rerank_search(request_for(service), payload, selector, response)
            self.assertIn(ref, [row["candidate_id"] for row in service.client.requests])
            self.assertEqual(result.results, response.results)  # Ambiguity never becomes unique selection.
            service.client.requests.clear()
            await rerank_search(request_for(service), payload.model_copy(update={"intent": SearchRequest(query="test", intent="query").intent}), selector, response)
            # These two condition reads are explicitly allowed by the existing
            # selector on both query and websocket surfaces, unlike subscriptions.
            self.assertIn(ref, [row["candidate_id"] for row in service.client.requests])
            service.client.requests.clear()
            await rerank_search(request_for(service), payload.model_copy(update={"intent": SearchRequest(query="test", intent="order").intent}), selector, response)
            self.assertEqual(service.client.requests, [])
        target = next(row for row in service.catalog["query_candidates"] if row["operation_ref"] == "base:ka10172")
        target["kind"] = "query"
        await rerank_search(request_for(service), payload, selector, response)
        self.assertNotIn("base:ka10172", [row["candidate_id"] for row in service.client.requests])

    async def test_argument_alias_binding_unique_value_and_explicit_input_preservation(self):
        class Args(BaseModel):
            market: Literal["0", "1"] = Field(description="시장 — 0:전체, 1:코스피")
        document = SimpleNamespace(operation_ref="base:actual", kind="query", generic_callable=True, request_model=Args)
        selector = SimpleNamespace(catalog=SimpleNamespace(version="catalog", find_exact=lambda ref: document if ref == "base:actual" else None))
        client = Client(lambda row: "relevant" if row["candidate_id"] == "canonical::1" else "not_relevant")
        service = SemanticService(client)
        service.selector_catalog_version = "catalog"
        service.catalog = {"query_argument_candidates": [{"candidate_id": "canonical::" + value,
            "operation_ref": "base:canonical", "field": "market", "value": value,
            "field_description": Args.model_fields["market"].description,
            "qualified_aliases": [{"operation_ref": "base:actual", "field": "market"}]} for value in ("0", "1")]}
        request = request_for(service)
        payload = ResolveRequest(question="코스피만", preferred_ref="base:actual")
        result = await refine_arguments(request, payload, selector)
        self.assertEqual(result.arguments, {"market": "1"})
        self.assertEqual(payload.arguments, {})
        supplied = payload.model_copy(update={"arguments": {"market": "0"}})
        self.assertEqual((await refine_arguments(request, supplied, selector)).arguments, {"market": "0"})
        client.predict = lambda row: "relevant"
        self.assertEqual((await refine_arguments(request, payload, selector)).arguments, {})
        client.predict = lambda row: "defer"
        self.assertEqual((await refine_arguments(request, payload, selector)).arguments, {})

    async def test_foreign_turn_context_never_reaches_pair_model(self):
        service = SemanticService(Client(lambda row: "relevant"))
        ticket = service.register(lease_id="private-one", generation_id="generation", conversation_id="one",
                                  turn_id="turn", utterance="private original", context={}, origin="shell")
        request = request_for(service, {"x-athena-laya-ticket": ticket, "x-athena-laya-lease": "other",
                                       "x-athena-laya-generation": "generation"})
        selector = build_selector_service()
        payload = SearchRequest(query="삼성전자 현재 시세")
        response = selector.search(payload)
        self.assertIs(await rerank_search(request, payload, selector, response), response)
        self.assertEqual(service.client.requests, [])


class MemoryTests(unittest.IsolatedAsyncioTestCase):
    def envelope(self):
        return ExtractionEnvelopeV2.model_validate({"schema_version": 2, "request_id": "a" * 64,
            "source_fingerprint": "fingerprint", "entities": [{"ref": "e1", "kind": "company", "name": "반도체"}],
            "relations": [{"ref": "r1", "kind": "relates_to", "source_ref": "me", "target_ref": "e1",
                           "confidence": "EXTRACTED", "observed_at": "2026-10-04T00:00:00Z", "rationale": "original explanation"}]})

    async def test_all_three_heads_apply_to_real_typed_envelope_preserving_source_binding(self):
        choices = {"memory.entity_kind": "sector", "memory.relation_kind": "interested_in", "memory.explicitness": "INFERRED"}
        client = Client(lambda row: choices[row["task_id"]])
        original = self.envelope()
        result = await refine_extraction(SimpleNamespace(text="반도체 기사를 계속 읽었어"), original, client)
        self.assertEqual(result.entities[0].kind.value, "sector")
        self.assertEqual(result.relations[0].kind, "interested_in")
        self.assertEqual(result.relations[0].confidence.value, "INFERRED")
        self.assertEqual(result.source_fingerprint, original.source_fingerprint)
        self.assertEqual(result.relations[0].rationale, original.relations[0].rationale)
        self.assertEqual(result.relations[0].observed_at, original.relations[0].observed_at)
        self.assertEqual(client.requests[0]["context"], {"entity_mention": "반도체"})
        self.assertEqual(client.requests[1]["context"], {"subject": "사용자 본인", "target": "반도체",
            "relation_candidate": {"subject": "사용자 본인", "target": "반도체", "predicate": "relates_to"}})
        self.assertEqual(client.requests[2]["context"]["relation_candidate"]["predicate"], "interested_in")
        self.assertNotIn("rationale", str(client.requests))

    async def test_same_endpoints_keep_each_original_relation_candidate_distinct(self):
        original = self.envelope()
        relation = original.relations[0].model_copy(update={"ref": "r2", "kind": "owns"})
        original = original.model_copy(update={"relations": (*original.relations, relation)})
        client = Client(lambda row: "defer")
        await refine_extraction(SimpleNamespace(text="보유하지만 관심은 없어요"), original, client)
        contexts = [row["context"] for row in client.requests if row["task_id"] == "memory.relation_kind"]
        self.assertEqual([row["relation_candidate"]["predicate"] for row in contexts], ["relates_to", "owns"])
        self.assertEqual(contexts[0]["subject"], contexts[1]["subject"])
        self.assertNotIn("confidence", str(contexts))

    async def test_uncertain_memory_preserves_existing_extraction(self):
        original = self.envelope()
        result = await refine_extraction(SimpleNamespace(text="질문"), original, Client(lambda row: "defer"))
        self.assertEqual(result, original)


if __name__ == "__main__":
    unittest.main()
