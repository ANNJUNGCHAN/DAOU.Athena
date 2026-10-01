"""Contract and safety failures around an actual-model simulation adapter."""

import json
from copy import deepcopy
from http.client import IncompleteRead
from urllib.error import URLError

import pytest

from athena_api.backtest.natural_evaluate import condition_cases, evaluate
from athena_api.backtest.natural_laya import (
    MAX_LEN,
    MODEL_ID,
    REVISION,
    STATE_BYTE_BUDGET,
    NaturalLayaClient,
)
from athena_api.backtest.natural_schema import seal_schema


def request():
    return deepcopy(condition_cases()[0]["request"])


def response(action="enter", probability=0.9):
    return {
        "answers": {
            "action": {
                "type": "choice",
                "choice": action,
                "probabilities": {"enter": probability, "wait": 1 - probability},
                "answer_confidence": probability if action == "enter" else 1 - probability,
                "confidence": 0.1,
            }
        },
        "usage": {"input_tokens": 200, "output_tokens": 0},
        "runtime": {"model_id": MODEL_ID, "revision": REVISION, "device": "cuda"},
    }


def client_with(value):
    client = NaturalLayaClient()
    client._request = lambda payload=None: deepcopy(value)
    return client


def test_valid_choice_uses_answer_probability_and_preserves_audit():
    result = client_with(response())(request())
    assert result["action"] == "enter"
    assert result["answer_confidence"] == 0.9
    assert result["raw"]["response"]["answers"]["action"]["confidence"] == 0.1
    assert result["raw"]["request"]["state"]["strategy"] == request()["strategy"]
    assert len(result["raw"]["request_sha256"]) == 64


@pytest.mark.parametrize(
    "url",
    [
        "https://127.0.0.1:8768",
        "http://example.com",
        "http://127.0.0.1.evil.test",
        "http://user@127.0.0.1:8768",
        "http://127.0.0.1:8768/predict",
        "http://127.0.0.1:8768?forward=remote",
    ],
)
def test_rejects_nonlocal_or_ambiguous_endpoint(url):
    with pytest.raises(ValueError):
        NaturalLayaClient(url)


def test_low_probability_keeps_raw_choice_for_evaluation():
    result = client_with(response(probability=0.6))(request())
    assert result["action"] is None
    assert result["raw_action"] == "enter"
    assert result["fallback_reason"] == "probability_below_policy_floor"


def test_tie_is_ambiguous_even_when_floor_disabled():
    client = client_with(response(probability=0.5))
    client.min_answer_probability = 0
    result = client(request())
    assert result["action"] is None
    assert result["fallback_reason"] == "ambiguous_choice"


@pytest.mark.parametrize(
    "mutation",
    [
        lambda r: r["answers"]["action"].update(type="noul", noul=0.9),
        lambda r: r["answers"]["action"].update(choice="exit"),
        lambda r: r["answers"]["action"].update(answer_confidence=True),
        lambda r: r["answers"]["action"].update(answer_confidence=0.5),
        lambda r: r["answers"]["action"]["probabilities"].update(enter=float("nan")),
        lambda r: r["answers"]["action"]["probabilities"].update(wait=0.9),
        lambda r: r["usage"].update(input_tokens=MAX_LEN),
        lambda r: r["usage"].update(options={"action": {"distinct": 1}}),
        lambda r: r["runtime"].update(revision="unknown"),
    ],
)
def test_malformed_or_truncated_output_never_executes(mutation):
    value = response()
    mutation(value)
    result = client_with(value)(request())
    assert result["action"] is None
    assert result["fallback_reason"]


@pytest.mark.parametrize("error", [URLError("unavailable"), IncompleteRead(b"partial")])
def test_server_failure_is_recorded_without_exception(error):
    client = NaturalLayaClient()

    def fail(payload=None):
        raise error

    client._request = fail
    result = client(request())
    assert result["action"] is None
    assert result["fallback_reason"] == "server_unavailable_or_invalid_json"


def test_bounded_window_preserves_strategy_and_computes_past_only_indicators():
    item = request()
    item["observations"] = [
        {**item["observations"][0], "dt": f"2025-01-{day:02}", "close": day} for day in range(1, 26)
    ]
    item["as_of"] = "2025-01-25"
    payload = NaturalLayaClient().build_payload(item)
    state = payload["state"]
    assert state["strategy"] == item["strategy"]
    assert state["observations"][-1]["dt"] == item["as_of"]
    assert state["indicators"]["sma_5"] == 23
    assert state["indicators"]["sma_20"] == 15.5
    assert len(state["observations"]) <= 20
    assert state["observation_window"]["shown"] == len(state["observations"])
    assert len(json.dumps(state, ensure_ascii=False).encode("utf-8")) <= STATE_BYTE_BUDGET


