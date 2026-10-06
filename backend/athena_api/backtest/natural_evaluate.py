"""Run a labelled condition-compliance experiment against the actual local LAYA.

From backend: python -m athena_api.backtest.natural_evaluate --output report.json
Synthetic observations have no claim about price prediction or financial returns.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

from .natural_laya import PROMPT_VERSION, NaturalLayaClient


def condition_cases():
    definitions = [
        (
            "and",
            "종가가 100보다 크고 거래량이 1000보다 클 때만 진입하고, 그렇지 않으면 관망하세요.",
            "Enter only when close is greater than 100 AND volume is greater than 1000; "
            "otherwise wait.",
            [(101, 1001), (101, 999), (99, 1001), (99, 999), (100, 1000)],
            lambda close, volume: close > 100 and volume > 1000,
            False,
        ),
        (
            "or",
            "종가가 100보다 크거나 거래량이 1000보다 크면 진입하고, 둘 다 아니면 관망하세요.",
            "Enter when close is greater than 100 OR volume is greater than 1000; otherwise wait.",
            [(101, 1001), (101, 999), (99, 1001), (99, 999), (100, 1000)],
            lambda close, volume: close > 100 or volume > 1000,
            False,
        ),
        (
            "negation_boundary",
            "종가가 100 이하이면 진입하지 마세요. 종가가 100을 초과할 때만 진입하세요.",
            "Do not enter if close is at most 100. Enter only if close exceeds 100.",
            [(99.99, 1000), (100, 1000), (100.01, 1000)],
            lambda close, volume: close > 100,
            False,
        ),
        (
            "exit_or",
            "보유 중 종가가 95 이하이거나 거래량이 500 미만이면 청산하고, 아니면 보유하세요.",
            "While holding, exit if close is at most 95 OR volume is below 500; otherwise hold.",
            [(94, 1000), (100, 499), (95, 500), (100, 500)],
            lambda close, volume: close <= 95 or volume < 500,
            True,
        ),
    ]
    cases = []
    for name, ko, en, examples, predicate, holding in definitions:
        for language, strategy in (("ko", ko), ("en", en)):
            for number, (close, volume) in enumerate(examples):
                active, passive = ("exit", "hold") if holding else ("enter", "wait")
                request = {
                    "strategy": strategy,
                    "as_of": "2025-01-02",
                    "observations": [
                        {
                            "dt": "2025-01-02",
                            "open": close,
                            "high": close,
                            "low": close,
                            "close": close,
                            "volume": volume,
                        }
                    ],
                    "state": {
                        "holding": holding,
                        "cash": 9000 if holding else 10000,
                        "qty": 10 if holding else 0,
                        "entry_price": 100 if holding else 0,
                        "pending_entry": False,
                        "pending_exit": False,
                    },
                    "allowed_actions": [active, passive],
                }
                cases.append(
                    {
                        "id": f"{name}_{language}_{number}",
                        "suite": name,
                        "language": language,
                        "request": request,
                        "expected": active if predicate(close, volume) else passive,
                    }
                )
    return cases


def _metrics(rows):
    count = len(rows)
    return {
        "count": count,
        "raw_correct": sum(row["raw_correct"] for row in rows),
        "raw_accuracy": sum(row["raw_correct"] for row in rows) / count if count else None,
        "accepted_correct": sum(row["accepted_correct"] for row in rows),
        "accepted_accuracy": sum(row["accepted_correct"] for row in rows) / count
        if count
        else None,
        "coverage": sum(row["decision"]["action"] is not None for row in rows) / count
        if count
        else None,
        "always_passive_accuracy": sum(row["expected"] == row["passive_action"] for row in rows)
        / count
        if count
        else None,
        "false_active": sum(
            row["accepted_action"] in {"enter", "exit"} and not row["accepted_correct"]
            for row in rows
        ),
        "missed_active": sum(
            row["expected"] in {"enter", "exit"} and not row["accepted_correct"] for row in rows
        ),
        "fallback_reasons": dict(
            Counter(row["decision"].get("fallback_reason", "accepted") for row in rows)
        ),
    }


def evaluate(client, *, repeats=2):
    if repeats < 1:
        raise ValueError("repeats must be positive")
    cases = condition_cases()
    rows = []
    for repeat in range(repeats):
        for case in cases:
            for reverse in (False, True):
                request = dict(case["request"])
                request["allowed_actions"] = (
                    list(reversed(request["allowed_actions"]))
                    if reverse
                    else list(request["allowed_actions"])
                )
                decision = client(request)
                passive = "hold" if request["state"]["holding"] else "wait"
                accepted = decision["action"] or passive
                rows.append(
                    {
                        "case_id": case["id"],
                        "suite": case["suite"],
                        "language": case["language"],
                        "repeat": repeat,
                        "reversed_options": reverse,
                        "expected": case["expected"],
                        "passive_action": passive,
                        "accepted_action": accepted,
                        "raw_correct": decision.get("raw_action") == case["expected"],
                        "accepted_correct": accepted == case["expected"],
                        "decision": decision,
                    }
                )
    by_key = {(r["case_id"], r["repeat"], r["reversed_options"]): r for r in rows}
    flip_pairs = [
        (by_key[(c["id"], repeat, False)], by_key[(c["id"], repeat, True)])
        for c in cases
        for repeat in range(repeats)
    ]
    repeat_pairs = [
        (by_key[(c["id"], 0, reverse)], by_key[(c["id"], repeat, reverse)])
        for c in cases
        for reverse in (False, True)
        for repeat in range(1, repeats)
    ]
    case_json = json.dumps(cases, ensure_ascii=False, sort_keys=True, allow_nan=False)
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "prompt_version": PROMPT_VERSION,
        "dataset_sha256": hashlib.sha256(case_json.encode("utf-8")).hexdigest(),
        "identity": client.identity(),
        "repeats": repeats,
        "summary": _metrics(rows),
        "by_language": {
            language: _metrics([r for r in rows if r["language"] == language])
            for language in ("ko", "en")
        },
        "by_suite": {
            suite: _metrics([r for r in rows if r["suite"] == suite])
            for suite in sorted({r["suite"] for r in rows})
        },
        "option_order": {
            "pairs": len(flip_pairs),
            "raw_disagreements": sum(
                a["decision"].get("raw_action") != b["decision"].get("raw_action")
                for a, b in flip_pairs
            ),
        },
        "repeatability": {
            "pairs": len(repeat_pairs),
            "raw_disagreements": sum(
                a["decision"].get("raw_action") != b["decision"].get("raw_action")
                for a, b in repeat_pairs
            ),
        },
        "limitations": [
            "Synthetic condition compliance only; no future price prediction "
            "or profitability measured.",
            "Expected labels are computed by the evaluator and never included in model requests.",
            "Probability and margin floors are uncalibrated policies fixed before this experiment.",
            "Accepted accuracy includes passive fallback; "
            "compare coverage and always-passive baseline.",
        ],
        "rows": rows,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:8768")
    parser.add_argument("--repeats", type=int, default=2)
    args = parser.parse_args()
    client = NaturalLayaClient(args.base_url)
    if client.identity().get("status") != "ready":
        parser.error("The pinned local LAYA is unavailable; no actual-model benchmark was run.")
    report = evaluate(client, repeats=args.repeats)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                key: report[key]
                for key in ("summary", "by_language", "option_order", "repeatability")
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
