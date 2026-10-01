"""Signed condition-read delivery using public synthetic results; no upstream API."""

import asyncio
import json

import httpx
import pytest
from fastapi import FastAPI, Request, Response

from athena_api.api.canvas_push import RenderPlanRequest, canvas_render_query, router
from athena_api.dependencies import get_kiwoom_client, get_kiwoom_ws_client, get_selector_service, resolve_account_alias
from athena_api.errors import KiwoomApiError, install_exception_handlers
from athena_api.selector.catalog import build_operation_catalog
from athena_api.selector.errors import OrderTicketRequiredError, PlanAlreadyUsedError, QueryPlanRequiredError
from athena_api.selector.plans import PlanSigner
from athena_api.selector.service import SelectorService
from athena_api.selector.errors import InvalidArgumentsError, OperationNotFoundError, NoConfidentMatchError
from athena_api.selector.schemas import DescribeRequest, DiscoveryIntent, ResolveRequest, SearchRequest


class ConditionClient:
    is_ready = True

    def __init__(self, body):
        self.body = body
        self.calls = []

    async def execute(self, operation, arguments):
        self.calls.append((operation, arguments))
        return self.body


def fixture(operation="ka10171", arguments=None, body=None, delivery="side_channel"):
    catalog = build_operation_catalog()
    document = catalog.find_exact(f"base:{operation}")
    signer = PlanSigner(b"synthetic-condition-delivery-test-key")
    selector = SelectorService(catalog, signer)
    arguments = arguments or {"trnm": "CNSRLST"}
    token, _ = signer.issue(catalog=catalog, document=document, arguments=arguments,
                            question="저장된 조건검색 목록")
    app = FastAPI()
    app.state.canvas_events = asyncio.Queue()
    request = Request({"type": "http", "headers": [], "app": app})
    client = ConditionClient(body or {"return_code": 0, "trnm": "CNSRLST", "data": []})
    payload = RenderPlanRequest(plan_token=token, delivery=delivery, delivery_id="1" * 32)
    return selector, request, client, payload


async def render(f):
    selector, request, client, payload = f
    return await canvas_render_query(payload, request, Response(), None, selector, "", client)


@pytest.mark.asyncio
async def test_condition_list_reaches_explorer_surface_once_without_chat_values():
    f = fixture(body={"return_code": 0, "trnm": "CNSRLST", "data": [["1", "합성 조건 A"], ["2", "합성 조건 B"], ["3", "합성 조건 C"]]})
    reply = json.loads((await render(f)).body)
    assert reply["queued"] and reply["envelope"] is None
    assert "합성 조건" not in json.dumps(reply, ensure_ascii=False)
    envelope = f[1].app.state.canvas_events.get_nowait()
    assert envelope["card_id"] == "CC-06"
    assert envelope["surface_contract"]["board_id"] == "2UN6-1"
    assert envelope["data"]["lifecycle"] == "completed"
    assert envelope["data"]["records"] == [{"seq": "1", "name": "합성 조건 A"}, {"seq": "2", "name": "합성 조건 B"}, {"seq": "3", "name": "합성 조건 C"}]
    assert any(s["value"] == "합성 조건 A" for s in envelope["surface_contract"]["slot_values"])
    values = {s['slot_id']: s['value'] for s in envelope['surface_contract']['slot_values']}
    assert values['s033'] == '3'
    assert not ({'s047', 's058', 's069', 's126', 's129', 's132'} & values.keys())
    with pytest.raises(PlanAlreadyUsedError):
        await render(f)
    assert len(f[2].calls) == 1


@pytest.mark.asyncio
async def test_one_shot_search_uses_saved_sequence_and_preserves_real_zero_values():
    f = fixture("ka10172", {"trnm": "CNSRREQ", "seq": "42", "search_type": "0", "stex_tp": "K"},
                {"return_code": 0, "trnm": "CNSRREQ", "seq": "42", "data": [
                    {"9001": "A100001", "302": "합성 종목", "10": "123", "13": "0"}]}, "inline")
    reply = json.loads((await render(f)).body)
    envelope = reply["envelope"]
    assert reply["status"] == "rendered"
    assert envelope["surface_contract"]["board_id"] == "2UN6-1"
    assert envelope["data"]["records"][0]["13"] == "0"
    assert envelope["raw_data"]["data"][0]["302"] == "합성 종목"
    values = {s['slot_id']: s['value'] for s in envelope['surface_contract']['slot_values']}
    assert values['s045'] == '합성 종목'
    assert values['s051'] == '123'
    assert not ({'s125', 's128', 's131'} & values.keys())
    assert f[2].calls == [("ka10172", {"trnm": "CNSRREQ", "seq": "42", "search_type": "0", "stex_tp": "K"})]


