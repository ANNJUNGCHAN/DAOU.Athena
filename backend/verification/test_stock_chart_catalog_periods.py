"""Official stock-chart names retain period evidence without substring guessing."""

import pytest

from athena_api.routing_contract import Measure, TemporalScope
from athena_api.selector.catalog import build_operation_catalog
from athena_api.selector.errors import SelectorError
from athena_api.selector.instrument_identity import (
    InstrumentIdentityIndex,
    build_identity_snapshot,
)
from athena_api.selector.plans import PlanSigner
from athena_api.selector.query_frame import extract_query_frame
from athena_api.selector.schemas import ResolveRequest
from athena_api.selector.service import SelectorService


CHART_CASES = [
    ("주식틱차트조회요청", TemporalScope.TICK, "base:ka10079",
     {"stk_cd": "005930", "tic_scope": "1", "upd_stkpc_tp": "1"}),
    ("주식분봉차트조회요청", TemporalScope.MINUTE, "base:ka10080",
     {"stk_cd": "005930", "tic_scope": "1", "upd_stkpc_tp": "1"}),
    ("주식일봉차트조회요청", TemporalScope.DAILY, "base:ka10081",
     {"stk_cd": "005930", "base_dt": "20261007", "upd_stkpc_tp": "1"}),
    ("주식주봉차트조회요청", TemporalScope.WEEKLY, "base:ka10082",
     {"stk_cd": "005930", "base_dt": "20261007", "upd_stkpc_tp": "1"}),
    ("주식월봉차트조회요청", TemporalScope.MONTHLY, "base:ka10083",
     {"stk_cd": "005930", "base_dt": "20261007", "upd_stkpc_tp": "1"}),
    ("주식년봉차트조회요청", TemporalScope.ANNUAL, "base:ka10094",
     {"stk_cd": "005930", "base_dt": "20261007", "upd_stkpc_tp": "1"}),
]


@pytest.mark.parametrize("name,scope,operation_ref,arguments", CHART_CASES)
@pytest.mark.parametrize("question", ["{name}", "삼성전자 {name}", "삼성전자 '{name}' 보여줘"])
def test_complete_stock_chart_name_supplies_one_period(
    name, scope, operation_ref, arguments, question,
):
    assert extract_query_frame(question.format(name=name)).temporal_scopes == (scope,)


@pytest.mark.parametrize("name,scope,operation_ref,arguments", CHART_CASES)
@pytest.mark.parametrize("question", ["가상{name}", "{name}모형", "fake_{name}", "{name}_fake"])
def test_stock_chart_name_inside_an_unreviewed_word_does_not_supply_period(
    name, scope, operation_ref, arguments, question,
):
    assert extract_query_frame(question.format(name=name)).temporal_scopes == ()


def test_conflicting_complete_chart_names_preserve_both_periods():
    frame = extract_query_frame("삼성전자 주식주봉차트조회요청 주식월봉차트조회요청")
    assert frame.temporal_scopes == (TemporalScope.WEEKLY, TemporalScope.MONTHLY)


@pytest.fixture(scope="module")
def selector():
    identity = InstrumentIdentityIndex(build_identity_snapshot({
        "0": [{"code": "005930", "name": "삼성전자", "marketCode": "0"}],
        "10": [], "8": [], "3": [],
    }))
    return SelectorService(
        build_operation_catalog(),
        PlanSigner(b"synthetic-public-stock-chart-period-key"),
        instrument_identity=identity,
    )


@pytest.mark.parametrize("name,scope,operation_ref,arguments", CHART_CASES)
def test_complete_chart_name_resolves_its_period_without_a_preferred_ref(
    selector, name, scope, operation_ref, arguments,
):
    result = selector.resolve(ResolveRequest(
        question=f"삼성전자 {name}", intent="query", arguments=arguments,
    ))
    assert result.operation_ref == operation_ref


def test_natural_language_daily_chart_still_resolves(selector):
    result = selector.resolve(ResolveRequest(
        question="삼성전자 최근 3개월 일봉 차트와 거래량", intent="query",
        arguments={"stk_cd": "005930", "base_dt": "20261007", "upd_stkpc_tp": "1"},
    ))
    assert result.operation_ref == "base:ka10081"


def test_chart_without_a_period_stays_ambiguous(selector):
    with pytest.raises(SelectorError) as error:
        selector.resolve(ResolveRequest(question="삼성전자 차트", intent="query"))
    assert error.value.code == "AMBIGUOUS_OPERATION"


def test_daily_catalog_name_does_not_accept_a_monthly_preferred_ref(selector):
    with pytest.raises(SelectorError) as error:
        selector.resolve(ResolveRequest(
            question="삼성전자 주식일봉차트조회요청", intent="query",
            preferred_ref="base:ka10083",
            arguments={"stk_cd": "005930", "base_dt": "20261007", "upd_stkpc_tp": "1"},
        ))
    assert error.value.code == "PREFERRED_REF_NOT_SUPPORTED_BY_QUERY"


def test_korean_instrument_name_does_not_emit_an_embedded_lending_measure():
    assert Measure.LENDING not in extract_query_frame("현대차 일봉 차트").measures
