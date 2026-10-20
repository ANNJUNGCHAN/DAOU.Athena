from __future__ import annotations

import asyncio
import json
import traceback
from collections.abc import Callable
from datetime import datetime, timedelta

import httpx
import pytest

from athena_api.generated.registry import TR_REGISTRY
from athena_api.kiwoom.auth import KST
from athena_api.kiwoom.client import RequestOptions
from athena_api.kiwoom.read_auth import (
    MOCK_BASE_URL,
    REAL_BASE_URL,
    FinancialReadAuth,
    FinancialReadError,
)
from athena_api.kiwoom.read_client import MAX_RESPONSE_BYTES, FinancialReadClient

APP_CANARY = "SYNTHETIC_APP_KEY_CANARY"
SECRET_CANARY = "SYNTHETIC_SECRET_KEY_CANARY"
TOKEN_CANARY = "SYNTHETIC_TOKEN_CANARY"


def _expiry(*, seconds: int = 7200) -> str:
    return (datetime.now(KST) + timedelta(seconds=seconds)).strftime("%Y%m%d%H%M%S")


def _client(
    environment: str,
    handler: Callable[[httpx.Request], httpx.Response],
    *,
    routes: dict[str, str] | None = None,
) -> tuple[FinancialReadAuth, FinancialReadClient, httpx.AsyncClient]:
    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    auth = FinancialReadAuth(
        environment, APP_CANARY, SECRET_CANARY, client=http_client
    )
    read_client = FinancialReadClient(
        auth,
        environment,
        routes or {"ka10001": "/api/dostk/stkinfo"},
        client=http_client,
    )
    return auth, read_client, http_client


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("environment", "expected_base"),
    [("mock", MOCK_BASE_URL), ("real", REAL_BASE_URL)],
)
async def test_both_environments_use_fixed_hosts_and_exact_query_route(
    environment: str, expected_base: str
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/oauth2/token":
            token_request = json.loads(request.content)
            assert token_request == {
                "grant_type": "client_credentials",
                "appkey": APP_CANARY,
                "secretkey": SECRET_CANARY,
            }
            assert APP_CANARY not in str(request.url)
            assert SECRET_CANARY not in str(request.url)
            assert APP_CANARY not in "\n".join(
                f"{name}:{value}" for name, value in request.headers.items()
            )
            assert SECRET_CANARY not in "\n".join(
                f"{name}:{value}" for name, value in request.headers.items()
            )
            return httpx.Response(
                200,
                json={"return_code": 0, "token": TOKEN_CANARY, "expires_dt": _expiry()},
            )
        return httpx.Response(
            200,
            headers={"cont-yn": "Y", "next-key": "opaque-broker-key"},
            json={"return_code": 0, "stk_cd": "005930"},
        )

    auth, client, http_client = _client(environment, handler)
    envelope = await client.post_with_headers(
        "ka10001",
        "/api/dostk/stkinfo",
        {"stk_cd": "005930"},
        RequestOptions(cont_yn="N"),
    )
    assert envelope.body["stk_cd"] == "005930"
    assert envelope.cont_yn == "Y"
    assert envelope.next_key == "opaque-broker-key"
    assert all(str(request.url).startswith(expected_base) for request in requests)
    query_request = requests[-1]
    assert query_request.headers["api-id"] == "ka10001"
    assert query_request.headers["authorization"] == f"Bearer {TOKEN_CANARY}"
    await client.aclose()
    await auth.aclose()
    await http_client.aclose()


@pytest.mark.asyncio
async def test_parallel_ensure_token_coalesces_one_oauth_call() -> None:
    calls = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return httpx.Response(
            200,
            json={"return_code": 0, "token": TOKEN_CANARY, "expires_dt": _expiry()},
        )

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    auth = FinancialReadAuth("mock", APP_CANARY, SECRET_CANARY, client=http_client)
    tokens = await asyncio.gather(*(auth.ensure_token() for _ in range(8)))
    assert tokens == [TOKEN_CANARY] * 8
    assert calls == 1
    await auth.aclose()
    await http_client.aclose()


@pytest.mark.asyncio
async def test_cancelling_one_token_waiter_does_not_cancel_shared_issue() -> None:
    calls = 0
    release = asyncio.Event()

    async def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        await release.wait()
        return httpx.Response(
            200,
            json={"return_code": 0, "token": TOKEN_CANARY, "expires_dt": _expiry()},
        )

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    auth = FinancialReadAuth("mock", APP_CANARY, SECRET_CANARY, client=http_client)
    first = asyncio.create_task(auth.ensure_token())
    second = asyncio.create_task(auth.ensure_token())
    await asyncio.sleep(0)
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    release.set()
    assert await second == TOKEN_CANARY
    assert calls == 1
    await http_client.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("seconds", [-10, 30, 60])
async def test_expired_or_near_expiry_token_is_rejected(seconds: int) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "return_code": 0,
                "token": TOKEN_CANARY,
                "expires_dt": _expiry(seconds=seconds),
            },
        )

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    auth = FinancialReadAuth("mock", APP_CANARY, SECRET_CANARY, client=http_client)
    with pytest.raises(FinancialReadError, match="TOKEN_RESPONSE_INVALID"):
        await auth.ensure_token()
    assert not auth.is_ready
    await http_client.aclose()


