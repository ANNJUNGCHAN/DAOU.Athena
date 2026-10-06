"""Pinned runtime coverage; synthetic decisions do not measure model quality."""
import asyncio
from copy import deepcopy
from dataclasses import replace
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field

from athena_api.api.laya import router
from athena_api.config import Settings
from athena_api.dependencies import build_selector_service
from athena_api.laya.catalog_selection import CatalogSelectionRequest, LayaCatalogSelectionService, catalog_candidate
from athena_api.laya.client import RuntimeClient
from athena_api.laya.service import SemanticService
from athena_api.selector.schemas import DiscoveryIntent


@pytest.fixture
def selector():
    return build_selector_service()


def selection_request(selector):
    return CatalogSelectionRequest(text="합성 전체 조회", catalog_version=selector.catalog.version)


def configured(selector, *, change=None, delay=0, enabled=True, timeout=5):
    documents = selector.catalog.visible_for(DiscoveryIntent.QUERY)
    target = documents[-1].operation_ref
    batches = []
    started, cancelled = asyncio.Event(), asyncio.Event()

    async def respond(request):
        assert request.url.path == "/decide"
        assert request.headers["authorization"] == "Bearer synthetic-runtime-token"
        body = json.loads(request.content)
        assert body["deployment_sha256"] == "synthetic-pin"
        batches.append(body["requests"])
        started.set()
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            cancelled.set()
            raise
        rows = [{"task_id": row["task_id"], "label": "relevant" if row["candidate_id"] == target else "not_relevant",
                 "accepted": True, "reason": "accepted", "confidence": .95, "threshold": .8}
                for row in body["requests"]]
        if change:
            change(rows, len(batches))
        return httpx.Response(200, json={"identity": {"deployment_sha256": "synthetic-pin"}, "decisions": rows})

    runtime = SemanticService(RuntimeClient("http://127.0.0.1:8769", "synthetic-runtime-token",
        "synthetic-pin", transport=httpx.MockTransport(respond)))
    runtime.selector_catalog_version = selector.catalog.version
    runtime.catalog = {"query_candidates": [{"candidate_id": doc.operation_ref, "operation_ref": doc.operation_ref,
        "name": doc.name, "kind": doc.kind, "domain": doc.domain} for doc in documents]}
    settings = SimpleNamespace(laya_catalog_enabled=enabled, laya_catalog_timeout_seconds=timeout)
    service = LayaCatalogSelectionService(settings, runtime)
    return service, runtime, target, batches, started, cancelled


async def test_complete_pinned_catalog_selects_beyond_shortlist_with_exact_contract(selector):
    service, _, target, batches, _, _ = configured(selector)
    result = await service.select_operation(selection_request(selector), selector)
    assert result.status == "accepted" and result.choice == target
    assert result.considered_count == result.evaluated_count == result.question_count == 266
    assert [len(batch) for batch in batches] == [32] * 8 + [10]
    assert {row["candidate_id"] for batch in batches for row in batch} == {
        doc.operation_ref for doc in selector.catalog.visible_for(DiscoveryIntent.QUERY)}
    assert all(set(row) == {"task_id", "candidate_id", "utterance", "context"}
               and row["task_id"] == "query.operation_relevance" for batch in batches for row in batch)
    assert result.candidate.operation_ref == target
    schema = selector.catalog.find_exact(target).request_model.model_json_schema(by_alias=True)
    assert result.candidate.argument_contracts["properties"] == schema["properties"]
    assert result.candidate.argument_contracts["required"] == schema.get("required", [])
    assert result.candidate.argument_contracts["additionalProperties"] is False


@pytest.mark.parametrize("change", [
    lambda rows, batch: rows[0].update(label="relevant") if batch == 1 else None,
    lambda rows, batch: rows[0].update(accepted=False, label="defer", reason="defer"),
    lambda rows, batch: rows[0].update(defer_override=True, original_top_label="defer"),
    lambda rows, batch: rows[0].update(label="invented"),
    lambda rows, batch: rows.pop(),
])
async def test_ambiguous_forced_or_invalid_decisions_never_return_partial_candidate(selector, change):
    service, _, _, _, _, _ = configured(selector, change=change)
    result = await service.select_operation(selection_request(selector), selector)
    assert result.status == "fallback" and result.choice is None and result.candidate is None


@pytest.mark.parametrize("drift", ["missing", "duplicate", "kind", "name", "domain", "version", "catalog_none"])
async def test_incomplete_or_mismatched_pinned_catalog_never_calls_runtime(selector, drift):
    service, runtime, _, batches, _, _ = configured(selector)
    bank = runtime.catalog["query_candidates"]
    if drift == "missing": bank.pop()
    elif drift == "duplicate": bank.append(deepcopy(bank[0]))
    elif drift == "version": runtime.selector_catalog_version = "different"
    elif drift == "catalog_none": runtime.catalog = None
    else: bank[0][drift] = "different"
    result = await service.select_operation(selection_request(selector), selector)
    assert result.status == "fallback" and result.evaluated_count == 0 and batches == []


