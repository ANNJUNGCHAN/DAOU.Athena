"""Memory-only OAuth for the explicit real-or-mock financial read profile."""

from __future__ import annotations

import asyncio
import json
from contextlib import suppress
from datetime import datetime, timedelta
from typing import Any

import httpx

from athena_api.kiwoom.auth import KST, parse_kiwoom_datetime
from athena_api.kiwoom.return_codes import normalize_return_code

REAL_BASE_URL = "https://api.kiwoom.com"
MOCK_BASE_URL = "https://mockapi.kiwoom.com"
TOKEN_ENDPOINT = "/oauth2/token"
TOKEN_API_ID = "au10001"
TOKEN_RESPONSE_MAX_BYTES = 64 * 1024
TOKEN_REFRESH_MARGIN = timedelta(seconds=60)
MAX_TIMEOUT_SECONDS = 15.0


class FinancialReadError(RuntimeError):
    """Secret-safe financial-read error with a fixed public code."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class FinancialReadAuth:
    def __init__(
        self,
        environment: str,
        app_key: str,
        secret_key: str,
        *,
        client: httpx.AsyncClient | None = None,
        timeout_seconds: float = 10.0,
    ) -> None:
        if environment not in {"mock", "real"}:
            raise FinancialReadError("ENVIRONMENT_INVALID")
        if not (1 <= len(app_key) <= 256 and 1 <= len(secret_key) <= 256):
            raise FinancialReadError("CREDENTIAL_INVALID")
        if timeout_seconds <= 0 or timeout_seconds > MAX_TIMEOUT_SECONDS:
            raise FinancialReadError("TIMEOUT_INVALID")
        self.environment = environment
        self.base_url = MOCK_BASE_URL if environment == "mock" else REAL_BASE_URL
        self._app_key = app_key
        self._secret_key = secret_key
        self._client = client or httpx.AsyncClient(follow_redirects=False)
        self._owns_client = client is None
        self._timeout_seconds = timeout_seconds
        self._timeout = httpx.Timeout(timeout_seconds)
        self._token: str | None = None
        self._expires_at: datetime | None = None
        self._issue_lock = asyncio.Lock()
        self._issue_task: asyncio.Task[None] | None = None

    @property
    def is_ready(self) -> bool:
        return bool(
            self._token
            and self._expires_at
            and self._expires_at > datetime.now(KST) + TOKEN_REFRESH_MARGIN
        )

    @property
    def expires_at(self) -> datetime | None:
        return self._expires_at

    @property
    def authorization(self) -> str:
        if not self._token:
            raise FinancialReadError("TOKEN_UNAVAILABLE")
        return f"Bearer {self._token}"

    async def ensure_token(self) -> str:
        if self.is_ready:
            assert self._token is not None
            return self._token
        async with self._issue_lock:
            if self.is_ready:
                assert self._token is not None
                return self._token
            task = self._issue_task
            if task is None:
                task = asyncio.create_task(self._issue_token())
                task.add_done_callback(
                    lambda completed: None
                    if completed.cancelled()
                    else completed.exception()
                )
                self._issue_task = task
        try:
            await asyncio.shield(task)
        finally:
            async with self._issue_lock:
                if self._issue_task is task and task.done():
                    self._issue_task = None
        if not self.is_ready:
            raise FinancialReadError("TOKEN_RESPONSE_INVALID")
        assert self._token is not None
        return self._token

    async def _issue_token(self) -> None:
        try:
            async with asyncio.timeout(self._timeout_seconds):
                async with self._client.stream(
                    "POST",
                    f"{self.base_url}{TOKEN_ENDPOINT}",
                    headers={
                        "Content-Type": "application/json;charset=UTF-8",
                        "api-id": TOKEN_API_ID,
                    },
                    json={
                        "grant_type": "client_credentials",
                        "appkey": self._app_key,
                        "secretkey": self._secret_key,
                    },
                    timeout=self._timeout,
                    follow_redirects=False,
                ) as response:
                    if 300 <= response.status_code < 400:
                        raise FinancialReadError("UPSTREAM_REDIRECT_REFUSED")
                    if not 200 <= response.status_code < 300:
                        raise FinancialReadError("TOKEN_REJECTED")
                    body = await _bounded_json_object(response, TOKEN_RESPONSE_MAX_BYTES)
        except FinancialReadError:
            raise
        except (httpx.HTTPError, TimeoutError, ValueError):
            raise FinancialReadError("NETWORK_UNAVAILABLE") from None
        if normalize_return_code(body.get("return_code")) not in {"", "0"}:
            raise FinancialReadError("TOKEN_REJECTED")
        try:
            token = body["token"]
            expires_at = parse_kiwoom_datetime(str(body["expires_dt"]))
        except (KeyError, TypeError, ValueError):
            raise FinancialReadError("TOKEN_RESPONSE_INVALID") from None
        if not isinstance(token, str) or not (1 <= len(token) <= 8192):
            raise FinancialReadError("TOKEN_RESPONSE_INVALID")
        if expires_at <= datetime.now(KST) + TOKEN_REFRESH_MARGIN:
            raise FinancialReadError("TOKEN_RESPONSE_INVALID")
        self._token = token
        self._expires_at = expires_at

    def clear(self) -> None:
        self._token = None
        self._expires_at = None

    async def aclose(self) -> None:
        self.clear()
        task = self._issue_task
        self._issue_task = None
        if task is not None and not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        if self._owns_client:
            await self._client.aclose()


async def _bounded_json_object(
    response: httpx.Response, max_bytes: int
) -> dict[str, Any]:
    content_length = response.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > max_bytes:
                raise FinancialReadError("UPSTREAM_RESPONSE_TOO_LARGE")
        except ValueError:
            raise FinancialReadError("UPSTREAM_RESPONSE_INVALID") from None
    chunks: list[bytes] = []
    total = 0
    async for chunk in response.aiter_bytes():
        total += len(chunk)
        if total > max_bytes:
            raise FinancialReadError("UPSTREAM_RESPONSE_TOO_LARGE")
        chunks.append(chunk)
    try:
        body = json.loads(b"".join(chunks))
    except (UnicodeDecodeError, ValueError):
        raise FinancialReadError("UPSTREAM_RESPONSE_INVALID") from None
    if not isinstance(body, dict):
        raise FinancialReadError("UPSTREAM_RESPONSE_INVALID")
    return body
