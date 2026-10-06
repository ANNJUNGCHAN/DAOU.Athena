"""Opt-in exhaustive selection through the existing pinned decision runtime."""
from __future__ import annotations

import asyncio
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from athena_api.selector.schemas import DescribeRequest, DiscoveryIntent


class CatalogSelectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    text: str = Field(min_length=1, max_length=4000)
    catalog_version: str = Field(min_length=1, max_length=128)


class CatalogCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation_ref: str
    kind: Literal["query", "websocket"]
    name: str
    detail_group: str | None
    group_title_ko: str | None
    group_title_en: str | None
    execution_policy: Literal["selector_query", "selector_detail"]
    required_arguments: list[dict[str, Any]]
    argument_contracts: dict[str, Any]


class CatalogSelectionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["accepted", "fallback"]
    task: Literal["operation_selection"] = "operation_selection"
    choice: str | None = None
    confidence: float | None = None
    reason: str
    catalog_version: str
    candidate: CatalogCandidate | None = None
    considered_count: int
    evaluated_count: int
    question_count: int


def catalog_candidate(selector, operation_ref):
    """Return the live server contract, never model-supplied arguments or schemas."""
    description = selector.describe(DescribeRequest(operation_ref=operation_ref, intent=DiscoveryIntent.QUERY))
    schema = selector.catalog.find_exact(operation_ref).request_model.model_json_schema(by_alias=True)
    contract = {"type": "object", "properties": schema.get("properties", {}),
                "required": schema.get("required", []), "additionalProperties": False}
    if "$defs" in schema:
        contract["$defs"] = schema["$defs"]
    return CatalogCandidate(operation_ref=description.operation_ref, kind=description.kind,
        name=description.name, detail_group=description.group_id,
        group_title_ko=description.group_title_ko, group_title_en=description.group_title_en,
        execution_policy=description.execution_policy,
        required_arguments=[item.model_dump() for item in description.required_arguments],
        argument_contracts=contract)


class LayaCatalogSelectionService:
    """One bounded full pass. No dynamic criteria, retrieval cutoff or execution."""
    def __init__(self, settings, runtime):
        self.settings, self.runtime = settings, runtime
        self.lock = asyncio.Lock()

    def candidates(self, selector, documents):
        runtime = self.runtime
        if getattr(runtime, "selector_catalog_version", None) != selector.catalog.version:
            return None
        catalog = getattr(runtime, "catalog", None)
        if not isinstance(catalog, dict):
            return None
        bank = catalog.get("query_candidates", [])
        if not isinstance(bank, list) or len(bank) != len(documents):
            return None
        by_ref, identifiers = {}, set()
        for candidate in bank:
            if not isinstance(candidate, dict):
                return None
            ref, identifier = candidate.get("operation_ref"), candidate.get("candidate_id")
            if (not isinstance(ref, str) or ref in by_ref or not isinstance(identifier, str)
                    or not identifier or identifier in identifiers):
                return None
            by_ref[ref] = candidate
            identifiers.add(identifier)
        result = []
        for document in documents:
            candidate = by_ref.get(document.operation_ref)
            if not candidate or any(candidate.get(field) != getattr(document, field) for field in ("name", "kind", "domain")):
                return None
            result.append(candidate)
        return result

    async def select_operation(self, request, selector):
        documents = tuple(doc for doc in selector.catalog.visible_for(DiscoveryIntent.QUERY) if doc.generic_callable)
        evaluated = questions = 0

        def response(reason, selected=None):
            candidate, decision = selected if selected else (None, None)
            return CatalogSelectionResponse(status="accepted" if selected else "fallback",
                choice=candidate["operation_ref"] if selected else None,
                confidence=decision["confidence"] if selected else None, reason=reason,
                catalog_version=selector.catalog.version,
                candidate=catalog_candidate(selector, candidate["operation_ref"]) if selected else None,
                considered_count=len(documents), evaluated_count=evaluated, question_count=questions)

        if not self.settings.laya_catalog_enabled:
            return response("disabled")
        if request.catalog_version != selector.catalog.version:
            return response("catalog_version_mismatch")
        candidates = self.candidates(selector, documents)
        if candidates is None:
            return response("candidate_bank_mismatch")
        if not candidates:
            return response("empty_catalog")
        if self.lock.locked():
            return response("busy")
        positives = []
        async with self.lock:
            try:
                async with asyncio.timeout(self.settings.laya_catalog_timeout_seconds):
                    for start in range(0, len(candidates), 32):
                        batch = candidates[start:start + 32]
                        questions += len(batch)
                        decisions = await self.runtime.client.decide([
                            {"task_id": "query.operation_relevance", "candidate_id": candidate["candidate_id"],
                             "utterance": request.text, "context": {}} for candidate in batch])
                        for candidate, decision in zip(batch, decisions, strict=True):
                            label = decision.get("label")
                            if label in {"relevant", "not_relevant", "defer"}:
                                evaluated += 1
                            if (not decision.get("accepted") or label not in {"relevant", "not_relevant"}
                                    or decision.get("defer_override") or decision.get("original_top_label") == "defer"):
                                return response("uncertain")
                            if label == "relevant":
                                positives.append((candidate, decision))
            except TimeoutError:
                return response("timeout")
            except (ValueError, TypeError, KeyError):
                return response("invalid_response")
        if evaluated != len(candidates):
            return response("incomplete_coverage")
        if len(positives) != 1:
            return response("ambiguous" if positives else "no_match")
        return response("selected", positives[0])
