"""Athena-owned inference process, launched with the installed LAYA SDK Python."""
from __future__ import annotations

import argparse
from collections import Counter
from contextlib import contextmanager
import os
from pathlib import Path
import secrets
import threading
import time
from fastapi import Request

from athena_api.laya.contracts import DecisionError, Deployment
from athena_api.laya.cancellation import until_disconnect


class InferenceCancelled(Exception):
    pass


def check_cancelled(cancelled):
    if cancelled is not None and cancelled.is_set():
        raise InferenceCancelled('inference_cancelled')


@contextmanager
def cancellation_hooks(model, cancelled):
    """Stop eager ModernBert execution between layers without changing inputs."""
    handles = []
    def before_layer(module, args):
        check_cancelled(cancelled)
    try:
        check_cancelled(cancelled)
        if cancelled is not None:
            # Head TransformerEncoderLayer hooks would disable its fused fastpath.
            for layer in getattr(model.encoder, 'layers', ()):
                handles.append(layer.register_forward_pre_hook(before_layer))
        yield
        check_cancelled(cancelled)
    finally:
        for handle in handles:
            handle.remove()


@contextmanager
def inference_lock(lock, cancelled):
    if cancelled is None:
        with lock:
            yield
        return
    while not cancelled.is_set():
        if lock.acquire(timeout=.05):
            try:
                if cancelled.is_set():
                    raise InferenceCancelled('inference_cancelled')
                yield
            finally:
                lock.release()
            return
    raise InferenceCancelled('inference_cancelled')


class SdkPredictor:
    def __init__(self, deployment: Deployment, device: str):
        os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1",
                          USE_TF="0", TOKENIZERS_PARALLELISM="false")
        import torch
        import laya
        torch.set_num_threads(min(4, os.cpu_count() or 1) if device == "cpu" else 2)
        if device == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("requested_device_unavailable")
        self.agent = laya.load(str(deployment.checkpoint), device=device, fast=False, compile=False)
        if str(self.agent.device).split(":")[0] != device:
            raise RuntimeError("device_mismatch")
        deployment.verify_checkpoint()  # SDK must not normalize/modify the artifact.
        self.deployment, self.device = deployment, device

    def __call__(self, state: str, question: dict, *, cancelled=None) -> list[float]:
        check_cancelled(cancelled)
        import torch
        from contextlib import nullcontext
        from laya.common import build_sequence, collate_items, render_options
        agent, deployment = self.agent, self.deployment
        ids, markers, stats = build_sequence(agent.tok, state, question,
            deployment.max_len, deployment.head_max_len, return_stats=True)
        full, _ = build_sequence(agent.tok, state, question, 32768, 32768)
        if (len(ids) != len(full) or len(markers) != len(question["crit"])
                or stats["options_distinct"] != len(question["crit"])
                or any(len(agent.tok(" " + text, add_special_tokens=False)["input_ids"]) > 48
                       for text in render_options(question))):
            raise DecisionError("input_truncated")
        item = {"ids": ids, "markers": markers, "qtype": 0}
        batch = collate_items([[item]], agent.tok.pad_token_id)
        batch = {key: value.to(agent.device) if isinstance(value, torch.Tensor) else value
                 for key, value in batch.items()}
        # Match the verified trainer/evaluator's forward; no SDK OOM-to-CPU fallback
        # and no rounded answer confidence. Each head keeps its own trained sequence.
        amp = torch.autocast("cuda", dtype=torch.bfloat16) if self.device == "cuda" else nullcontext()
        with cancellation_hooks(agent.model, cancelled), torch.inference_mode(), amp:
            logits, _ = agent.model(batch["input_ids"], batch["attention_mask"],
                batch["marker_pos"], batch["marker_mask"], batch["qtype"])
        return logits.float()[0, :len(markers)].cpu().tolist()


