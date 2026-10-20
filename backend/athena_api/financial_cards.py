"""Bounded public card pages for the WTS financial-read profile."""

from __future__ import annotations

import hashlib
import json
import math
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from athena_api.canvas_transform import (
    build_aits_chart_body,
    build_compound_generic,
    build_facts,
    build_table,
    resolve_screen_render_contract,
)
from athena_api.generated.registry import TR_REGISTRY
from athena_api.selector.catalog import OperationDocument

CARD_VERSION = "wts-financial-card-1"
PAGE_MAX_BYTES = 96 * 1024
RESULT_MAX_BYTES = 2 * 1024 * 1024
PAGE_TTL_SECONDS = 300
PROTECTED_ACCOUNT_VALUE = "보호됨"
_ACCOUNT_IDENTIFIER_KEYS = frozenset({"acctno", "acntno", "acntprint", "9201"})


class FinancialCardError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def utc_now() -> datetime:
    return datetime.now(UTC)


def utc_text(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def opaque_token() -> str:
    return secrets.token_urlsafe(32)


def canonical_bytes(value: Any) -> bytes:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise FinancialCardError("QUERY_RESULT_UNSUPPORTED_VALUE") from exc


def _utf16_length(value: str) -> int:
    return len(value.encode("utf-16-le")) // 2


def _string(value: Any, *, minimum: int, maximum: int) -> str:
    if not isinstance(value, str):
        raise FinancialCardError("QUERY_RESULT_UNSUPPORTED_VALUE")
    length = _utf16_length(value)
    if not minimum <= length <= maximum:
        raise FinancialCardError("QUERY_RESULT_UNSUPPORTED_VALUE")
    return value


def _is_account_identifier(key: str) -> bool:
    normalized = "".join(character for character in key.lower() if character.isalnum())
    return normalized in _ACCOUNT_IDENTIFIER_KEYS


def _scalar(value: Any, *, key: str | None = None) -> Any:
    if key is not None and _is_account_identifier(key):
        return PROTECTED_ACCOUNT_VALUE
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, str):
        return _string(value, minimum=0, maximum=8192)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if isinstance(value, float) and not math.isfinite(value):
            raise FinancialCardError("QUERY_RESULT_UNSUPPORTED_VALUE")
        return value
    raise FinancialCardError("QUERY_RESULT_UNSUPPORTED_VALUE")


def _field(item: dict[str, Any]) -> dict[str, Any]:
    key = _string(str(item["key"]), minimum=1, maximum=128)
    return {
        "key": key,
        "label": _string(str(item["label"]), minimum=1, maximum=256),
        "value": _scalar(item["value"], key=key),
    }


def _columns(items: list[dict[str, Any]]) -> list[dict[str, str]]:
    columns = [
        {
            "key": _string(str(item["key"]), minimum=1, maximum=128),
            "label": _string(str(item["label"]), minimum=1, maximum=256),
        }
        for item in items
    ]
    keys = [item["key"] for item in columns]
    if not columns or len(keys) != len(set(keys)):
        raise FinancialCardError("QUERY_RESULT_UNSUPPORTED_VALUE")
    return columns


def _rows(items: list[dict[str, Any]], columns: list[dict[str, str]]) -> list[dict[str, Any]]:
    keys = [item["key"] for item in columns]
    expected = set(keys)
    rows: list[dict[str, Any]] = []
    for item in items:
        if set(item) != expected:
            raise FinancialCardError("QUERY_RESULT_UNSUPPORTED_VALUE")
        rows.append({key: _scalar(item[key], key=key) for key in keys})
    return rows


def _validate_wire_value(value: Any) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            _string(key, minimum=1, maximum=128)
            _validate_wire_value(item)
        return
    if isinstance(value, (list, tuple)):
        for item in value:
            _validate_wire_value(item)
        return
    _scalar(value)


