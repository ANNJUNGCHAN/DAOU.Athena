"""Contract and exhaustive coverage tests; mocked choices do not measure model quality."""

import asyncio
import json
from collections import Counter
from dataclasses import replace
from types import MappingProxyType

import httpx
import pytest
from fastapi import FastAPI
from pydantic import ValidationError

from athena_api.api.laya import router
from athena_api.config import Settings
from athena_api.dependencies import build_selector_service
from athena_api.laya.catalog_selection import (
    MODEL_ID,
    CatalogSelectionRequest,
    LayaCatalogSelectionService,
    catalog_candidate,
    operation_criterion,
)
from athena_api.selector.catalog import READ_ONLY_CONDITION_REFS
from athena_api.selector.schemas import DiscoveryIntent


@pytest.fixture
def selector():
    return build_selector_service()


def settings(**kwargs):
    return Settings(_env_file=None, **({"laya_enabled": True} | kwargs))


def request(selector):
    return CatalogSelectionRequest(
        text="시간에 따른 체결강도", catalog_version=selector.catalog.version
    )


def response(body, target, *, confidence=0.95, pick_none=False, reverse_first=False):
    answers = {}
    for name, question in body["questions"].items():
        criteria = question["criteria"]
        selected = next(
            (key for key, value in criteria.items() if value == target), next(iter(criteria))
        )
        if pick_none and name.endswith("final"):
            selected = list(criteria)[-1]
        if reverse_first and name.startswith("reverse"):
            selected = next(iter(criteria))
        probabilities = {key: (1 - confidence) / (len(criteria) - 1) for key in criteria}
        probabilities[selected] = confidence
        answers[name] = {
            "type": "choice",
            "choice": selected,
            "probabilities": probabilities,
            "answer_confidence": confidence,
        }
    return {"model": "laya-rl-agent", "answers": answers, "runtime": {"model_id": MODEL_ID}}


def service_for(selector, target_ref, *, seen=None, **settings_kwargs):
    target = operation_criterion(selector.catalog.by_ref[target_ref])

    def respond(req):
        body = json.loads(req.content)
        if seen is not None:
            seen.append(body)
        return httpx.Response(200, json=response(body, target))

    return LayaCatalogSelectionService(
        settings(**settings_kwargs), transport=httpx.MockTransport(respond)
    )


def test_catalog_eligibility_covers_every_read_and_no_orders_oauth_or_split_bases(selector):
    docs = selector.catalog.visible_for(DiscoveryIntent.QUERY)
    assert len(docs) == 266
    assert Counter(doc.kind for doc in docs) == {"query": 264, "websocket": 2}
    assert Counter(doc.operation_ref.split(":")[0] for doc in docs) == {"base": 151, "detail": 115}
    assert {
        doc.operation_ref for doc in docs if doc.kind == "websocket"
    } == READ_ONLY_CONDITION_REFS
    assert all(doc.generic_callable and doc.visibility == "normal" for doc in docs)
    assert "base:ka10001" not in {doc.operation_ref for doc in docs}
    assert all(doc.kind not in {"order", "oauth"} for doc in docs)


async def test_all_266_evaluated_in_both_orders_including_after_first_batch(selector):
    docs = selector.catalog.visible_for(DiscoveryIntent.QUERY)
    target = docs[-1]
    assert sum(operation_criterion(doc) == operation_criterion(target) for doc in docs) == 1
    seen = []
    service = service_for(selector, target.operation_ref, seen=seen)
    result = await service.select_operation(request(selector), selector)
    assert result.status == "accepted" and result.choice == target.operation_ref
    assert result.considered_count == result.evaluated_count == 266
    assert result.question_count == 70 and len(seen) == 12
    assert result.candidate.operation_ref == target.operation_ref
    assert (
        result.candidate.argument_contracts
        == catalog_candidate(selector, target.operation_ref).argument_contracts
    )
    assert target.operation_ref not in {doc.operation_ref for doc in docs[:3]}
    expected = Counter(operation_criterion(doc) for doc in docs)
    for order in ("forward", "reverse"):
        actual = Counter(
            criterion
            for body in seen
            for name, question in body["questions"].items()
            if name.startswith(f"{order}_0_")
            for criterion in question["criteria"].values()
        )
        assert actual == expected
    assert not any(
        operation_criterion(target) in q["criteria"].values() for q in seen[0]["questions"].values()
    )
    assert all(1 <= len(body["questions"]) <= 8 for body in seen)
    assert all(2 <= len(q["criteria"]) <= 10 for body in seen for q in body["questions"].values())
    assert all(doc.operation_ref not in json.dumps(seen, ensure_ascii=False) for doc in docs)


