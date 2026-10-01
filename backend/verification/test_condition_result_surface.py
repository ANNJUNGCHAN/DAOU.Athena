"""One successful read can open its authored watchlist view without another command."""

import json

import pytest

from test_condition_query_delivery import fixture, render


@pytest.mark.asyncio
async def test_one_shot_seeds_both_views_from_the_same_response():
    arguments = {"trnm": "CNSRREQ", "seq": "42", "search_type": "0", "stex_tp": "K"}
    f = fixture("ka10172", arguments, {
        "return_code": 0, "trnm": "CNSRREQ", "seq": "42", "data": [
            {"9001": "A100001", "302": "첫 합성 종목", "10": "123", "13": "0"},
            {"9001": "A100002", "302": "둘째 합성 종목", "10": "456", "13": "7"},
        ],
    }, "inline")
    envelope = json.loads((await render(f)).body)["envelope"]
    assert envelope["surface_contract"]["board_id"] == "2UN6-1"
    alternate = envelope["initial_surface_contract"]
    assert alternate["board_id"] == "15L8-2"
    values = {slot["slot_id"]: slot["value"] for slot in alternate["slot_values"]}
    assert [values[key] for key in ("s013", "s014", "s016")] == ["첫 합성 종목", "A100001", "123"]
    assert [values[key] for key in ("s023", "s024", "s026")] == ["둘째 합성 종목", "A100002", "456"]
    assert alternate["hydration_slot_ids"] == []
    assert f[2].calls == [("ka10172", arguments)]


@pytest.mark.asyncio
async def test_saved_formula_list_does_not_claim_to_have_matching_stocks():
    f = fixture(delivery="inline")
    envelope = json.loads((await render(f)).body)["envelope"]
    assert "initial_surface_contract" not in envelope


@pytest.mark.asyncio
async def test_empty_one_shot_keeps_an_empty_alternate_result():
    f = fixture("ka10172", {"trnm": "CNSRREQ", "seq": "42", "search_type": "0", "stex_tp": "K"},
                {"return_code": 0, "trnm": "CNSRREQ", "seq": "42", "data": []}, "inline")
    envelope = json.loads((await render(f)).body)["envelope"]
    alternate = envelope["initial_surface_contract"]
    assert alternate["slot_values"] == []
    assert alternate["hydration_slot_ids"] == []
    assert len(f[2].calls) == 1