def _split(
    items: list[Any],
    build: Callable[[list[Any]], dict[str, Any]],
    *,
    size_of: Callable[[dict[str, Any]], int] | None = None,
    max_items: int,
) -> list[dict[str, Any]]:
    measure = size_of or (lambda value: len(canonical_bytes(value)))
    if not items:
        candidate = build([])
        if measure(candidate) > PAGE_MAX_BYTES:
            raise FinancialCardError("QUERY_RESULT_ITEM_TOO_LARGE")
        return [candidate]
    pages: list[dict[str, Any]] = []
    current: list[Any] = []
    for item in items:
        one = build([item])
        if measure(one) > PAGE_MAX_BYTES:
            raise FinancialCardError("QUERY_RESULT_ITEM_TOO_LARGE")
        candidate = build([*current, item])
        if current and (len(current) >= max_items or measure(candidate) > PAGE_MAX_BYTES):
            pages.append(build(current))
            current = [item]
        else:
            current.append(item)
    pages.append(build(current))
    return pages


@dataclass(frozen=True, slots=True)
class CardBuild:
    pages: tuple[dict[str, Any], ...]
    initial_index: int


def _renderer(kind: str) -> str:
    return {
        "facts": "facts-card-v1",
        "table": "table-card-v1",
        "compound": "compound-card-v1",
        "chart": "aits-chart-v1",
    }[kind]


