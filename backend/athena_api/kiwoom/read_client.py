"""Strict query-only Kiwoom transport for the WTS financial-read profile."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable, Mapping
from types import MappingProxyType
from typing import Any
from urllib.parse import urlsplit

import httpx

from athena_api.generated.registry import TR_REGISTRY
from athena_api.kiwoom.client import RequestOptions, ResponseEnvelope
from athena_api.kiwoom.rate_limiter import RateLimiter
from athena_api.kiwoom.read_auth import (
    MAX_TIMEOUT_SECONDS,
    FinancialReadAuth,
    FinancialReadError,
    _bounded_json_object,
)

MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_NEXT_KEY_LENGTH = 8192
MAX_RETRY_DEADLINE_SECONDS = 30.0


class FinancialReadClient:
    def __init__(
        self,
        auth: FinancialReadAuth,
        environment: str,
        allowed_routes: Mapping[str, str],
        *,
        client: httpx.AsyncClient | None = None,
        timeout_seconds: float = 10.0,
        rate_limiter: RateLimiter | None = None,
        max_rate_limit_retries: int = 1,
        retry_deadline_seconds: float = MAX_RETRY_DEADLINE_SECONDS,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        if environment not in {"mock", "real"} or environment != auth.environment:
            raise FinancialReadError("ENVIRONMENT_INVALID")
        if timeout_seconds <= 0 or timeout_seconds > MAX_TIMEOUT_SECONDS:
            raise FinancialReadError("TIMEOUT_INVALID")
        if (
            max_rate_limit_retries < 0
            or max_rate_limit_retries > 2
            or retry_deadline_seconds <= 0
            or retry_deadline_seconds > MAX_RETRY_DEADLINE_SECONDS
        ):
            raise FinancialReadError("RETRY_LIMIT_INVALID")
        checked_routes: dict[str, str] = {}
        for tr_id, endpoint in allowed_routes.items():
            spec = TR_REGISTRY.get(tr_id)
            if (
                spec is None
                or spec.kind != "query"
                or spec.upstream_path != endpoint
                or not _is_exact_api_path(endpoint)
            ):
                raise FinancialReadError("READ_ROUTE_INVALID")
            checked_routes[tr_id] = endpoint
        if not checked_routes:
            raise FinancialReadError("READ_ROUTE_INVALID")
        self.environment = environment
        self.base_url = auth.base_url
        self._auth = auth
        self._allowed_routes = MappingProxyType(checked_routes)
        self._client = client or httpx.AsyncClient(follow_redirects=False)
        self._owns_client = client is None
        self._timeout_seconds = timeout_seconds
        self._timeout = httpx.Timeout(timeout_seconds)
        self._rate_limiter = rate_limiter or RateLimiter(rate_per_second=5.0)
        self._max_rate_limit_retries = max_rate_limit_retries
        self._retry_deadline_seconds = retry_deadline_seconds
        self._clock = clock
        self._sleep = sleep

    @property
    def is_ready(self) -> bool:
        return self._auth.is_ready

    @property
    def allowed_routes(self) -> Mapping[str, str]:
        return self._allowed_routes

    async def post_with_headers(
        self,
        api_id: str,
        endpoint: str,
        data: dict[str, Any] | None = None,
        options: RequestOptions | None = None,
    ) -> ResponseEnvelope:
        registered = TR_REGISTRY.get(api_id)
        if (
            self._allowed_routes.get(api_id) != endpoint
            or registered is None
            or registered.kind != "query"
            or registered.upstream_path != endpoint
            or not _is_exact_api_path(endpoint)
        ):
            raise FinancialReadError("READ_ROUTE_NOT_ALLOWED")
        if data is not None and not isinstance(data, dict):
            raise FinancialReadError("REQUEST_INVALID")
        options = options or RequestOptions()
        if options.cont_yn not in {"N", "Y"}:
            raise FinancialReadError("REQUEST_INVALID")
        if options.next_key is not None and (
            not isinstance(options.next_key, str)
            or not (1 <= len(options.next_key) <= MAX_NEXT_KEY_LENGTH)
            or "\r" in options.next_key
            or "\n" in options.next_key
        ):
            raise FinancialReadError("REQUEST_INVALID")
        started_at = self._clock()

        def remaining() -> float:
            return self._retry_deadline_seconds - (self._clock() - started_at)

        try:
            async with asyncio.timeout(max(0.0, remaining())):
                await self._auth.ensure_token()
        except TimeoutError:
            raise FinancialReadError("QUERY_DEADLINE_EXCEEDED") from None
        headers = {
            "Content-Type": "application/json;charset=UTF-8",
            "api-id": api_id,
            "authorization": self._auth.authorization,
            "cont-yn": options.cont_yn,
        }
        if options.next_key:
            headers["next-key"] = options.next_key
        attempt = 0
        while True:
            try:
                wait_budget = remaining()
                if wait_budget <= 0:
                    raise FinancialReadError("QUERY_DEADLINE_EXCEEDED")
                async with asyncio.timeout(wait_budget):
                    await self._rate_limiter.acquire(api_id)
                request_budget = remaining()
                if request_budget <= 0:
                    raise FinancialReadError("QUERY_DEADLINE_EXCEEDED")
                async with asyncio.timeout(
                    min(request_budget, self._timeout_seconds)
                ):
                    async with self._client.stream(
                        "POST",
                        f"{self.base_url}{endpoint}",
                        headers=headers,
                        json={} if data is None else data,
                        timeout=self._timeout,
                        follow_redirects=False,
                    ) as response:
                        if response.status_code == 429 and attempt < self._max_rate_limit_retries:
                            retry = True
                            body = None
                        else:
                            retry = False
                            if 300 <= response.status_code < 400:
                                raise FinancialReadError("UPSTREAM_REDIRECT_REFUSED")
                            if response.status_code == 429:
                                raise FinancialReadError("UPSTREAM_RATE_LIMITED")
                            if not 200 <= response.status_code < 300:
                                raise FinancialReadError("UPSTREAM_REJECTED")
                            body = await _bounded_json_object(
                                response, MAX_RESPONSE_BYTES
                            )
                if not retry:
                    assert body is not None
                    break
                delay = min(0.2 * (2**attempt), max(0.0, remaining()))
                if delay <= 0:
                    raise FinancialReadError("QUERY_DEADLINE_EXCEEDED")
                attempt += 1
                async with asyncio.timeout(max(0.0, remaining())):
                    await self._sleep(delay)
            except FinancialReadError:
                raise
            except TimeoutError:
                raise FinancialReadError("QUERY_DEADLINE_EXCEEDED") from None
            except (httpx.HTTPError, ValueError):
                raise FinancialReadError("NETWORK_UNAVAILABLE") from None
        if not body:
            raise FinancialReadError("UPSTREAM_RESPONSE_INVALID")
        cont_yn = (response.headers.get("cont-yn") or "N").strip() or "N"
        next_key = (response.headers.get("next-key") or "").strip() or None
        if cont_yn not in {"N", "Y"} or (
            next_key is not None
            and (len(next_key) > MAX_NEXT_KEY_LENGTH or "\r" in next_key or "\n" in next_key)
        ):
            raise FinancialReadError("UPSTREAM_RESPONSE_INVALID")
        return ResponseEnvelope(body=body, cont_yn=cont_yn, next_key=next_key)

    async def post(
        self,
        api_id: str,
        endpoint: str,
        data: dict[str, Any] | None = None,
        options: RequestOptions | None = None,
    ) -> dict[str, Any]:
        return (await self.post_with_headers(api_id, endpoint, data, options)).body

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()


def _is_exact_api_path(endpoint: str) -> bool:
    parsed = urlsplit(endpoint)
    return (
        endpoint.startswith("/api/")
        and parsed.scheme == ""
        and parsed.netloc == ""
        and parsed.query == ""
        and parsed.fragment == ""
        and parsed.path == endpoint
        and "//" not in endpoint
        and "/../" not in f"{endpoint}/"
    )
