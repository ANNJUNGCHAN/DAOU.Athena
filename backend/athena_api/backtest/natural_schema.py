"""Validate and seal model-authored LAYA questions, never executable strategy code."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping

SCHEMA_VERSION = 1
INSTRUCTION_BYTE_LIMIT = 320
OPTION_BYTE_LIMIT = 44
HEAD_BYTE_LIMIT = 480
OBSERVATIONS = {
    "open": "Current completed bar open price",
    "high": "Current completed bar high price",
    "low": "Current completed bar low price",
    "close": "Current completed bar close price",
    "volume": "Current completed bar trading volume",
    "previous_close": "Previous completed bar close; unavailable before the second bar",
    "sma_5": "Mean of the latest 5 completed closes; unavailable before 5 bars",
    "sma_20": "Mean of the latest 20 completed closes; unavailable before 20 bars",
    "volume_ma_5": "Mean of the latest 5 completed volumes; unavailable before 5 bars",
    "cash": "Current simulated cash after this bar's fills and fees",
    "qty": "Current simulated quantity, zero when flat",
    "entry_price": "Executed entry price; unavailable while flat",
    "unrealized_return_pct": "(current close / executed entry price - 1) * 100; holding only",
}
_REFERENCE = re.compile(r"\{([A-Za-z][A-Za-z0-9_]*)\}")
_DRAFT_KEYS = {"title", "explanation", "required_observations", "flat", "holding"}
_SEALED_KEYS = _DRAFT_KEYS | {"schema_version", "source_text", "author", "schema_hash"}


def _copy(value):
    return json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))


def _hash(value):
    data = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def _keys(value, expected, location):
    if not isinstance(value, Mapping) or set(value) != expected:
        raise ValueError(f"{location}: expected only {', '.join(sorted(expected))}")


def _text(value, location, max_chars):
    if not isinstance(value, str) or not value.strip() or len(value) > max_chars:
        raise ValueError(f"{location}: provide 1..{max_chars} characters")
    # LAYA uses this token as a structural marker and replaces it in input text.
    if "<mask>" in value:
        raise ValueError(f"{location}: reserved LAYA token <mask> is unsupported")


def question_references(question):
    texts = [question["instructions"], *question["criteria"].values()]
    references = set()
    for value in texts:
        references.update(_REFERENCE.findall(value))
        if "{" in _REFERENCE.sub("", value) or "}" in _REFERENCE.sub("", value):
            raise ValueError(
                "questions: use simple supported observation references such as {close}"
            )
    unsupported = references - OBSERVATIONS.keys()
    if unsupported:
        raise ValueError("Unsupported observations: " + ", ".join(sorted(unsupported)))
    return references


def validate_question_budget(question, location):
    instruction_bytes = len(question["instructions"].encode("utf-8"))
    if instruction_bytes > INSTRUCTION_BYTE_LIMIT:
        raise ValueError(
            f"{location}.instructions: {instruction_bytes} UTF-8 bytes exceeds "
            f"{INSTRUCTION_BYTE_LIMIT}; shorten the question without dropping conditions"
        )
    total = len(b"choice question: ") + instruction_bytes + 8
    for key, text in question["criteria"].items():
        size = len(f" {key}: {text}".encode())
        if size > OPTION_BYTE_LIMIT:
            raise ValueError(
                f"{location}.criteria.{key}: {size} UTF-8 bytes exceeds {OPTION_BYTE_LIMIT}; "
                "shorten the criterion without losing its condition; "
                "define shared context in instructions"
            )
        total += size
    if total > HEAD_BYTE_LIMIT:
        raise ValueError(f"{location}: question exceeds the {HEAD_BYTE_LIMIT}-byte head budget")


def _validate_draft(draft):
    _keys(draft, _DRAFT_KEYS, "draft")
    _text(draft["title"], "title", 120)
    _text(draft["explanation"], "explanation", 2000)
    required = draft["required_observations"]
    if (
        not isinstance(required, list)
        or any(not isinstance(key, str) for key in required)
        or len(set(required)) != len(required)
    ):
        raise ValueError("required_observations: provide unique supported observation names")
    references = set()
    for name, actions in (("flat", {"enter", "wait"}), ("holding", {"exit", "hold"})):
        question = draft[name]
        _keys(question, {"type", "instructions", "criteria"}, name)
        if question["type"] != "choice":
            raise ValueError(f"{name}.type: only choice is supported")
        _text(question["instructions"], name + ".instructions", 2000)
        _keys(question["criteria"], actions, name + ".criteria")
        for key, value in question["criteria"].items():
            _text(value, f"{name}.criteria.{key}", 200)
        references.update(question_references(question))
        validate_question_budget(question, name)
    if set(required) != references:
        raise ValueError(
            "required_observations must exactly match references in flat/holding questions: "
            + ", ".join(sorted(references))
        )
    return _copy(draft)


def seal_schema(draft, source_text, author):
    """Attach source and actual compiler identity supplied by the application."""
    result = _validate_draft(draft)
    _text(source_text, "source_text", 2000)
    _keys(author, {"provider", "model"}, "author")
    for key, value in author.items():
        _text(value, "author." + key, 160)
    result.update(schema_version=SCHEMA_VERSION, source_text=source_text, author=_copy(author))
    result["schema_hash"] = _hash(result)
    return result


def validate_schema(schema, source_text=None):
    """Return a detached schema only when all fields and its immutable binding match."""
    _keys(schema, _SEALED_KEYS, "decision_schema")
    if type(schema["schema_version"]) is not int or schema["schema_version"] != SCHEMA_VERSION:
        raise ValueError("Unsupported decision_schema.schema_version")
    if source_text is not None and schema["source_text"] != source_text:
        raise ValueError("decision_schema source_text does not match the confirmed strategy")
    expected = seal_schema(
        {key: schema[key] for key in _DRAFT_KEYS}, schema["source_text"], schema["author"]
    )
    if schema["schema_hash"] != expected["schema_hash"]:
        raise ValueError("decision_schema hash mismatch; prepare and confirm the changed schema")
    return expected


def render_question(question, observations):
    """Substitute only finite, code-computed observation values into text, without eval."""

    def render(text):
        return _REFERENCE.sub(
            lambda match: json.dumps(observations[match.group(1)], allow_nan=False), text
        )

    result = {
        "type": "choice",
        "instructions": render(question["instructions"]),
        "criteria": {key: render(value) for key, value in question["criteria"].items()},
    }
    validate_question_budget(result, "rendered question")
    return result


def draft_json_schema():
    """Constrained JSON output contract for the higher-level strategy compiler."""

    def question(actions):
        return {
            "type": "object",
            "additionalProperties": False,
            "required": ["type", "instructions", "criteria"],
            "properties": {
                "type": {"type": "string", "const": "choice"},
                "instructions": {
                    "type": "string",
                    "minLength": 1,
                    "description": (
                        "Use {observation} references, e.g. {close} > 100 AND {volume} >= 1500. "
                        "State complete conditions and passive alternative. At most 320 UTF-8 "
                        "bytes; concise English is acceptable while explanation stays Korean."
                    ),
                },
                "criteria": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": list(actions),
                    "properties": {
                        action: {
                            "type": "string",
                            "minLength": 1,
                            "description": "Describe the condition that makes this action correct, "
                            "not merely an action label. Criterion plus key must fit 44 UTF-8 "
                            "bytes. Use instructions for shared context without losing predicates.",
                        }
                        for action in actions
                    },
                },
            },
        }

    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["title", "explanation", "required_observations", "flat", "holding"],
        "properties": {
            "title": {"type": "string", "minLength": 1, "maxLength": 120},
            "explanation": {
                "type": "string",
                "minLength": 1,
                "maxLength": 2000,
                "description": "Explain entry, exit, AND/OR/NOT, exact boundaries and warmup "
                "for user confirmation. Do not invent missing conditions or observations.",
            },
            "required_observations": {
                "type": "array",
                "items": {"type": "string", "enum": list(OBSERVATIONS)},
                "description": "Exactly the union of {observation} references in both questions.",
            },
            "flat": question(("enter", "wait")),
            "holding": question(("exit", "hold")),
        },
    }