def build_financial_card_pages(
    *,
    document: OperationDocument,
    response_data: dict[str, Any],
    symbol: str | None,
    job_id: str,
    submission_id: str,
    profile_id: str,
    environment: str,
    catalog_version: str,
    arguments_sha256: str,
    continuation_available: bool,
    continuation_token: str | None,
    now: datetime | None = None,
) -> CardBuild:
    """Transform once, retain the full result in memory, and emit lossless pages."""
    now = now or utc_now()
    resolved = resolve_screen_render_contract(document.operation_ref)
    if isinstance(resolved, str):
        raise FinancialCardError("QUERY_RENDER_UNSUPPORTED")
    kind, _, renderer_id = resolved
    if kind not in {"facts", "table", "compound", "chart"}:
        raise FinancialCardError("QUERY_RENDER_UNSUPPORTED")
    title = _string(
        document.group_title_ko or document.name or document.operation_ref,
        minimum=1,
        maximum=64,
    )
    provenance = {
        "provider": "kiwoom-rest",
        "environment": environment,
        "profileId": profile_id,
        "trId": document.tr_id,
        "endpoint": TR_REGISTRY[document.tr_id].upstream_path,
        "catalogVersion": catalog_version,
        "fetchedAt": utc_text(now),
        "sourceAsOf": None,
        "sourceStatusCode": _string(
            str(response_data.get("return_code", "0")) or "0", minimum=1, maximum=32
        ),
        "argumentsSha256": arguments_sha256,
    }
    continuation = {
        "available": continuation_available,
        "continuationToken": continuation_token if continuation_available else None,
        "expiresAt": utc_text(now + timedelta(seconds=PAGE_TTL_SECONDS))
        if continuation_available
        else None,
    }
    base = {
        "cardVersion": CARD_VERSION,
        "jobId": job_id,
        "submissionId": submission_id,
        "operationRef": document.operation_ref,
        "renderKind": kind,
        "rendererId": renderer_id or _renderer(kind),
        "title": title,
        "provenance": provenance,
        "continuation": continuation,
    }
    expires_at = now + timedelta(seconds=PAGE_TTL_SECONDS)

    def public_page_size(data: dict[str, Any]) -> int:
        # Both tokens are populated for an interior page, which is the largest possible
        # descriptor. Using the final public envelope here avoids clipping or a late
        # failure when data alone fits but provenance/page metadata does not.
        return len(
            canonical_bytes(
                {
                    **base,
                    "page": {
                        "pageIndex": 9_999_999,
                        "pageCount": 10_000_000,
                        "itemStart": 9_999_999,
                        "itemEndExclusive": 10_000_000,
                        "itemCount": 10_000_000,
                        "totalItems": 10_000_000,
                        "initial": False,
                        "previousPageToken": "x" * 43,
                        "nextPageToken": "x" * 43,
                        "expiresAt": utc_text(expires_at),
                    },
                    "data": data,
                }
            )
        )

    if kind == "facts":
        transformed = build_facts(response_data, limit=None)
        if isinstance(transformed, str):
            raise FinancialCardError("QUERY_RESULT_UNSUPPORTED_VALUE")
        fields = [_field(item) for item in transformed[0]["fields"]]
        chunks = _split(
            fields,
            lambda values: {"kind": "facts", "fields": values},
            size_of=public_page_size,
            max_items=256,
        )
        total = len(fields)
    elif kind == "table":
        transformed = build_table(response_data, limit=None)
        if isinstance(transformed, str):
            raise FinancialCardError("QUERY_RESULT_UNSUPPORTED_VALUE")
        columns = _columns(transformed[0]["columns"])
        rows = _rows(transformed[0]["rows"], columns)
        chunks = _split(
            rows,
            lambda values: {"kind": "table", "columns": columns, "rows": values},
            size_of=public_page_size,
            max_items=512,
        )
        total = len(rows)
    elif kind == "compound":
        transformed = build_compound_generic(response_data, facts_limit=None, rows_limit=None)
        if isinstance(transformed, str):
            raise FinancialCardError("QUERY_RESULT_UNSUPPORTED_VALUE")
        header = [_field(item) for item in transformed[0]["header"]]
        columns = _columns(transformed[0]["table"]["columns"])
        rows = _rows(transformed[0]["table"]["rows"], columns)
        chunks = _split(
            rows,
            lambda values: {
                "kind": "compound",
                "header": header,
                "columns": columns,
                "rows": values,
            },
            size_of=public_page_size,
            max_items=512,
        )
        total = len(rows)
    else:
        transformed = build_aits_chart_body(
            document.operation_ref,
            response_data,
            limit=1_000_000,
            strict=True,
        )
        if isinstance(transformed, str):
            raise FinancialCardError("QUERY_RESULT_UNSUPPORTED_VALUE")
        chart = transformed[0]
        candles = []
        for candle in chart["candles"]:
            candles.append(
                {
                    "time": (
                        _string(candle["time"], minimum=1, maximum=32)
                        if isinstance(candle["time"], str)
                        else candle["time"]
                    ),
                    "open": _scalar(candle["open"]),
                    "high": _scalar(candle["high"]),
                    "low": _scalar(candle["low"]),
                    "close": _scalar(candle["close"]),
                    "volume": _scalar(candle.get("volume")),
                }
            )
        chart_base = {
            "period": chart["period"],
            "target": chart["target"],
            "trId": chart["trId"],
        }
        chunks = _split(
            candles,
            lambda values: {
                "kind": "chart",
                "symbol": _string(symbol or document.tr_id, minimum=1, maximum=64),
                "chart": {**chart_base, "candles": values},
            },
            size_of=public_page_size,
            max_items=1024,
        )
        total = len(candles)

    page_count = len(chunks)
    result: list[dict[str, Any]] = []
    start = 0
    for index, data in enumerate(chunks):
        if kind == "facts":
            count = len(data["fields"])
        elif kind == "chart":
            count = len(data["chart"]["candles"])
        else:
            count = len(data["rows"])
        result.append(
            {
                **base,
                "page": {
                    "pageIndex": index,
                    "pageCount": page_count,
                    "itemStart": start,
                    "itemEndExclusive": start + count,
                    "itemCount": count,
                    "totalItems": total,
                    "initial": index == (page_count - 1 if kind == "chart" else 0),
                    "previousPageToken": None,
                    "nextPageToken": None,
                    "expiresAt": utc_text(expires_at),
                },
                "data": data,
            }
        )
        start += count
    retained_size = 0
    for index, page in enumerate(result):
        measured = json.loads(canonical_bytes(page))
        measured["page"]["previousPageToken"] = "x" * 43 if index else None
        measured["page"]["nextPageToken"] = "x" * 43 if index + 1 < page_count else None
        _validate_wire_value(measured)
        retained_size += len(canonical_bytes(measured))
    if retained_size > RESULT_MAX_BYTES:
        raise FinancialCardError("QUERY_RESULT_TOO_LARGE")
    return CardBuild(tuple(result), page_count - 1 if kind == "chart" else 0)


def arguments_digest(profile_id: str, operation_ref: str, arguments: dict[str, Any]) -> str:
    digest = hashlib.sha256(
        canonical_bytes(
            {"profileId": profile_id, "operationRef": operation_ref, "arguments": arguments}
        )
    ).hexdigest()
    return f"sha256:{digest}"