@pytest.mark.asyncio
async def test_token_inside_refresh_margin_is_refreshed_once() -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(
            200,
            json={
                "return_code": 0,
                "token": f"{TOKEN_CANARY}-{calls}",
                "expires_dt": _expiry(),
            },
        )

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    auth = FinancialReadAuth("mock", APP_CANARY, SECRET_CANARY, client=http_client)
    assert await auth.ensure_token() == f"{TOKEN_CANARY}-1"
    auth._expires_at = datetime.now(KST) + timedelta(seconds=59)
    assert await auth.ensure_token() == f"{TOKEN_CANARY}-2"
    assert calls == 2
    await http_client.aclose()


def test_full_generated_query_catalog_is_accepted_and_non_queries_are_rejected() -> None:
    query_routes = {
        tr_id: spec.upstream_path
        for tr_id, spec in TR_REGISTRY.items()
        if spec.kind == "query"
    }
    auth = FinancialReadAuth("mock", APP_CANARY, SECRET_CANARY)
    client = FinancialReadClient(auth, "mock", query_routes)
    assert dict(client.allowed_routes) == query_routes
    with pytest.raises(FinancialReadError, match="READ_ROUTE_INVALID"):
        FinancialReadClient(auth, "mock", {"kt10000": TR_REGISTRY["kt10000"].upstream_path})
    with pytest.raises(FinancialReadError, match="READ_ROUTE_INVALID"):
        FinancialReadClient(auth, "mock", {"au10001": "/oauth2/token"})


@pytest.mark.asyncio
async def test_wrong_pair_and_alternate_path_fail_before_network() -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        raise AssertionError("network must not run")

    auth, client, http_client = _client("mock", handler)
    for endpoint in (
        "/api/dostk/chart",
        "https://api.kiwoom.com/api/dostk/stkinfo",
        "/api/dostk/stkinfo?x=1",
        "/api/dostk/../oauth2/token",
    ):
        with pytest.raises(FinancialReadError, match="READ_ROUTE_NOT_ALLOWED"):
            await client.post_with_headers("ka10001", endpoint, {})
    assert calls == 0
    await http_client.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [301, 302, 307, 308])
async def test_redirects_are_refused_for_oauth(status: int) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, headers={"location": "https://example.invalid"})

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    auth = FinancialReadAuth("mock", APP_CANARY, SECRET_CANARY, client=http_client)
    with pytest.raises(FinancialReadError, match="UPSTREAM_REDIRECT_REFUSED"):
        await auth.ensure_token()
    await http_client.aclose()


@pytest.mark.asyncio
async def test_redirects_are_refused_for_query_without_following_location() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if request.url.path == "/oauth2/token":
            return httpx.Response(
                200,
                json={"return_code": 0, "token": TOKEN_CANARY, "expires_dt": _expiry()},
            )
        return httpx.Response(307, headers={"location": "https://example.invalid/steal"})

    _auth, client, http_client = _client("real", handler)
    with pytest.raises(FinancialReadError, match="UPSTREAM_REDIRECT_REFUSED"):
        await client.post_with_headers("ka10001", "/api/dostk/stkinfo", {})
    assert calls == 2
    await http_client.aclose()