async def test_default_off_and_request_version_mismatch_do_not_infer(selector):
    assert Settings(_env_file=None).laya_catalog_enabled is False
    service, _, _, batches, _, _ = configured(selector, enabled=False)
    assert (await service.select_operation(selection_request(selector), selector)).reason == "disabled"
    service.settings.laya_catalog_enabled = True
    request = selection_request(selector).model_copy(update={"catalog_version": "different"})
    assert (await service.select_operation(request, selector)).reason == "catalog_version_mismatch"
    assert batches == []


async def test_all_negative_decisions_return_no_match_after_full_coverage(selector):
    def reject_all(rows, _batch):
        for row in rows:
            row["label"] = "not_relevant"
    service, _, _, _, _, _ = configured(selector, change=reject_all)
    result = await service.select_operation(selection_request(selector), selector)
    assert result.reason == "no_match" and result.choice is None
    assert result.evaluated_count == result.considered_count == 266


async def test_total_deadline_cancels_inference_and_releases_singleflight(selector):
    service, _, _, _, _, cancelled = configured(selector, delay=.1, timeout=.01)
    result = await service.select_operation(selection_request(selector), selector)
    assert result.reason == "timeout" and result.candidate is None and cancelled.is_set()
    assert not service.lock.locked()


async def test_busy_and_caller_cancel_preserve_runtime_cancellation(selector):
    service, _, _, batches, started, cancelled = configured(selector, delay=10)
    task = asyncio.create_task(service.select_operation(selection_request(selector), selector))
    await asyncio.wait_for(started.wait(), 1)
    result = await service.select_operation(selection_request(selector), selector)
    assert result.reason == "busy" and len(batches) == 1
    task.cancel()
    with pytest.raises(asyncio.CancelledError): await task
    assert cancelled.is_set() and not service.lock.locked()


@pytest.mark.parametrize("ref", ["base:ka10171", "base:ka10172", "detail:ka10001:identity_and_capital"])
def test_selected_contract_preserves_schema(selector, ref):
    candidate = catalog_candidate(selector, ref)
    schema = selector.catalog.find_exact(ref).request_model.model_json_schema(by_alias=True)
    assert candidate.argument_contracts["properties"] == schema["properties"]
    assert candidate.argument_contracts.get("$defs") == schema.get("$defs")
    assert candidate.argument_contracts["required"] == schema.get("required", [])
    assert candidate.execution_policy in {"selector_query", "selector_detail"}


def test_selected_contract_keeps_optional_properties_and_nested_definitions(selector):
    class Filter(BaseModel):
        market: str = Field(pattern="^[01]$")
    class Arguments(BaseModel):
        filters: list[Filter]
        limit: int = Field(default=10, ge=1, le=100)
    ref = "base:ka10171"
    document = replace(selector.catalog.find_exact(ref), request_model=Arguments)
    selector.catalog = replace(selector.catalog, by_ref={**selector.catalog.by_ref, ref: document})
    candidate = catalog_candidate(selector, ref)
    contract = candidate.argument_contracts
    assert contract["required"] == ["filters"]
    assert contract["properties"]["filters"]["items"] == {"$ref": "#/$defs/Filter"}
    assert contract["$defs"]["Filter"]["properties"]["market"]["pattern"] == "^[01]$"
    assert contract["properties"]["limit"]["minimum"] == 1
    assert contract["properties"]["limit"]["maximum"] == 100


def test_api_requires_local_bearer_and_rejects_caller_candidate_overrides(selector):
    app = FastAPI()
    selection, runtime, _, batches, _, _ = configured(selector)
    app.state.settings = selection.settings
    app.state.laya_service = runtime
    app.state.selector_service = selector
    app.state.local_bearer_token = "synthetic-backend-token"
    app.include_router(router)
    body = selection_request(selector).model_dump()
    headers = {"Authorization": "Bearer synthetic-backend-token"}
    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        assert client.post("/api/v1/laya/select-operation", json=body).status_code == 401
        assert client.post("/api/v1/laya/select-operation", json={**body, "candidates": []}, headers=headers).status_code == 422
        result = client.post("/api/v1/laya/select-operation", json=body, headers=headers)
        assert result.status_code == 200 and result.json()["status"] == "accepted"
    count = len(batches)
    with TestClient(app, client=("192.0.2.1", 50000)) as client:
        assert client.post("/api/v1/laya/select-operation", json=body, headers=headers).status_code == 403
    assert len(batches) == count
