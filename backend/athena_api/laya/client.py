"""Bounded authenticated loopback transport; the backend does not import Torch."""
from __future__ import annotations

from collections import Counter
import math
import time
from urllib.parse import urlsplit

import httpx


class RuntimeClient:
    def __init__(self, url: str, token: str, deployment_sha256: str, *, timeout=2.5, transport=None):
        parsed = urlsplit(url)
        if (parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
                or parsed.username or parsed.password or parsed.query or parsed.fragment):
            raise ValueError("laya_runtime_must_be_loopback")
        self.url, self.token, self.deployment_sha256 = url.rstrip("/"), token, deployment_sha256
        self.timeout, self.transport = timeout, transport
        self.counts = Counter()
        self.last_timing = {}

    async def decide(self, requests: list[dict]) -> list[dict]:
        reason = "unconfigured"
        started = time.monotonic()
        request_started = response_finished = None
        timing = {}
        if self.token and self.deployment_sha256:
            try:
                async with httpx.AsyncClient(timeout=self.timeout, transport=self.transport,
                                             trust_env=False) as client:
                    request_started = time.monotonic()
                    try:
                        response = await client.post(self.url + "/decide", json={
                            "deployment_sha256": self.deployment_sha256, "requests": requests},
                            headers={"Authorization": "Bearer " + self.token})
                    finally:
                        response_finished = time.monotonic()
                response.raise_for_status()
                payload = response.json()
                runtime_timing = payload.get("timings", {})
                if isinstance(runtime_timing, dict):
                    timing["runtime_timings"] = {key: value for key, value in runtime_timing.items()
                        if key in {"lock_wait_ms", "processing_ms", "total_ms"}
                        and type(value) in (int, float) and math.isfinite(value) and value >= 0}
                if payload.get("identity", {}).get("deployment_sha256") != self.deployment_sha256:
                    reason = "deployment_mismatch"
                else:
                    decisions = payload.get("decisions")
                    if self._valid_decisions(requests, decisions):
                        for row in decisions:
                            self.counts[row["reason"]] += 1
                        return decisions
                    reason = "invalid_response"
            except httpx.TimeoutException:
                reason = "timeout"
            except (httpx.HTTPError, ValueError, TypeError):
                reason = "unavailable"
            finally:
                finished = time.monotonic()
                timing["total_ms"] = (finished - started) * 1000
                if request_started is not None:
                    timing["client_setup_ms"] = (request_started - started) * 1000
                if response_finished is not None:
                    timing["http_ms"] = (response_finished - request_started) * 1000
                    timing["close_ms"] = (finished - response_finished) * 1000
                self.last_timing = timing
        else:
            self.last_timing = {"total_ms": (time.monotonic() - started) * 1000}
        self.counts[reason] += len(requests)
        return [{"task_id": row["task_id"], "accepted": False, "reason": reason} for row in requests]

    @staticmethod
    def _valid_decisions(requests, decisions):
        if not isinstance(decisions, list) or len(decisions) != len(requests):
            return False
        for request, decision in zip(requests, decisions, strict=True):
            if (not isinstance(decision, dict) or decision.get("task_id") != request["task_id"]
                    or type(decision.get("accepted")) is not bool or not isinstance(decision.get("reason"), str)):
                return False
            if decision["accepted"]:
                confidence, threshold = decision.get("confidence"), decision.get("threshold")
                if (not isinstance(decision.get("label"), str) or decision["label"] == "defer"
                        or not isinstance(confidence, (int, float)) or not math.isfinite(confidence)
                        or not isinstance(threshold, (int, float)) or not math.isfinite(threshold)
                        or not 0 <= threshold <= confidence <= 1 or decision["reason"] != "accepted"):
                    return False
        return True
