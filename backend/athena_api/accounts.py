"""Per-account Kiwoom runtime stacks.

Kiwoom's REST protocol has no account-number request field: an operation is attributed to
whichever account issued the bearer token it was called with. Supporting N accounts therefore
means N independent (auth, token, rate-limit, websocket) stacks, one per credential pair.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from athena_api.config import KIWOOM_MOCK_BASE_URL, OrderScope
from athena_api.kiwoom import (
    KiwoomAuth,
    KiwoomClient,
    KiwoomWsClient,
    RateLimiter,
    TokenManager,
)

ACCOUNT_HEADER = "X-Athena-Account"
ACCOUNT_QUERY_PARAM = "account"

CREDIT_ORDER_PATH = "/api/dostk/crdordr"
GOLD_ORDER_PREFIX = "kt5"

REAL_ACCOUNT_ORDER_MESSAGE = (
    "실계좌 주문은 지원하지 않습니다. 모의투자 계좌에서만 주문할 수 있습니다."
)


def is_mock_order_client(client: Any) -> bool:
    """The one authority for "orders through this client reach Kiwoom mock trading".

    Decided by the host the client actually posts to, never by an account label. Anything
    that cannot prove the mock host (no client, no base URL, any other host) counts as a
    real account, so the order path fails closed.
    """
    base_url = getattr(client, "base_url", None)
    return isinstance(base_url, str) and base_url.rstrip("/") == KIWOOM_MOCK_BASE_URL


def order_scope_for(tr_id: str, upstream_path: str) -> OrderScope:
    """Classify an order TR by the family Kiwoom routes it through."""
    if upstream_path == CREDIT_ORDER_PATH:
        return OrderScope.CREDIT
    if tr_id.startswith(GOLD_ORDER_PREFIX):
        return OrderScope.GOLD
    return OrderScope.CASH


@dataclass(slots=True)
class AccountRuntime:
    """Everything bound to one Kiwoom credential pair for the life of the process."""

    alias: str
    auth: KiwoomAuth
    token_manager: TokenManager
    # Kiwoom meters requests per app key, so the budget belongs to the account, not to the
    # process. Data, order, and websocket control frames share this one account's budget.
    rate_limiter: RateLimiter
    data_client: KiwoomClient
    order_client: KiwoomClient
    ws_client: KiwoomWsClient | None = None
    ready: bool = False
    # None means unrestricted; a set is an allowlist checked before any order leaves.
    order_scopes: frozenset[OrderScope] | None = None

    def permits_order(self, scope: OrderScope) -> bool:
        return self.order_scopes is None or scope in self.order_scopes


def account_runtimes(app: Any) -> dict[str, AccountRuntime]:
    return getattr(app.state, "kiwoom_accounts", None) or {}


def default_account_alias(app: Any) -> str | None:
    return getattr(app.state, "kiwoom_default_account", None)