def test_future_bar_and_oversize_strategy_fail_before_network():
    client = NaturalLayaClient()
    client._request = lambda payload=None: pytest.fail("invalid input reached server")
    item = request()
    item["observations"][0]["dt"] = "2026-01-01"
    assert "future_observation" in client(item)["fallback_reason"]
    item = request()
    item["strategy"] = "한글" * 2000
    assert "input_budget_exceeded" in client(item)["fallback_reason"]


def test_evaluator_never_leaks_labels_and_does_not_hide_passive_baseline():
    class PassiveClient:
        def identity(self):
            return {"status": "fixture"}

        def __call__(self, item):
            assert "expected" not in item
            return {"action": None, "raw_action": None, "fallback_reason": "fixture"}

    report = evaluate(PassiveClient(), repeats=2)
    assert report["summary"]["count"] == len(condition_cases()) * 4
    assert report["summary"]["raw_accuracy"] == 0
    assert report["summary"]["coverage"] == 0
    assert report["summary"]["accepted_accuracy"] == report["summary"]["always_passive_accuracy"]
    assert report["option_order"]["pairs"] == len(condition_cases()) * 2


def compiled_request():
    item = request()
    item["decision_schema"] = seal_schema(
        {
            "title": "Compiled fixture",
            "explanation": "Only the active question needs its inputs.",
            "required_observations": ["close", "volume", "sma_20", "unrealized_return_pct"],
            "flat": {
                "type": "choice",
                "instructions": "Enter iff {close} > 100 AND {volume} > 1000; otherwise wait.",
                "criteria": {"enter": "Enter", "wait": "Wait"},
            },
            "holding": {
                "type": "choice",
                "instructions": "Exit iff {unrealized_return_pct} < -5 "
                "OR {close} < {sma_20}; otherwise hold.",
                "criteria": {"exit": "Exit", "hold": "Hold"},
            },
        },
        item["strategy"],
        {"provider": "test", "model": "fixture"},
    )
    return item


def test_compiled_flat_uses_only_referenced_values_without_holding_warmup():
    item = compiled_request()
    result = client_with(response())(item)
    assert result["action"] == "enter"
    audit = result["raw"]
    assert audit["decision_schema"] == item["decision_schema"]
    payload = audit["request"]
    assert payload["head_max_len"] == 512
    assert payload["state"]["observations"] == {"close": 101, "volume": 1001}
    assert "101 > 100 AND 1001 > 1000" in payload["questions"]["action"]["instructions"]
    assert "strategy" not in payload["state"]


def test_compiled_holding_waits_for_required_warmup_without_network():
    item = compiled_request()
    item["state"].update(holding=True, qty=10, entry_price=100)
    item["allowed_actions"] = ["exit", "hold"]
    client = NaturalLayaClient()
    client._request = lambda payload=None: pytest.fail("missing warmup must not reach model")
    result = client(item)
    assert result["action"] is None
    assert "missing_observation:sma_20" in result["fallback_reason"]
    assert result["raw"]["decision_schema"] == item["decision_schema"]


def test_compiled_holding_return_uses_executed_entry_price_and_past_mean():
    item = compiled_request()
    item["state"].update(holding=True, qty=10, entry_price=100)
    item["allowed_actions"] = ["exit", "hold"]
    item["as_of"] = "2025-01-20"
    item["observations"] = [
        {**item["observations"][0], "dt": f"2025-01-{day:02}", "close": 90} for day in range(1, 21)
    ]
    state = NaturalLayaClient().build_payload(item)["state"]
    assert state["observations"]["unrealized_return_pct"] == pytest.approx(-10)
    assert state["observations"]["sma_20"] == 90


def test_compiled_schema_tamper_and_source_mismatch_fail_before_network():
    client = NaturalLayaClient()
    client._request = lambda payload=None: pytest.fail("unconfirmed schema reached model")
    item = compiled_request()
    item["decision_schema"]["flat"]["instructions"] = "Enter if {close} > 1 AND {volume} > 1."
    assert "hash mismatch" in client(item)["fallback_reason"]
    item = compiled_request()
    item["strategy"] = "different strategy"
    assert "source_text" in client(item)["fallback_reason"]