@pytest.mark.asyncio
async def test_rate_limiter_runs_per_attempt_and_429_retry_is_bounded() -> None:
    query_calls = 0
    acquired: list[str] = []
    sleeps: list[float] = []

    class RecordingLimiter:
        async def acquire(self, api_id: str) -> None:
            acquired.append(api_id)

    async def no_wait(delay: float) -> None:
        sleeps.append(delay)

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal query_calls
        if request.url.path == "/oauth2/token":
            return httpx.Response(
                200,
                json={"return_code": 0, "token": TOKEN_CANARY, "expires_dt": _expiry()},
            )
        query_calls += 1
        if query_calls == 1:
            return httpx.Response(429)
        return httpx.Response(200, json={"return_code": 0, "stk_cd": "005930"})

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    auth = FinancialReadAuth("mock", APP_CANARY, SECRET_CANARY, client=http_client)
    client = FinancialReadClient(
        auth,
        "mock",
        {"ka10001": "/api/dostk/stkinfo"},
        client=http_client,
        rate_limiter=RecordingLimiter(),  # type: ignore[arg-type]
        sleep=no_wait,
    )
    result = await client.post_with_headers("ka10001", "/api/dostk/stkinfo", {})
    assert result.body["stk_cd"] == "005930"
    assert query_calls == 2
    assert acquired == ["ka10001", "ka10001"]
    assert sleeps == [0.2]
    await http_client.aclose()


@pytest.mark.asyncio
async def test_cancellation_during_429_backoff_stops_retry() -> None:
    query_calls = 0
    sleeping = asyncio.Event()

    class RecordingLimiter:
        calls = 0

        async def acquire(self, _api_id: str) -> None:
            self.calls += 1

    limiter = RecordingLimiter()

    async def blocked_sleep(_delay: float) -> None:
        sleeping.set()
        await asyncio.Event().wait()

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal query_calls
        if request.url.path == "/oauth2/token":
            return httpx.Response(
                200,
                json={"return_code": 0, "token": TOKEN_CANARY, "expires_dt": _expiry()},
            )
        query_calls += 1
        return httpx.Response(429)

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    auth = FinancialReadAuth("mock", APP_CANARY, SECRET_CANARY, client=http_client)
    client = FinancialReadClient(
        auth,
        "mock",
        {"ka10001": "/api/dostk/stkinfo"},
        client=http_client,
        rate_limiter=limiter,  # type: ignore[arg-type]
        sleep=blocked_sleep,
    )
    task = asyncio.create_task(
        client.post_with_headers("ka10001", "/api/dostk/stkinfo", {})
    )
    await sleeping.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert query_calls == 1
    assert limiter.calls == 1
    await http_client.aclose()


@pytest.mark.asyncio
async def test_query_deadline_bounds_rate_limiter_and_never_starts_network() -> None:
    now = 0.0
    query_calls = 0

    class ExpiringLimiter:
        async def acquire(self, _api_id: str) -> None:
            nonlocal now
            now = 31.0

    def clock() -> float:
        return now

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal query_calls
        if request.url.path == "/oauth2/token":
            return httpx.Response(
                200,
                json={"return_code": 0, "token": TOKEN_CANARY, "expires_dt": _expiry()},
            )
        query_calls += 1
        return httpx.Response(200, json={"return_code": 0})

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    auth = FinancialReadAuth("mock", APP_CANARY, SECRET_CANARY, client=http_client)
    client = FinancialReadClient(
        auth,
        "mock",
        {"ka10001": "/api/dostk/stkinfo"},
        client=http_client,
        rate_limiter=ExpiringLimiter(),  # type: ignore[arg-type]
        clock=clock,
    )
    with pytest.raises(FinancialReadError, match="QUERY_DEADLINE_EXCEEDED"):
        await client.post_with_headers("ka10001", "/api/dostk/stkinfo", {})
    assert query_calls == 0
    await http_client.aclose()


def test_oauth_and_query_timeouts_are_capped_at_fifteen_seconds() -> None:
    with pytest.raises(FinancialReadError, match="TIMEOUT_INVALID"):
        FinancialReadAuth("mock", APP_CANARY, SECRET_CANARY, timeout_seconds=15.01)
    auth = FinancialReadAuth("mock", APP_CANARY, SECRET_CANARY)
    with pytest.raises(FinancialReadError, match="TIMEOUT_INVALID"):
        FinancialReadClient(
            auth,
            "mock",
            {"ka10001": "/api/dostk/stkinfo"},
            timeout_seconds=15.01,
        )
    with pytest.raises(FinancialReadError, match="RETRY_LIMIT_INVALID"):
        FinancialReadClient(
            auth,
            "mock",
            {"ka10001": "/api/dostk/stkinfo"},
            retry_deadline_seconds=30.01,
        )


