from athena_api.canvas_vi_snapshot import vi_snapshot_surface
import asyncio
import json

import pytest
from fastapi import FastAPI, Request, Response
from athena_api.api.canvas_push import RenderPlanRequest, canvas_render_query
from test_selector_business_result import fixture


def test_vi_snapshot_uses_three_distinct_rows_without_inventing_index_or_status():
    source = {"motn_stk": [
        {"stk_cd": "100001", "stk_nm": "합성 첫째", "motn_pric": "111", "viaplc_tp": "1", "static_dispty_rt": "1.23"},
        {"stk_cd": "100002", "stk_nm": "합성 둘째", "motn_pric": "222", "viaplc_tp": "2", "dynm_dispty_rt": "0"},
        {"stk_cd": "100003", "stk_nm": "합성 셋째", "motn_pric": "333", "viaplc_tp": "1", "static_dispty_rt": "-3.45", "virelis_time": "101010"},
    ]}
    contract = vi_snapshot_surface("base:ka10054", source)
    values = {slot["slot_id"]:slot["value"] for slot in contract["slot_values"]}
    assert [values[x] for x in ["s043","s051","s059"]] == ["합성 첫째","합성 둘째","합성 셋째"]
    assert [values[x] for x in ["s047","s055","s063"]] == ["111","222","333"]
    assert values["s056"] == "0" and values["s066"] == "101010"
    assert not set(values).intersection({"s006","s009","s049","s050","s057","s058","s065","s070"})
    assert contract["hydration_slot_ids"] == []


def test_empty_vi_response_does_not_reuse_specimen_values_or_issue_queries():
    contract = vi_snapshot_surface("base:ka10054", {"motn_stk": []})
    assert contract["slot_values"] == []
    assert contract["hydration_slot_ids"] == []
    assert vi_snapshot_surface("base:ka10030", {"motn_stk": []}) is None
    assert vi_snapshot_surface("base:ka10054", {}) is None


def test_missing_middle_value_does_not_shift_the_next_instrument():
    source = {"motn_stk": [{"stk_nm":"first","motn_pric":"111"}, {"stk_nm":"second"}, {"stk_nm":"third","motn_pric":"333"}]}
    values = {slot["slot_id"]:slot["value"] for slot in vi_snapshot_surface("base:ka10054",source)["slot_values"]}
    assert "s055" not in values
    assert values["s063"] == "333"


@pytest.mark.asyncio
async def test_signed_vi_read_keeps_the_existing_entry_and_seeds_the_alternate_once():
    selector, call, client = fixture({"return_code": 0, "motn_stk": [
        {"stk_cd": "100001", "stk_nm": "첫 합성 종목", "motn_pric": "111"},
        {"stk_cd": "100002", "stk_nm": "둘째 합성 종목", "motn_pric": "222"},
    ]})
    client.is_ready = True
    app = FastAPI()
    app.state.canvas_events = asyncio.Queue()
    request = Request({"type": "http", "headers": [], "app": app})
    response = await canvas_render_query(
        RenderPlanRequest(plan_token=call.plan_token, delivery="inline"),
        request, Response(), client, selector, "",
    )
    payload = json.loads(response.body)
    assert payload["status"] == "rendered"
    envelope = payload["envelope"]
    assert envelope["surface_contract"]["board_id"] == "31II-0"
    assert envelope["surface_contract"]["initial_state_board"] is None
    alternate = envelope["initial_surface_contract"]
    assert alternate["board_id"] == "15R0-2"
    values = {slot["slot_id"]: slot["value"] for slot in alternate["slot_values"]}
    assert values["s043"] == "첫 합성 종목"
    assert values["s051"] == "둘째 합성 종목"
    assert alternate["hydration_slot_ids"] == []
    assert client.calls == 1
