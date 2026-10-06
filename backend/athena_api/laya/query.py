"""Catalog-bound shortlist ranking and exact categorical argument decisions."""
from copy import deepcopy

from fastapi import HTTPException

from athena_api.laya.service import TurnExpired
from athena_api.security import require_local_bearer
from athena_api.selector.schemas import DiscoveryIntent, ResponseMode
from athena_api.selector.service import _intent_allows


def query_context(request, utterance):
    service = getattr(request.app.state, "laya_service", None)
    if service is None:
        return None
    try:
        require_local_bearer(request, request.headers.get("authorization", ""))
    except HTTPException:
        return None
    ticket = request.headers.get("x-athena-laya-ticket")
    if ticket:
        try:
            turn = service.context(ticket, lease_id=request.headers.get("x-athena-laya-lease", ""),
                                   generation_id=request.headers.get("x-athena-laya-generation", ""))
        except TurnExpired:
            service.client.counts["query_turn_expired"] += 1
            return None
        if turn["origin"] == "backtest":
            return None
        return service, turn["utterance"], turn["context"], turn["protected_fields"], ticket
    # Authenticated direct app/API queries still have an original question. They
    # have no authority to overwrite structured caller values, only fill omissions.
    state = getattr(request, "state", None)
    return (service, getattr(state, "laya_original_question", utterance),
            getattr(state, "laya_semantic_context", {}), {}, None)


def compatible_catalog(service, selector):
    if not getattr(service, "catalog", None):
        return False
    if service.selector_catalog_version != selector.catalog.version:
        service.client.counts["query_catalog_mismatch"] += 1
        return False
    return True


async def rerank_search(request, payload, selector, response):
    if len(response.results) <= 1:
        return response
    bound = query_context(request, payload.query)
    if not bound:
        return response
    service, utterance, context, _, ticket = bound
    if not compatible_catalog(service, selector) or payload.intent.value not in {"auto", "query", "websocket"}:
        return response
    bank = {candidate["operation_ref"]: candidate for candidate in service.catalog["query_candidates"]}
    eligible = []
    for hit in response.results:
        document = selector.catalog.find_exact(hit.operation_ref)
        candidate = bank.get(hit.operation_ref)
        if (candidate and document and document.kind in {"query", "websocket"} and document.generic_callable
                and _intent_allows(document, payload.intent)
                and document.kind == candidate.get("kind")
                and document.name == candidate.get("name") and document.domain == candidate.get("domain")):
            eligible.append((hit.operation_ref, candidate))
    if not eligible:
        return response
    decisions = await service.client.decide([{"task_id": "query.operation_relevance",
        "candidate_id": candidate["candidate_id"], "utterance": utterance, "context": context}
        for _, candidate in eligible])
    if ticket:
        service.context(ticket)
    grades = {ref: row for (ref, _), row in zip(eligible, decisions, strict=True)}

    def rank(hit):
        decision = grades.get(hit.operation_ref, {})
        label = decision.get("label") if decision.get("accepted") else None
        return 0 if label == "relevant" else 2 if label == "not_relevant" else 1

    # Retain all retrieved candidates and code-owned typed confidence. Pairwise
    # relevance neither proves unique selection nor overrides resolve's guards.
    ranked = sorted(response.results, key=rank)
    return response.model_copy(update={"results": ranked, "semantic_ranking": {
        "candidate_count": len(eligible), "accepted_count": sum(row["accepted"] for row in decisions),
        "reordered": [row.operation_ref for row in ranked] != [row.operation_ref for row in response.results],
        "deployment_sha256": service.client.deployment_sha256,
    }})


async def refine_arguments(request, payload, selector):
    bound = query_context(request, payload.question)
    if not bound:
        return payload
    service, utterance, context, protected, ticket = bound
    if not compatible_catalog(service, selector) or payload.intent.value not in {"auto", "query"}:
        return payload
    document = selector.catalog.find_exact(payload.preferred_ref) if payload.preferred_ref else None
    if document is None and not payload.preferred_ref:
        # Reuse the selector's code-owned identity/compatibility decision. Never
        # turn pairwise relevance into a preferred identity assertion.
        document, _ = selector._exact_identity(payload.question, payload.intent)
        if document is None:
            selection = selector._compatibility_decision(payload.question, payload.intent)
            ref = selection.selected_operation_ref
            document = selector.catalog.find_exact(ref) if ref else None
    if document is None or document.kind != "query" or not document.generic_callable:
        return payload
    fields = {field.alias or name: field for name, field in document.request_model.model_fields.items()}
    groups = {}
    for candidate in service.catalog["query_argument_candidates"]:
        aliases = candidate.get("qualified_aliases", [candidate])
        for alias in aliases:
            if alias["operation_ref"] != document.operation_ref:
                continue
            field = alias["field"]
            live_field = fields.get(field)
            if live_field is not None and live_field.description == candidate.get("field_description"):
                groups.setdefault(field, []).append(candidate)
    result = deepcopy(payload.arguments)
    remaining = 32
    for field, candidates in groups.items():
        # API callers' provided structured choices are authoritative. The opaque
        # app ticket distinguishes LLM-proposed fields from explicit human values.
        if (not ticket and field in result
                or "athena_resolve.arguments." + field in protected
                or len(candidates) > remaining):
            continue
        remaining -= len(candidates)
        genuine_context = {"conversation": context, "selected_operation": document.operation_ref,
                           "requested_field": field}
        decisions = await service.client.decide([{"task_id": "query.argument_value_relevance",
            "candidate_id": candidate["candidate_id"], "utterance": utterance, "context": genuine_context}
            for candidate in candidates])
        positives = [candidate for candidate, row in zip(candidates, decisions, strict=True)
                     if row["accepted"] and row.get("label") == "relevant"]
        negatives = sum(row["accepted"] and row.get("label") == "not_relevant" for row in decisions)
        if len(positives) == 1 and negatives == len(candidates) - 1:
            result[field] = positives[0]["value"]
    if ticket:
        service.context(ticket)
    # Existing selector still resolves identity, validates the live schema, binds
    # trusted instruments, applies scope guards and seals the result itself.
    return payload.model_copy(update={"arguments": result})


async def refine_dispatch_request(request, payload, selector):
    """Same-request semantic defaults for the app's primary selector endpoint."""
    bound = query_context(request, payload.question)
    if not bound or payload.intent is DiscoveryIntent.ORDER:
        return payload
    service, utterance, context, _, _ = bound
    if not compatible_catalog(service, selector):
        return payload
    tasks = []
    if payload.intent is DiscoveryIntent.AUTO:
        tasks.append("query.intent")
    if payload.response_mode is ResponseMode.AUTO:
        tasks.append("query.response_mode")
    decisions = await service.client.decide([
        {"task_id": task, "utterance": utterance, "context": context} for task in tasks
    ]) if tasks else []
    updates = {}
    for row in decisions:
        if not row["accepted"]:
            continue
        # A semantic decision cannot grant order/subscription authorization.
        if row["task_id"] == "query.intent" and row["label"] == "query":
            updates["intent"] = DiscoveryIntent.QUERY
        elif row["task_id"] == "query.response_mode":
            updates["response_mode"] = ResponseMode(row["label"])
    return await refine_arguments(request, payload.model_copy(update=updates), selector)