@pytest.mark.asyncio
async def test_oauth_and_query_total_timeout_is_enforced() -> None:
    async def slow_oauth(_request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(0.05)
        return httpx.Response(
            200,
            json={"return_code": 0, "token": TOKEN_CANARY, "expires_dt": _expiry()},
        )

    auth_http = httpx.AsyncClient(transport=httpx.MockTransport(slow_oauth))
    slow_auth = FinancialReadAuth(
        "mock", APP_CANARY, SECRET_CANARY, client=auth_http, timeout_seconds=0.01
    )
    with pytest.raises(FinancialReadError, match="NETWORK_UNAVAILABLE"):
        await slow_auth.ensure_token()
    await auth_http.aclose()

    async def slow_query(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/oauth2/token":
            return httpx.Response(
                200,
                json={"return_code": 0, "token": TOKEN_CANARY, "expires_dt": _expiry()},
            )
        await asyncio.sleep(0.05)
        return httpx.Response(200, json={"return_code": 0})

    query_http = httpx.AsyncClient(transport=httpx.MockTransport(slow_query))
    query_auth = FinancialReadAuth(
        "mock", APP_CANARY, SECRET_CANARY, client=query_http
    )
    query_client = FinancialReadClient(
        query_auth,
        "mock",
        {"ka10001": "/api/dostk/stkinfo"},
        client=query_http,
        timeout_seconds=0.01,
    )
    with pytest.raises(FinancialReadError, match="QUERY_DEADLINE_EXCEEDED"):
        await query_client.post_with_headers("ka10001", "/api/dostk/stkinfo", {})
    await query_http.aclose()


@pytest.mark.asyncio
async def test_streamed_response_over_two_mib_fails_without_clipping() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/oauth2/token":
            return httpx.Response(
                200,
                json={"return_code": 0, "token": TOKEN_CANARY, "expires_dt": _expiry()},
            )
        return httpx.Response(
            200,
            content=b'{"payload":"' + b"x" * MAX_RESPONSE_BYTES + b'"}',
        )

    _auth, client, http_client = _client("mock", handler)
    with pytest.raises(FinancialReadError, match="UPSTREAM_RESPONSE_TOO_LARGE"):
        await client.post_with_headers("ka10001", "/api/dostk/stkinfo", {})
    await http_client.aclose()


@pytest.mark.asyncio
async def test_transport_errors_are_constant_and_do_not_echo_secret_canaries() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(
            f"do not echo {APP_CANARY} {SECRET_CANARY} {TOKEN_CANARY}"
        )

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    auth = FinancialReadAuth("mock", APP_CANARY, SECRET_CANARY, client=http_client)
    with pytest.raises(FinancialReadError) as caught:
        await auth.ensure_token()
    rendered = str(caught.value)
    assert rendered == "NETWORK_UNAVAILABLE"
    assert APP_CANARY not in rendered
    assert SECRET_CANARY not in rendered
    assert TOKEN_CANARY not in rendered
    formatted = "".join(
        traceback.format_exception(caught.type, caught.value, caught.tb)
    )
    assert APP_CANARY not in formatted
    assert SECRET_CANARY not in formatted
    assert TOKEN_CANARY not in formatted
    await http_client.aclose()


@pytest.mark.asyncio
async def test_business_response_is_preserved_for_generated_typed_runtime() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/oauth2/token":
            return httpx.Response(
                200,
                json={"return_code": 0, "token": TOKEN_CANARY, "expires_dt": _expiry()},
            )
        return httpx.Response(200, json={"return_code": 20, "return_msg": "fixture"})

    _auth, client, http_client = _client("mock", handler)
    envelope = await client.post_with_headers("ka10001", "/api/dostk/stkinfo", {})
    assert envelope.body["return_code"] == 20
    await http_client.aclose()


@pytest.mark.asyncio
async def test_invalid_continuation_headers_fail_closed() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/oauth2/token":
            return httpx.Response(
                200,
                json={"return_code": 0, "token": TOKEN_CANARY, "expires_dt": _expiry()},
            )
        return httpx.Response(200, headers={"cont-yn": "MAYBE"}, json={"return_code": 0})

    _auth, client, http_client = _client("mock", handler)
    with pytest.raises(FinancialReadError, match="UPSTREAM_RESPONSE_INVALID"):
        await client.post_with_headers("ka10001", "/api/dostk/stkinfo", {})
    await http_client.aclose()
