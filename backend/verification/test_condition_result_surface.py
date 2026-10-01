"""One successful read can open its authored watchlist view without another command."""

import json
from copy import deepcopy

import pytest

from athena_api.canvas_condition_query import _condition_rate_display
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


@pytest.mark.parametrize(("price", "change", "text", "tone"), [
    ("001010", "+000010", "+1.00%", "up"),
    ("-000990", "-000010", "-1.00%", "down"),
    ("1000", "-0", "0.00%", "flat"),
    ("1999", "-1", "-0.05%", "down"),
    ("2001", "1", "+0.05%", "up"),
    ("1000000", "-1", "0.00%", "flat"),
])
def test_condition_percentage_is_calculated_not_scaled_from_the_conflicting_fid(price, change, text, tone):
    result = _condition_rate_display({"10": price, "11": change}, "009999999")
    assert result == {"value": "009999999", "display_calculation": "current_price_previous_change",
                      "text": text, "tone": tone}


@pytest.mark.parametrize(("price", "change"), [
    (None, "1"), ("", "1"), ("0", "1"), ("100", None), ("100", ""),
    ("100", "100"), ("100", "101"), ("NaN", "1"), ("100", "Infinity"),
    (True, "1"), ("100", {}), ("invalid", "1"),
])
def test_uncomputable_rate_does_not_fall_back_to_ambiguous_raw_percent(price, change):
    result = _condition_rate_display({"10": price, "11": change}, "123")
    assert result["value"] == "123"
    assert result["missing"] == "unavailable"
    assert "text" not in result


@pytest.mark.asyncio
async def test_rate_display_uses_same_row_preserves_raw_metadata_and_does_not_repeat_query():
    arguments = {"trnm": "CNSRREQ", "seq": "42", "search_type": "0", "stex_tp": "K"}
    rows = [{"9001": f"A10000{i}", "302": f"합성 종목 {i}", "10": str(1000 + i * 10),
             "11": str(i * 10), "12": str(700 + i), "13": "0"} for i in range(8)]
    rows[3].pop("11")
    rows[4]["10"] = "0"
    rows[6].pop("12")
    body = {"return_code": 0, "trnm": "CNSRREQ", "seq": "42", "data": rows}
    original = deepcopy(body)
    f = fixture("ka10172", arguments, body, "inline")
    envelope = json.loads((await render(f)).body)["envelope"]
    entries = {entry["slot_id"]: entry for entry in envelope["initial_surface_contract"]["slot_values"]}
    for i in (0, 1, 2, 5, 7):
        entry = entries[f"s{18 + i * 10:03}"]
        assert entry["value"]["text"] == (f"+{i}.00%" if i else "0.00%")
        assert entry["value"]["value"] == rows[i]["12"]
        assert entry["row_index"] == i
        assert entry["observation_id"]
        assert entry["occurrence_id"] == "base:ka10172|$.data[].12|1"
    assert entries["s048"]["value"]["missing"] == "unavailable"
    assert entries["s058"]["value"]["missing"] == "unavailable"
    assert "s078" not in entries
    assert entries["s016"]["value"] == rows[0]["10"]
    assert body == original
    assert envelope["raw_data"] == envelope["source_data"]["data"]
    for original_row, delivered_row in zip(rows, envelope["raw_data"]["data"], strict=True):
        assert {key: delivered_row[key] for key in original_row} == original_row
    assert envelope["data"]["records"][0]["13"] == "0"
    assert f[2].calls == [("ka10172", arguments)]