@pytest.mark.asyncio
@pytest.mark.parametrize(("operation", "arguments"), [
    ("ka10171", {"trnm": "REG"}),
    ("ka10172", {"trnm": "CNSRREQ", "seq": "1", "search_type": "1", "stex_tp": "K"}),
    ("ka10173", {"trnm": "CNSRREQ", "seq": "1", "search_type": "1", "stex_tp": "K"}),
    ("ka10174", {"trnm": "CNSRCLR", "seq": "1"}),
])
async def test_subscription_and_mismatched_commands_remain_blocked_before_dispatch(operation, arguments):
    f = fixture(operation, arguments)
    with pytest.raises(QueryPlanRequiredError):
        await render(f)
    assert not f[2].calls
    assert f[1].app.state.canvas_events.empty()


@pytest.mark.asyncio
async def test_condition_business_error_is_not_an_empty_successful_card():
    f = fixture(body={"return_code": 1234, "return_msg": "private synthetic detail", "trnm": "CNSRLST"})
    with pytest.raises(KiwoomApiError) as failure:
        await render(f)
    assert failure.value.code == "1234"
    assert "private synthetic detail" not in str(failure.value)
    assert f[1].app.state.canvas_events.empty()
    with pytest.raises(PlanAlreadyUsedError):
        await render(f)


@pytest.mark.asyncio
async def test_empty_saved_condition_list_is_an_honest_empty_result():
    f = fixture()
    await render(f)
    envelope = f[1].app.state.canvas_events.get_nowait()
    assert envelope["data"]["records"] == []
    assert not envelope["surface_contract"]["slot_values"]


@pytest.mark.asyncio
async def test_all_saved_conditions_are_preserved_beyond_surface_and_legacy_record_limits():
    rows = [[str(i), f"합성 조건 {i}"] for i in range(63)]
    f = fixture(body={"return_code": 0, "trnm": "CNSRLST", "data": rows})
    receipt = json.loads((await render(f)).body)["receipt"]
    envelope = f[1].app.state.canvas_events.get_nowait()
    assert len(envelope["data"]["records"]) == 63
    assert envelope["data"]["records"][-1] == {"seq": "62", "name": "합성 조건 62"}
    assert receipt["trimmed"] is False


@pytest.mark.asyncio
async def test_http_render_query_injects_ws_client_without_requiring_rest_service():
    selector, request, client, payload = fixture()
    app = request.app
    install_exception_handlers(app)
    app.include_router(router)
    app.dependency_overrides.update({
        get_kiwoom_client: lambda: None,
        get_kiwoom_ws_client: lambda: client,
        get_selector_service: lambda: selector,
        resolve_account_alias: lambda: "",
    })
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://synthetic") as http:
        reply = await http.post("/api/v1/canvas/render-query", json=payload.model_dump())
    assert reply.status_code == 200
    assert reply.json()["receipt"]["pushed"] is True
    assert len(client.calls) == 1


@pytest.mark.asyncio
async def test_different_condition_sequence_cannot_be_presented_as_requested_result():
    f = fixture("ka10172", {"trnm": "CNSRREQ", "seq": "42", "search_type": "0", "stex_tp": "K"},
                {"return_code": 0, "trnm": "CNSRREQ", "seq": "43", "data": []})
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as failure:
        await render(f)
    assert failure.value.status_code == 502
    assert f[1].app.state.canvas_events.empty()


@pytest.mark.asyncio
@pytest.mark.parametrize(("operation", "error"), [("kt10000", OrderTicketRequiredError), ("0B", QueryPlanRequiredError)])
async def test_order_and_general_realtime_plans_keep_the_existing_preexecution_guard(operation, error):
    f = fixture(operation, {"trnm": "REG"})
    with pytest.raises(error):
        await render(f)
    assert not f[2].calls
    assert f[1].app.state.canvas_events.empty()