async def test_final_abstention_and_low_confidence_do_not_return_partial_winner(selector):
    target = operation_criterion(selector.catalog.documents[0])
    for options, reason in [
        ({"pick_none": True}, "final_abstention"),
        ({"confidence": 0.7}, "final_uncertain"),
    ]:
        service = LayaCatalogSelectionService(
            settings(),
            transport=httpx.MockTransport(
                lambda req, options=options: httpx.Response(
                    200, json=response(json.loads(req.content), target, **options)
                )
            ),
        )
        result = await service.select_operation(request(selector), selector)
        assert result.status == "fallback" and result.reason == reason
        assert result.choice is None and result.candidate is None
        assert result.evaluated_count == 266 and result.question_count == 70


async def test_reversed_order_disagreement_abstains(selector):
    target = operation_criterion(selector.catalog.by_ref["base:ka10046"])
    service = LayaCatalogSelectionService(
        settings(),
        transport=httpx.MockTransport(
            lambda req: httpx.Response(
                200, json=response(json.loads(req.content), target, reverse_first=True)
            )
        ),
    )
    result = await service.select_operation(request(selector), selector)
    assert result.reason == "order_disagreement" and result.choice is None


@pytest.mark.parametrize("special", sorted(READ_ONLY_CONDITION_REFS))
async def test_readonly_websocket_exceptions_have_server_query_contract(selector, special):
    result = await service_for(selector, special).select_operation(request(selector), selector)
    assert result.status == "accepted" and result.choice == special
    assert result.candidate.kind == "websocket"
    assert result.candidate.execution_policy == "selector_query"
    contract = result.candidate.argument_contracts
    schema = selector.catalog.by_ref[special].request_model.model_json_schema(by_alias=True)
    assert set(contract["properties"]) == set(schema["properties"])
    assert contract["required"] == schema.get("required", [])


async def test_optional_and_required_contract_fields_survive_selection(selector):
    docs = selector.catalog.visible_for(DiscoveryIntent.QUERY)
    doc = next(
        doc
        for doc in docs
        if any(not f.is_required() for f in doc.request_model.model_fields.values())
    )
    candidate = catalog_candidate(selector, doc.operation_ref)
    schema = doc.request_model.model_json_schema(by_alias=True)
    assert set(candidate.argument_contracts["properties"]) == set(schema["properties"])
    assert len(candidate.argument_contracts["properties"]) > len(
        candidate.argument_contracts["required"]
    )
    assert candidate.argument_contracts["additionalProperties"] is False


async def test_singleton_group_is_evaluated_then_carried_even_with_none_vote(selector):
    docs = selector.catalog.visible_for(DiscoveryIntent.QUERY)[:10]
    selector.catalog = replace(
        selector.catalog,
        documents=docs,
        by_ref=MappingProxyType({doc.operation_ref: doc for doc in docs}),
    )
    target = operation_criterion(docs[-1])
    seen = []

    def respond(req):
        body = json.loads(req.content)
        seen.append(body)
        result = response(body, target)
        for name, q in body["questions"].items():
            if not name.endswith("final") and len(q["criteria"]) == 2:
                keys = list(q["criteria"])
                result["answers"][name].update(
                    choice=keys[-1], probabilities={keys[0]: 0.05, keys[-1]: 0.95}
                )
        return httpx.Response(200, json=result)

    result = await LayaCatalogSelectionService(
        settings(), transport=httpx.MockTransport(respond)
    ).select_operation(request(selector), selector)
    assert result.status == "accepted" and result.choice == docs[-1].operation_ref
    assert result.evaluated_count == 10
    assert any(
        len(q["criteria"]) == 2
        for body in seen
        for name, q in body["questions"].items()
        if not name.endswith("final")
    )


async def test_disabled_and_catalog_mismatch_stop_before_model(selector):
    def unexpected(_):
        raise AssertionError("No model call is permitted")

    for enabled, version, reason in [
        (False, selector.catalog.version, "disabled"),
        (True, "stale", "catalog_version_mismatch"),
    ]:
        service = LayaCatalogSelectionService(
            settings(laya_enabled=enabled), transport=httpx.MockTransport(unexpected)
        )
        result = await service.select_operation(
            CatalogSelectionRequest(text="조회", catalog_version=version), selector
        )
        assert result.reason == reason and result.evaluated_count == result.question_count == 0


