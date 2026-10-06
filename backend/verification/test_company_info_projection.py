"""Company query cards preserve upstream extras without displaying internal fields."""

import asyncio
import json

import pytest
from fastapi import FastAPI, Request, Response

from athena_api.api.canvas_push import RenderPlanRequest, canvas_render_plan
from athena_api.kiwoom import ResponseEnvelope
from athena_api.selector.catalog import build_operation_catalog
from athena_api.selector.plans import PlanSigner
from athena_api.selector.service import SelectorService


async def render_company(delivery, extra_field="kind"):
    catalog = build_operation_catalog()
    document = catalog.find_exact("base:ka10100")
    signer = PlanSigner(b"synthetic-company-info-projection-test-key")
    selector = SelectorService(catalog, signer)
    token, _ = signer.issue(
        catalog=catalog,
        document=document,
        arguments={"stk_cd": "100001"},
        question="합성 기업 정보",
    )
    source = {
        "code": "100001",
        "name": "합성 기업",
        "listCount": "1000000",
        "auditInfo": "정상",
        "regDay": "20000101",
        "lastPrice": "12340",
        "state": "정상",
        "marketCode": "0",
        "marketName": "거래소",
        "upName": "합성 업종",
        "upSizeName": "대형주",
        "companyClassName": "",
        "orderWarning": "0",
        "nxtEnable": "Y",
        extra_field: "synthetic-internal-value",
        "return_code": 0,
        "return_msg": "정상 처리",
    }

    class Client:
        async def post_with_headers(self, tr_id, upstream_path, arguments, options):
            assert tr_id == "ka10100"
            assert arguments == {"stk_cd": "100001"}
            return ResponseEnvelope(body=source, cont_yn="N", next_key=None)

    app = FastAPI()
    app.state.canvas_events = asyncio.Queue()
    request = Request({"type": "http", "headers": [], "app": app})
    response = await canvas_render_plan(
        RenderPlanRequest(plan_token=token, delivery=delivery),
        request, Response(), Client(), None, None, selector, "",
    )
    return response, app.state.canvas_events, source


@pytest.mark.asyncio
@pytest.mark.parametrize("delivery", ["inline", "side_channel"])
async def test_company_with_undocumented_kind_renders_and_preserves_source(delivery):
    response, queue, source = await render_company(delivery)
    body = json.loads(response.body)
    assert response.status_code == 200, body
    envelope = body["envelope"] if delivery == "inline" else queue.get_nowait()
    fields = {field["key"]: field for field in envelope["data"]["fields"]}
    assert "kind" not in fields
    assert fields["name"]["value"] == "합성 기업"
    assert fields["name"]["label"] == "종목명"
    assert fields["code"]["value"] == "100001"
    assert fields["lastPrice"]["value"] == "12340"
    assert envelope["raw_data"]["kind"] == "synthetic-internal-value"
    assert envelope["source_data"]["data"]["kind"] == "synthetic-internal-value"
    assert source["kind"] == "synthetic-internal-value"


@pytest.mark.asyncio
async def test_company_unreviewed_field_still_rejects_without_delivering_card():
    response, queue, _ = await render_company("side_channel", "unreviewed_fixture_field")
    body = json.loads(response.body)
    assert response.status_code == 422
    assert body["code"] == "CANVAS_COVERAGE_MISSING"
    assert "unreviewed_fixture_field" in body["detail"]
    assert queue.empty()
