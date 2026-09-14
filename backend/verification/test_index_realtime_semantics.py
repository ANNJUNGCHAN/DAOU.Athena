from __future__ import annotations

from athena_api.api.canvas_push import (
    _integrated_card_contract,
    _internal_realtime_binding_contract,
)
from athena_api.semantic_presentation_registry import get_semantic_presentation_registry

INDEX_CHART_EXPECTED_ALIASES = {
    "base:ka20004": {"cur_prc": "10", "pred_pre": "11", "pred_pre_sig": "25"},
    "base:ka20005": {"cur_prc": "10", "pred_pre": "11", "pred_pre_sig": "25"},
    "base:ka20006": {"cur_prc": "10"},
    "base:ka20007": {"cur_prc": "10"},
    "base:ka20008": {"cur_prc": "10"},
    "base:ka20019": {"cur_prc": "10"},
}
DOMESTIC_GOLD_CHART_OPERATIONS = (
    "base:ka50079",
    "base:ka50080",
    "base:ka50081",
    "base:ka50082",
    "base:ka50083",
    "base:ka50091",
    "base:ka50092",
)


def _semantic_keys(operation_ref: str) -> dict[tuple[str, int | None], str]:
    return {
        (contract.concept_id, contract.display_slot): contract.alias
        for contract in get_semantic_presentation_registry().for_operation(operation_ref)
        if contract.concept_id is not None
    }


def _card_binding_ids(operation_ref: str) -> set[str]:
    card = _integrated_card_contract(operation_ref)
    return {
        field["realtime_binding_id"]
        for section in card["presentation_contract"]["sections"]
        for field in section["fields"]
    }


def test_index_chart_snapshots_join_only_index_realtime_semantics() -> None:
    stock_keys = _semantic_keys("base:0B")

    for chart_operation, expected_aliases in INDEX_CHART_EXPECTED_ALIASES.items():
        chart_keys = _semantic_keys(chart_operation)
        assert chart_keys.keys().isdisjoint(stock_keys.keys())

        for realtime_operation in ("base:0J", "base:0U"):
            realtime_keys = _semantic_keys(realtime_operation)
            joined = chart_keys.keys() & realtime_keys.keys()
            assert {
                chart_keys[key]: realtime_keys[key]
                for key in joined
            } == expected_aliases


def test_index_price_binding_preserves_broker_scale_without_stock_currency_unit() -> None:
    registry = get_semantic_presentation_registry()

    for operation_ref, alias in (
        *((operation_ref, "cur_prc") for operation_ref in INDEX_CHART_EXPECTED_ALIASES),
        ("base:0J", "10"),
        ("base:0U", "10"),
    ):
        contract = next(
            item
            for item in registry.for_operation(operation_ref)
            if item.alias == alias
        )
        assert contract.unit_or_format == "source-defined-number-or-text"
        assert contract.display_metadata is None


def test_index_card_binding_ids_accept_index_ticks_and_reject_stock_ticks() -> None:
    for chart_operation, expected_aliases in INDEX_CHART_EXPECTED_ALIASES.items():
        card_bindings = _card_binding_ids(chart_operation)

        for realtime_operation in ("0J", "0U"):
            source_bindings = _internal_realtime_binding_contract(realtime_operation)[
                "source_bindings"
            ]
            assert {
                alias
                for alias, descriptor in source_bindings.items()
                if descriptor["binding_id"] in card_bindings
            } == set(expected_aliases.values())

        stock_bindings = _internal_realtime_binding_contract("0B")["source_bindings"]
        assert all(
            descriptor["binding_id"] not in card_bindings
            for descriptor in stock_bindings.values()
        )


def test_domestic_gold_charts_never_gain_the_international_gold_feed() -> None:
    international_gold_keys = _semantic_keys("base:0I")
    stock_keys = _semantic_keys("base:0B")

    for operation_ref in DOMESTIC_GOLD_CHART_OPERATIONS:
        chart_keys = _semantic_keys(operation_ref)
        assert chart_keys.keys().isdisjoint(international_gold_keys.keys())

    # The generic semantic catalog still overlaps domestic gold and stock fields,
    # so the product policy must keep rejecting 0B rather than relying on this join.
    assert _semantic_keys("base:ka50092").keys() & stock_keys.keys()

    domestic_rest_card = _integrated_card_contract("base:ka50092")
    assert domestic_rest_card["card_id"] == "CC-03"
    assert domestic_rest_card["capability_id"] == "chart"
    assert "base:ka50092" in domestic_rest_card["operation_refs"]