class DecisionRuntime:
    def __init__(self, deployment, predictor):
        self.deployment, self.predictor = deployment, predictor
        self.lock, self.counts = threading.Lock(), Counter()
        self.task_counts = {task: Counter() for task in deployment.contracts.tasks}

    def decide(self, requests, *, cancelled=None):
        results = []
        received = time.monotonic()
        with inference_lock(self.lock, cancelled):
            acquired = time.monotonic()
            for request in requests:
                if cancelled is not None and cancelled.is_set():
                    raise InferenceCancelled('inference_cancelled')
                started = time.monotonic()
                try:
                    state, question = self.deployment.contracts.encode(request)
                    logits = (self.predictor(state, question, cancelled=cancelled)
                              if isinstance(self.predictor, SdkPredictor)
                              else self.predictor(state, question))
                    result = self.deployment.contracts.decide(request["task_id"], logits)
                except InferenceCancelled:
                    raise
                except DecisionError as error:
                    result = {"task_id": request.get("task_id"), "accepted": False, "reason": str(error)}
                except Exception:
                    result = {"task_id": request.get("task_id"), "accepted": False, "reason": "inference_failed"}
                if cancelled is not None and cancelled.is_set():
                    raise InferenceCancelled('inference_cancelled')
                self.counts[result["reason"]] += 1
                task = self.task_counts.get(request.get("task_id"))
                if task is not None:
                    task["requests"] += 1
                    task["accepted" if result["accepted"] else "fallback"] += 1
                    task["reason:" + result["reason"]] += 1
                results.append({**result, "latency_ms": (time.monotonic() - started) * 1000})
        finished = time.monotonic()
        return {"identity": self.deployment.identity, "decisions": results,
                "timings": {"lock_wait_ms": (acquired - received) * 1000,
                            "processing_ms": (finished - acquired) * 1000,
                            "total_ms": (finished - received) * 1000}}


def create_app(deployment, predictor, token):
    from fastapi import FastAPI, Header, HTTPException
    if not token:
        raise ValueError("runtime_bearer_required")
    runtime = DecisionRuntime(deployment, predictor)
    app = FastAPI(title="Athena local semantic decisions", docs_url=None, redoc_url=None)

    def authorize(authorization):
        scheme, _, value = authorization.partition(" ")
        if scheme.lower() != "bearer" or not secrets.compare_digest(value, token):
            raise HTTPException(401, "Bearer authentication required")

    @app.get("/health")
    def health(authorization: str = Header(default="")):
        authorize(authorization)
        return {"status": "ready", "identity": deployment.identity, "device": getattr(predictor, "device", None),
                "counts": dict(runtime.counts),
                "task_counts": {task: dict(counts) for task, counts in runtime.task_counts.items()},
                "task_ids": sorted(deployment.contracts.tasks), "max_len": deployment.max_len,
                "head_max_len": deployment.head_max_len}

    @app.post("/decide")
    async def decide(payload: dict, request: Request, authorization: str = Header(default="")):
        authorize(authorization)
        requests = payload.get("requests")
        if not isinstance(requests, list) or not 1 <= len(requests) <= 32 or any(not isinstance(r, dict) for r in requests):
            raise HTTPException(422, "Provide 1 to 32 decisions")
        if payload.get("deployment_sha256") != deployment.manifest_sha256:
            raise HTTPException(409, "Deployment identity mismatch")
        from starlette.concurrency import run_in_threadpool
        cancelled = threading.Event()
        try:
            return await until_disconnect(request,
                run_in_threadpool(runtime.decide, requests, cancelled=cancelled), on_cancel=cancelled.set)
        except InferenceCancelled:
            raise HTTPException(499, 'Inference cancelled') from None

    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--deployment", type=Path, required=True)
    parser.add_argument("--device", choices=("cuda", "cpu"), default="cuda")
    parser.add_argument("--port", type=int, default=8769)
    args = parser.parse_args()
    token = os.environ.get("ATHENA_LAYA_RUNTIME_TOKEN", "")
    if not token:
        parser.error("ATHENA_LAYA_RUNTIME_TOKEN is required")
    deployment = Deployment(args.deployment)
    predictor = SdkPredictor(deployment, args.device)
    # Finish the first forward before exposing readiness. This is initialization,
    # not a user decision, so it does not enter DecisionRuntime counters/policy.
    state, question = deployment.contracts.encode({
        "task_id": "general.builtin_tool", "utterance": "안녕", "context": {}})
    predictor(state, question)
    import uvicorn
    uvicorn.run(create_app(deployment, predictor, token), host="127.0.0.1", port=args.port, workers=1)


if __name__ == "__main__":
    main()
