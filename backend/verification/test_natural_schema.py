"""Compiled schema boundaries, provenance binding and actual adapter contract."""

from copy import deepcopy

import pytest

from athena_api.backtest.natural_schema import (
    draft_json_schema,
    question_references,
    render_question,
    seal_schema,
    validate_schema,
)


def draft():
    return {
        "title": "가격·거래량 진입과 보유 중 청산",
        "explanation": "종가가 105 초과이고 거래량이 1500 이상이면 진입합니다. "
        "보유 중 종가가 100 이하이거나 거래량이 1500 미만이면 청산합니다.",
        "required_observations": ["close", "volume"],
        "flat": {
            "type": "choice",
            "instructions": "Enter iff {close} > 105 AND {volume} >= 1500; otherwise wait.",
            "criteria": {"enter": "Enter", "wait": "Wait"},
        },
        "holding": {
            "type": "choice",
            "instructions": "Exit iff {close} <= 100 OR {volume} < 1500; otherwise hold.",
            "criteria": {"exit": "Exit", "hold": "Hold"},
        },
    }


def sealed():
    return seal_schema(
        draft(), "가격·거래량 조건으로 모의 거래", {"provider": "test", "model": "fixture"}
    )


def test_schema_seals_exact_source_and_actual_author_without_aliases():
    data = draft()
    author = {"provider": "actual-provider", "model": "actual-model"}
    source = "  원래 사용자 조건  "
    schema = seal_schema(data, source, author)
    author["model"] = "changed"
    data["flat"]["instructions"] = "changed"
    assert schema["source_text"] == source
    assert schema["author"]["model"] == "actual-model"
    assert validate_schema(schema, source) == schema
    assert len(schema["schema_hash"]) == 64


@pytest.mark.parametrize("field", ["source_text", "title", "explanation", "author", "flat"])
def test_schema_mutation_is_not_executable_without_resealing(field):
    schema = sealed()
    if field == "author":
        schema[field]["model"] = "other-model"
    elif field == "flat":
        schema[field]["instructions"] = "Enter if {close} > 1 AND {volume} > 1; otherwise wait."
    else:
        schema[field] += "changed"
    with pytest.raises(ValueError, match="hash mismatch"):
        validate_schema(schema)


def test_source_binding_rejects_reusing_confirmed_schema_for_different_strategy():
    with pytest.raises(ValueError, match="source_text"):
        validate_schema(sealed(), "새로운 전략")


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.update(code="arbitrary Python is not a schema field"),
        lambda d: d.update(observations={"close": 999}),
        lambda d: d.update(author={"provider": "invented", "model": "invented"}),
        lambda d: d["flat"].update(type="noul"),
        lambda d: d["flat"]["criteria"].update(exit="Exit"),
        lambda d: d["flat"].update(instructions="Enter if {future_close} > 105; otherwise wait."),
        lambda d: d["flat"].update(instructions="Enter if {close.real} > 105; otherwise wait."),
        lambda d: d["flat"].update(instructions="Enter if {close} > 105. {volume} <mask>"),
        lambda d: d.update(required_observations=["close", "volume", "close"]),
        lambda d: d.update(required_observations=["close"]),
    ],
)
def test_rejects_code_fields_fabricated_values_unknown_metrics_and_invalid_actions(mutate):
    data = draft()
    mutate(data)
    with pytest.raises(ValueError):
        seal_schema(data, "source", {"provider": "test", "model": "fixture"})


def test_authored_and_rendered_text_exceeding_budget_is_rejected_without_clipping():
    data = draft()
    data["flat"]["instructions"] = "조건" * 60 + "{close} {volume}"
    with pytest.raises(ValueError, match="shorten"):
        seal_schema(data, "source", {"provider": "test", "model": "fixture"})
    data = draft()
    data["flat"]["criteria"]["enter"] = "조건을모두확인한뒤진입하세요" * 3
    with pytest.raises(ValueError, match=r"criteria\.enter: 134 UTF-8 bytes exceeds 44"):
        seal_schema(data, "source", {"provider": "test", "model": "fixture"})
    question = deepcopy(draft()["flat"])
    question["instructions"] = "a" * 310 + "{close}"
    with pytest.raises(ValueError, match="rendered question"):
        render_question(question, {"close": 1.7976931348623157e308})


def test_template_substitution_preserves_numeric_boundary_and_does_not_evaluate_conditions():
    question = draft()["flat"]
    rendered = render_question(question, {"close": 100.000000001, "volume": 1500})
    assert "100.000000001 > 105 AND 1500 >= 1500" in rendered["instructions"]
    assert rendered["criteria"] == {"enter": "Enter", "wait": "Wait"}
    assert question_references(question) == {"close", "volume"}


def test_draft_contract_does_not_allow_authored_provenance_or_observation_values():
    contract = draft_json_schema()
    assert contract["additionalProperties"] is False
    assert set(contract["properties"]) == {
        "title",
        "explanation",
        "required_observations",
        "flat",
        "holding",
    }
    assert "future_close" not in contract["properties"]["required_observations"]["items"]["enum"]


def test_constant_passive_questions_need_no_invented_observation():
    data = draft()
    data["required_observations"] = []
    data["flat"]["instructions"] = "Always wait."
    data["holding"]["instructions"] = "Always hold."
    assert validate_schema(
        seal_schema(data, "관망만 하세요", {"provider": "test", "model": "fixture"})
    )
