"""Bounded, localhost-only LAYA decisions for the paper simulation engine."""

from __future__ import annotations

import hashlib
import json
import math
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from .natural_schema import question_references, render_question, validate_schema

MODEL_ID = "convaiinnovations/laya-multilingual"
REVISION = "e4e9ddf21a7b1903b7acffd8814ad4307bf63a67"
PROMPT_VERSION = "natural-backtest-v1"
MAX_LEN = 2048
HEAD_MAX_LEN = 256
COMPILED_HEAD_MAX_LEN = 512
# UTF-8 bytes conservatively upper-bound this checkpoint's state tokens. The
# short fixed head is separately budgeted; strategy text is never shortened.
STATE_BYTE_BUDGET = MAX_LEN - HEAD_MAX_LEN - 16
MAX_RESPONSE_BYTES = 256_000
ACTION_TEXT = {
    "enter": "진입: 사용자 진입 조건이 충족되어 매수 / enter when entry conditions hold",
    "wait": "관망: 사용자 진입 조건이 충족되지 않아 거래하지 않음 / wait otherwise",
    "exit": "청산: 사용자 청산 조건이 충족되어 매도 / exit when exit conditions hold",
    "hold": "보유: 사용자 청산 조건이 충족되지 않아 유지 / hold otherwise",
}


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise HTTPError(req.full_url, code, "Redirect refused", headers, fp)


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def _state_bytes(value):
    # The SDK reserializes a dict with default JSON spaces, independently of our
    # compact HTTP transport. Bound that exact representation, not the transport.
    return len(json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8"))


def _indicators(bars):
    closes = [float(bar["close"]) for bar in bars]
    volumes = [float(bar["volume"]) for bar in bars]
    return {
        "previous_close": closes[-2] if len(closes) > 1 else None,
        "sma_5": sum(closes[-5:]) / 5 if len(closes) >= 5 else None,
        "sma_20": sum(closes[-20:]) / 20 if len(closes) >= 20 else None,
        "volume_ma_5": sum(volumes[-5:]) / 5 if len(volumes) >= 5 else None,
    }


class NaturalLayaClient:
    """A probability floor is an explicit abstention policy, not calibration.

    The core remains responsible for legal actions, costs and execution timing.
    Returning action=None asks it to wait (flat) or hold (already invested).
    """

    def __init__(
        self,
        base_url="http://127.0.0.1:8768",
        *,
        timeout=10.0,
        min_answer_probability=0.65,
        min_margin=0.10,
    ):
        url = urlsplit(base_url)
        if (
            url.scheme != "http"
            or url.hostname not in {"127.0.0.1", "localhost", "::1"}
            or url.username
            or url.password
            or url.path not in {"", "/"}
            or url.query
            or url.fragment
        ):
            raise ValueError("LAYA base_url must be a plain localhost HTTP origin")
        if not _finite(timeout) or timeout <= 0:
            raise ValueError("timeout must be positive")
        for value in (min_answer_probability, min_margin):
            if not _finite(value) or not 0 <= value <= 1:
                raise ValueError("probability policy values must be within [0, 1]")
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.min_answer_probability = min_answer_probability
        self.min_margin = min_margin
        # No environment proxy and no redirect can move the local observation to
        # another destination, even when system-wide proxy variables are set.
        self._opener = build_opener(ProxyHandler({}), _NoRedirect())

    def _request(self, payload=None):
        path = "/health" if payload is None else "/v1/systemone"
        request = Request(
            self.base_url + path,
            data=None if payload is None else _json(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with self._opener.open(request, timeout=self.timeout) as response:
            body = response.read(MAX_RESPONSE_BYTES + 1)
        if len(body) > MAX_RESPONSE_BYTES:
            raise ValueError("LAYA response exceeds limit")
        result = json.loads(body)
        # Reject NaN/Infinity as well as non-JSON audit values.
        _json(result)
        return result

    def identity(self):
        try:
            health = self._request()
            if (
                not isinstance(health, dict)
                or health.get("status") != "ready"
                or health.get("model_id") != MODEL_ID
                or health.get("revision") != REVISION
            ):
                return {"status": "unavailable", "reason": "unexpected_health"}
            return health
        except (OSError, ValueError, TypeError, HTTPException, HTTPError, URLError):
            return {"status": "unavailable", "reason": "server_unavailable"}

    def build_payload(self, request):
        actions = request["allowed_actions"]
        expected = {"exit", "hold"} if request["state"]["holding"] else {"enter", "wait"}
        if len(actions) != 2 or set(actions) != expected:
            raise ValueError("invalid_legal_actions")
        strategy = request["strategy"]
        if not isinstance(strategy, str) or not strategy.strip():
            raise ValueError("empty_strategy")
        source = request["observations"]
        if not source:
            raise ValueError("missing_observations")
        bars = []
        for bar in source:
            if not isinstance(bar.get("dt"), str) or bar["dt"] > request["as_of"]:
                raise ValueError("future_observation")
            if any(not _finite(bar.get(key)) for key in ("open", "high", "low", "close", "volume")):
                raise ValueError("invalid_observation")
            bars.append({key: bar[key] for key in ("dt", "open", "high", "low", "close", "volume")})
        if request.get("decision_schema") is not None:
            return self._compiled_payload(request, bars)
        state = {
            "strategy": strategy,
            "as_of": request["as_of"],
            "position": request["state"],
            "indicators": _indicators(bars),
            "observation_window": {"available": len(bars), "shown": min(len(bars), 20)},
            "observations": bars[-20:],
        }
        while _state_bytes(state) > STATE_BYTE_BUDGET and len(state["observations"]) > 1:
            state["observations"].pop(0)
            state["observation_window"]["shown"] -= 1
        if _state_bytes(state) > STATE_BYTE_BUDGET:
            raise ValueError("input_budget_exceeded")
        return {
            "state": state,
            "questions": {
                "action": {
                    "type": "choice",
                    "instructions": (
                        "사용자 strategy와 현재 관측값에 맞는 행동은? "
                        "Choose the action that obeys strategy using only observed data. "
                        "Missing evidence means wait/hold."
                    ),
                    "criteria": {action: ACTION_TEXT[action] for action in actions},
                }
            },
            "max_len": MAX_LEN,
            "head_max_len": HEAD_MAX_LEN,
        }

    def _compiled_payload(self, request, bars):
        schema = validate_schema(request["decision_schema"], request["strategy"])
        holding = request["state"]["holding"]
        question = schema["holding" if holding else "flat"]
        # Only the active question needs warmup. A holding-only indicator must
        # never prevent a flat-state question from being evaluated.
        references = question_references(question)
        metrics = {**bars[-1], **_indicators(bars)}
        metrics.update({key: request["state"][key] for key in ("cash", "qty", "entry_price")})
        if not holding:
            metrics["entry_price"] = None
        entry = metrics["entry_price"]
        metrics["unrealized_return_pct"] = (
            (metrics["close"] / entry - 1) * 100 if _finite(entry) and entry > 0 else None
        )
        missing = sorted(key for key in references if not _finite(metrics.get(key)))
        if missing:
            raise ValueError("missing_observation:" + ",".join(missing))
        observations = {key: metrics[key] for key in sorted(references)}
        rendered = render_question(question, observations)
        rendered["criteria"] = {
            action: rendered["criteria"][action] for action in request["allowed_actions"]
        }
        state = {
            "as_of": request["as_of"],
            "holding": holding,
            "available_bars": len(bars),
            "observations": observations,
        }
        if _state_bytes(state) > MAX_LEN - COMPILED_HEAD_MAX_LEN - 16:
            raise ValueError("compiled_input_budget_exceeded")
        return {
            "state": state,
            "questions": {"action": rendered},
            "max_len": MAX_LEN,
            "head_max_len": COMPILED_HEAD_MAX_LEN,
        }

    def __call__(self, request):
        audit = {
            "prompt_version": PROMPT_VERSION,
            "endpoint": self.base_url,
            "policy": {
                "min_answer_probability": self.min_answer_probability,
                "min_margin": self.min_margin,
                "finance_calibrated": False,
            },
            "request": None,
            "response": None,
        }
        result = {"action": None, "raw_action": None, "raw": audit}
        try:
            if request.get("decision_schema") is not None:
                audit["prompt_version"] = "natural-schema-v1"
                audit["decision_schema"] = validate_schema(
                    request["decision_schema"], request["strategy"]
                )
            payload = self.build_payload(request)
            audit["request"] = payload
            audit["request_sha256"] = hashlib.sha256(_json(payload).encode("utf-8")).hexdigest()
        except (ValueError, TypeError, KeyError, IndexError) as error:
            result["fallback_reason"] = "invalid_input:" + str(error)
            return result
        try:
            response = self._request(payload)
            audit["response"] = response
        except (OSError, ValueError, TypeError, HTTPException, HTTPError, URLError):
            result["fallback_reason"] = "server_unavailable_or_invalid_json"
            return result
        try:
            answer = response["answers"]["action"]
            result["raw_action"] = answer.get("choice")
            probabilities = answer["probabilities"]
            confidence = answer["answer_confidence"]
            legal = request["allowed_actions"]
            if (
                answer.get("type") != "choice"
                or answer.get("choice") not in legal
                or not isinstance(probabilities, dict)
                or set(probabilities) != set(legal)
                or any(not _finite(p) or not 0 <= p <= 1 for p in probabilities.values())
                or abs(sum(probabilities.values()) - 1) > 0.002
                or not _finite(confidence)
                or not 0 <= confidence <= 1
                or abs(confidence - probabilities[answer["choice"]]) > 0.002
                or probabilities[answer["choice"]] < max(probabilities.values())
            ):
                raise ValueError("malformed_choice")
            usage = response["usage"]
            if (
                type(usage.get("input_tokens")) is not int
                or usage["input_tokens"] <= 0
                or usage.get("output_tokens") != 0
            ):
                raise ValueError("malformed_usage")
            if usage["input_tokens"] >= MAX_LEN or usage.get("options"):
                raise ValueError("truncated_input_or_options")
            runtime = response["runtime"]
            if runtime.get("model_id") != MODEL_ID or runtime.get("revision") != REVISION:
                raise ValueError("unexpected_model")
            result["probabilities"] = probabilities
            result["answer_confidence"] = confidence
            if confidence < self.min_answer_probability:
                raise ValueError("probability_below_policy_floor")
            if abs(probabilities[legal[0]] - probabilities[legal[1]]) <= self.min_margin:
                raise ValueError("ambiguous_choice")
            result["action"] = answer["choice"]
            return result
        except (ValueError, TypeError, KeyError, AttributeError) as error:
            result["fallback_reason"] = (
                str(error) if isinstance(error, ValueError) else "malformed_response"
            )
            return result

    decide = __call__
