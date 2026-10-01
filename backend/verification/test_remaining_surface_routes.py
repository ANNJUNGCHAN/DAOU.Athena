"""Public quote discovery regressions, without an account or upstream request."""

import pytest

from athena_api.selector.catalog import build_operation_catalog
from athena_api.selector.plans import PlanSigner
from athena_api.selector.schemas import ResolveRequest
from athena_api.selector.service import SelectorService
from athena_api.selector.errors import SelectorError


@pytest.fixture(scope="module")
def selector():
    return SelectorService(build_operation_catalog(), PlanSigner(b"synthetic-surface-route-key"))


@pytest.mark.parametrize("question", [
    "신주인수권 전체시세", "신주인수권 전체 시세", "신주인수권 시세 전체 조회",
])
def test_subscription_right_quotes_have_their_own_product_scope(selector, question):
    result = selector.resolve(ResolveRequest(question=question, intent="query", arguments={"newstk_recvrht_tp": "00"}))
    assert result.operation_ref == "base:ka10011"


@pytest.mark.parametrize("question", ["금 99.99K 금현물 호가", "금 99.99_1kg 호가"])
def test_concrete_gold_orderbook_is_distinct_from_gold_executions(selector, question):
    result = selector.resolve(ResolveRequest(question=question, intent="query", arguments={"stk_cd": "M04020000", "tic_scope": "1"}))
    assert result.operation_ref == "base:ka50101"


def test_sector_constituent_minimum_routes_to_the_authored_sector_surface(selector):
    result = selector.resolve(ResolveRequest(question="코스피 업종 구성 종목", intent="query", arguments={
        "mrkt_tp": "0", "inds_cd": "001", "stex_tp": "1",
    }))
    assert result.operation_ref == "base:ka20002"


@pytest.mark.parametrize("question", ["금현물 호가", "신주인수권 10주 매수 주문"])
def test_missing_gold_identity_and_order_actions_do_not_become_quote_reads(selector, question):
    with pytest.raises(SelectorError):
        selector.resolve(ResolveRequest(question=question, intent="query", arguments={}))