@pytest.mark.parametrize(
    "bad",
    [
        "model",
        "runtime_model",
        "missing_question",
        "extra_question",
        "unknown_choice",
        "extra_probability",
        "negative",
        "nan",
        "bool",
        "sum",
        "confidence",
        "type",
        "duplicate_json",
    ],
)
async def test_malformed_batch_fails_closed_without_partial_winner(selector, bad):
    calls = []

    def respond(req):
        calls.append(req)
        result = response(json.loads(req.content), "not a candidate")
        first = next(iter(result["answers"]))
        answer = result["answers"][first]
        if bad == "model":
            result["model"] = "other"
        elif bad == "runtime_model":
            result["runtime"]["model_id"] = "other"
        elif bad == "missing_question":
            del result["answers"][first]
        elif bad == "extra_question":
            result["answers"]["extra"] = answer
        elif bad == "unknown_choice":
            answer["choice"] = "base:kt10000"
        elif bad == "extra_probability":
            answer["probabilities"]["extra"] = 0
        elif bad in {"negative", "nan", "bool", "sum"}:
            answer["probabilities"]["c0"] = {
                "negative": -1,
                "nan": float("nan"),
                "bool": True,
                "sum": 0.5,
            }[bad]
        elif bad == "confidence":
            answer["answer_confidence"] = 0.8
        elif bad == "type":
            answer["type"] = "noul"
        content = json.dumps(result)
        if bad == "duplicate_json":
            content = content.replace(
                '"model": "laya-rl-agent"', '"model": "other", "model": "laya-rl-agent"'
            )
        return httpx.Response(200, content=content)

    service = LayaCatalogSelectionService(settings(), transport=httpx.MockTransport(respond))
    result = await service.select_operation(request(selector), selector)
    assert result.reason == "unavailable" and result.choice is None and result.candidate is None
    assert result.evaluated_count == 0
    assert (await service.select_operation(request(selector), selector)).reason == "circuit_open"
    assert len(calls) == 1


async def test_partial_model_failure_reports_partial_coverage_without_candidate(selector):
    calls = []

    def respond(req):
        calls.append(req)
        if len(calls) == 2:
            return httpx.Response(503)
        return httpx.Response(200, json=response(json.loads(req.content), "not a candidate"))

    result = await LayaCatalogSelectionService(
        settings(), transport=httpx.MockTransport(respond)
    ).select_operation(request(selector), selector)
    assert result.reason == "unavailable" and result.choice is None and result.candidate is None
    assert result.evaluated_count == 72 and result.considered_count == 266


async def test_global_deadline_busy_cancellation_and_lock_release(selector):
    started = asyncio.Event()
    release = asyncio.Event()

    async def respond(req):
        started.set()
        await release.wait()
        return httpx.Response(200, json=response(json.loads(req.content), "not a candidate"))

    service = LayaCatalogSelectionService(
        settings(laya_catalog_timeout_seconds=0.1), transport=httpx.MockTransport(respond)
    )
    pending = asyncio.create_task(service.select_operation(request(selector), selector))
    await started.wait()
    assert (await service.select_operation(request(selector), selector)).reason == "busy"
    pending.cancel()
    with pytest.raises(asyncio.CancelledError):
        await pending
    assert not service._lock.locked()
    result = await service.select_operation(request(selector), selector)
    assert result.reason == "unavailable" and result.choice is None
    assert not service._lock.locked()


@pytest.mark.parametrize(
    "extra", [{"candidates": []}, {"instructions": "override"}, {"operation_ref": "base:kt10000"}]
)
def test_request_never_accepts_caller_shortlist_or_instructions(extra):
    with pytest.raises(ValidationError):
        CatalogSelectionRequest(text="조회", catalog_version="version", **extra)


@pytest.mark.parametrize(
    ("host", "token", "status"),
    [
        ("127.0.0.1", None, 401),
        ("127.0.0.1", "wrong", 401),
        ("203.0.113.2", "synthetic", 403),
        ("127.0.0.1", "synthetic", 200),
    ],
)
async def test_endpoint_requires_local_bearer_and_never_needs_broker_credentials(
    selector, host, token, status
):
    app = FastAPI()
    app.state.settings = settings(laya_enabled=False)
    app.state.local_bearer_token = "synthetic"
    app.state.selector_service = selector
    app.include_router(router)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, client=(host, 1234)), base_url="http://test"
    ) as client:
        result = await client.post(
            "/api/v1/laya/select-operation",
            json=request(selector).model_dump(),
            headers={"Authorization": f"Bearer {token}"} if token else {},
        )
    assert result.status_code == status
    if status == 200:
        body = result.json()
        assert body["status"] == "fallback" and body["reason"] == "disabled"
        assert body["candidate"] is None and body["considered_count"] == 266