@pytest.mark.parametrize("intent", ["auto", "query"])
def test_discovery_exposes_only_the_two_read_only_condition_operations(intent):
    selector = fixture()[0]
    visible = selector.catalog.visible_for(DiscoveryIntent(intent))
    assert {doc.operation_ref for doc in visible if doc.kind == "websocket"} == {
        "base:ka10171", "base:ka10172",
    }
    for ref in ("base:ka10171", "base:ka10172"):
        description = selector.describe(DescribeRequest(operation_ref=ref, intent=intent))
        assert description.kind == "websocket"
        assert description.generic_callable
        assert description.execution_policy == "selector_query"
        hit = selector.search(SearchRequest(query=ref, intent=intent)).results[0]
        assert hit.operation_ref == ref and not hit.discovery_only
    for ref in ("base:ka10173", "base:ka10174", "base:0B", "base:kt10000"):
        with pytest.raises(OperationNotFoundError):
            selector.describe(DescribeRequest(operation_ref=ref, intent=intent))
        with pytest.raises(OperationNotFoundError):
            selector.resolve(ResolveRequest(question=ref, intent=intent, arguments={}))


@pytest.mark.asyncio
@pytest.mark.parametrize("intent", ["auto", "query"])
@pytest.mark.parametrize(("operation", "question", "arguments", "body"), [
    ("ka10171", "조건검색 목록 조회", {"trnm": "CNSRLST"},
     {"return_code": 0, "trnm": "CNSRLST", "data": [["1", "합성 조건"]]}),
    ("ka10172", "base:ka10172", {"trnm": "CNSRREQ", "seq": "1", "search_type": "0", "stex_tp": "K"},
     {"return_code": 0, "trnm": "CNSRREQ", "seq": "1", "data": []}),
    ("ka10172", "0번 조건검색 1회 조회", {"trnm": "CNSRREQ", "seq": "0", "search_type": "0", "stex_tp": "K"},
     {"return_code": 0, "trnm": "CNSRREQ", "seq": "0", "data": []}),
    ("ka10172", "0번 조건검색 일반 조회", {"trnm": "CNSRREQ", "seq": "0", "search_type": "0", "stex_tp": "K"},
     {"return_code": 0, "trnm": "CNSRREQ", "seq": "0", "data": []}),
])
async def test_read_discovery_resolve_and_signed_canvas_delivery(intent, operation, question, arguments, body):
    selector, request, client, payload = fixture(operation, arguments, body)
    resolved = selector.resolve(ResolveRequest(question=question, intent=intent, arguments=arguments))
    assert resolved.operation_ref == f"base:{operation}"
    payload = payload.model_copy(update={"plan_token": resolved.plan_token})
    await render((selector, request, client, payload))
    assert client.calls == [(operation, arguments)]
    assert request.app.state.canvas_events.get_nowait()["surface_contract"]["board_id"] == "2UN6-1"
    with pytest.raises(PlanAlreadyUsedError):
        await render((selector, request, client, payload))


@pytest.mark.parametrize("intent", ["auto", "query"])
@pytest.mark.parametrize(("operation", "arguments"), [
    ("ka10171", {"trnm": "REG"}),
    ("ka10171", {"trnm": "CNSRCLR"}),
    ("ka10172", {"trnm": "CNSRREQ", "seq": "1", "search_type": "1", "stex_tp": "K"}),
    ("ka10172", {"trnm": "REMOVE", "seq": "1", "search_type": "0", "stex_tp": "K"}),
])
def test_read_intent_cannot_sign_condition_registration_or_removal(intent, operation, arguments):
    selector = fixture()[0]
    with pytest.raises(InvalidArgumentsError):
        selector.resolve(ResolveRequest(question=f"base:{operation}", intent=intent, arguments=arguments))


@pytest.mark.parametrize("question", [
    "0번 조건검색 1회 조회 후 실시간 감시 등록",
    "0번 조건검색 1회 조회 후 실시간 감시 해제",
    "0번 조건검색 1회 조회 후 중지",
    "0번 조건검색 1회 조회 후 종료",
    "0번 조건검색 1회 조회 후 취소",
    "조건검색 run once then stop",
    "조건검색 run once then end",
])
def test_one_shot_words_do_not_turn_monitoring_requests_into_read_queries(question):
    selector = fixture()[0]
    with pytest.raises(NoConfidentMatchError):
        selector.resolve(ResolveRequest(question=question, intent="query", arguments={
            "trnm": "CNSRREQ", "seq": "0", "search_type": "0", "stex_tp": "K",
        }))
