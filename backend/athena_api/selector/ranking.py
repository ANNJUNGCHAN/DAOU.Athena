"""Deterministic, explainable lexical ranking over the generated catalog."""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from functools import lru_cache

from .catalog import OperationCatalog, OperationDocument
from .eligibility import evaluate_eligibility
from .lexicon import (
    reviewed_canonical_terms,
    reviewed_query_fragments,
    synonym_only_tokens,
)
from .normalization import identity_tokens, normalize_text, tokenize
from .query_frame import extract_query_frame, mask_opaque_instrument_spans
from .schemas import (
    DiscoveryIntent,
    ReasonCode,
    ScoreContribution,
    SearchHit,
    SearchRequest,
    SearchResponse,
)


@dataclass(frozen=True, slots=True)
class RankedDocument:
    document: OperationDocument
    score: int
    contributions: tuple[ScoreContribution, ...]
    typed_tier: int = 0

    @property
    def title_score(self) -> int:
        """Points earned by the operation's own name.

        Kept separate because a name is a claim about identity and every other zone is
        corroboration. Two families that corroborate a question equally well are not
        ambiguous if the question named one of them better.
        """
        return sum(item.points for item in self.contributions if item.scope == "title")

    @property
    def semantic_score(self) -> int:
        identity_reasons = {
            ReasonCode.EXACT_OPERATION_REF,
            ReasonCode.EXACT_TR_ID,
            ReasonCode.EXACT_GROUP_ID,
            ReasonCode.TR_ID_TOKEN_MATCH,
        }
        return sum(
            contribution.points
            for contribution in self.contributions
            if contribution.reason_code not in identity_reasons
        )

    @property
    def authoritative_score(self) -> int:
        """Lexical support allowed to authorize resolve/plan selection."""
        return sum(contribution.points for contribution in self.contributions)


_ZONE_RULES = {
    "title": (ReasonCode.TITLE_TOKEN_MATCH, 150, 750),
    "family_capability": (ReasonCode.PROJECTION_TITLE_MATCH, 150, 750),
    # The TR's prose note, scored well below its name. An overview explains how to use an
    # operation, so it repeats mechanism vocabulary - 등록, 수신, 실시간, 종목코드 - that
    # says nothing about which operation was asked for. It earns points because a question
    # sometimes lands only there, never enough to overturn a name.
    "overview": (ReasonCode.OVERVIEW_MATCH, 60, 300),
    # The FID fields a realtime type emits. This is the only content-bearing vocabulary a
    # websocket type has: its envelope is shared across all 23, so response_alias and
    # response_description are constant on that surface and cannot rank anything.
    "realtime_field": (ReasonCode.REALTIME_FIELD_MATCH, 90, 600),
    "domain": (ReasonCode.DOMAIN_MATCH, 80, 400),
    "request_alias": (ReasonCode.REQUEST_FIELD_MATCH, 70, 350),
    "response_alias": (ReasonCode.RESPONSE_FIELD_MATCH, 50, 500),
}

_CAPABILITY_STOP_TOKENS = frozenset(
    {
        "account",
        "current",
        "data",
        "identity",
        "industry",
        "information",
        "market",
        "snapshot",
        "stock",
        "sector",
        "top",
        "계좌",
        "기본",
        "시장",
        "업종",
        "정보",
        "종목",
        "현재",
    }
)

# Full marks for a document that matches every distinct token of the question.
_COVERAGE_POINTS = 600

# What an operation is *called* is the claim; its domain, its prose note and its field
# descriptions are corroboration. Uncapped, corroboration outvotes the claim: the four
# supporting zones sum past 1,000 while a name caps at 750, so a wordy operation beats a
# correctly-named one. `ka10171 조건검색 목록조회` is the case that exposed it - it alone
# matches 목록 in its title, then loses to `ka10173` because it takes no request arguments
# and so cannot collect the 350 points its sibling earns from restating the family's own
# vocabulary in field descriptions. An operation must not rank higher for being verbose.
# `family_projection` is deliberately absent: a projection title is the family's own name in
# another language, not corroboration for it.
_CORROBORATION_ZONES = frozenset(
    {
        "overview",
        "domain",
        "realtime_field",
        "request_alias",
        "response_alias",
    }
)
_CORROBORATION_CAP = 750


def _contribution(
    reason: ReasonCode, points: int, terms: set[str], scope: str
) -> ScoreContribution:
    return ScoreContribution(
        reason_code=reason,
        points=points,
        matched_terms=sorted(terms)[:10],
        scope=scope,
    )


_ZONE_TOKEN_CACHE: dict[tuple[str, str], frozenset[str]] = {}
_SEEN_FAMILY_REFS: OrderedDict[str, None] = OrderedDict()
_SEEN_FAMILY_LIMIT = 64
_RETRIEVAL_FLOOR = 12
_RETRIEVAL_CAP = 64
_SURFACE_INDEX_CACHE: OrderedDict[tuple[str, str], _SurfaceIndex] = OrderedDict()
_SURFACE_INDEX_CACHE_LIMIT = 8
_SEEN_REASONS = frozenset(
    {
        ReasonCode.EXACT_OPERATION_REF,
        ReasonCode.EXACT_TR_ID,
        ReasonCode.EXACT_GROUP_ID,
        ReasonCode.TR_ID_TOKEN_MATCH,
        ReasonCode.TITLE_PHRASE_MATCH,
        ReasonCode.PROJECTION_TITLE_MATCH,
    }
)


def mark_seen_family(family_ref: str) -> None:
    """Record a family that already survived resolve in this process.

    ToolRerank treats seen tools as well-calibrated: extra candidates past the
    top hit mostly add noise. Unseen families keep a wider window.
    """
    ref = str(family_ref or "").strip()
    if not ref:
        return
    if ref in _SEEN_FAMILY_REFS:
        _SEEN_FAMILY_REFS.move_to_end(ref)
        return
    _SEEN_FAMILY_REFS[ref] = None
    while len(_SEEN_FAMILY_REFS) > _SEEN_FAMILY_LIMIT:
        _SEEN_FAMILY_REFS.popitem(last=False)


def seen_family_refs() -> frozenset[str]:
    return frozenset(_SEEN_FAMILY_REFS)


def reset_seen_families() -> None:
    _SEEN_FAMILY_REFS.clear()


def _zone_tokens(document: OperationDocument, zone: str) -> set[str]:
    key = (document.operation_ref, zone)
    cached = _ZONE_TOKEN_CACHE.get(key)
    if cached is None:
        tokens = {
            token for value in document.searchable_zones.get(zone, ()) for token in tokenize(value)
        }
        tokens.update(
            term
            for value in document.searchable_zones.get(zone, ())
            for term in reviewed_canonical_terms(value)
        )
        if zone == "family_capability":
            tokens.difference_update(_CAPABILITY_STOP_TOKENS)
        cached = frozenset(tokens)
        _ZONE_TOKEN_CACHE[key] = cached
    return set(cached)


def _matched_phrase(title: str, normalized_query: str) -> str | None:
    normalized_title = normalize_text(title)
    compact_title = normalized_title.replace(" ", "")
    compact_match = (
        not title.isascii()
        and len(compact_title) >= 4
        and compact_title in normalized_query.replace(" ", "")
    )
    if len(tokenize(title)) >= 2 and (normalized_title in normalized_query or compact_match):
        return normalized_title
    return None


# A token has to be absent from at least a tenth of the surface to say anything about it.
_UNINFORMATIVE_SHARE = 0.9
# Below this many candidates a document frequency is not evidence of anything.
_MINIMUM_SURFACE = 8


def uninformative_zone_tokens(
    query: str, documents: tuple[OperationDocument, ...]
) -> frozenset[tuple[str, str]]:
    """``(zone, token)`` pairs that nearly every candidate shares, and so cannot rank.

    This is surface-relative on purpose. "실시간" is the most useful word in a question
    about streaming and the most useless one once the websocket surface is what is being
    ranked: all 23 types repeat it in their domain, their registration note, and both
    envelope descriptions. Scored, it hands every candidate an identical ~600 points and
    an identical coverage credit, so the words that were actually asked - 호가, 예상체결,
    NAV - decide nothing.

    The judgement is per zone, not per document, because the same token is constant in one
    place and decisive in another. Every realtime type carries a 체결시간 FID, so 체결 says
    nothing in ``realtime_field``; only three types are *named* 체결, so in ``title`` it is
    almost the whole answer. Suppressing the token outright collapsed 주문체결, 주식체결
    and 주식예상체결 onto one score.
    """
    if len(documents) < _MINIMUM_SURFACE:
        return frozenset()
    semantic_query = mask_opaque_instrument_spans(query)
    ordered_direct_tokens = tuple(tokenize(semantic_query, korean_bigrams=False))
    direct_tokens = set(ordered_direct_tokens)
    tokens = direct_tokens | reviewed_query_fragments(
        set(tokenize(semantic_query)).difference(direct_tokens)
    )
    tokens.update(synonym_only_tokens(ordered_direct_tokens))
    if not tokens:
        return frozenset()
    threshold = len(documents) * _UNINFORMATIVE_SHARE
    frequency: dict[tuple[str, str], int] = {}
    zones_by_token: dict[str, set[str]] = {}
    for document in documents:
        for zone in _ZONE_RULES:
            for token in tokens.intersection(_zone_tokens(document, zone)):
                key = (zone, token)
                frequency[key] = frequency.get(key, 0) + 1
                zones_by_token.setdefault(token, set()).add(zone)
    suppressed = {key for key, count in frequency.items() if count >= threshold}
    # Redundant evidence is what this removes, never the evidence itself. A word can be
    # ubiquitous in every zone at once - "주문 체결" is, across the 23 realtime types - and
    # suppressing it everywhere leaves the question with nothing to match, so search returns
    # an empty result for a question that plainly names an operation. Each token keeps the
    # single most authoritative zone it appears in; only the repetitions are dropped.
    for token, zones in zones_by_token.items():
        surviving = zones.difference(zone for zone, name in suppressed if name == token)
        if surviving:
            continue
        kept = max(zones, key=lambda zone: (_ZONE_RULES[zone][1], zone))
        suppressed.discard((kept, token))
    return frozenset(suppressed)


@dataclass(frozen=True, slots=True)
class _QueryFeatures:
    stripped: str
    semantic_query: str
    normalized_query: str
    ordered_direct_tokens: tuple[str, ...]
    direct_tokens: frozenset[str]
    fragment_tokens: frozenset[str]
    synonym_tokens: frozenset[str]
    cited_ids: frozenset[str]
    retrieval_tokens: frozenset[str]


@lru_cache(maxsize=256)
def _query_features(query: str) -> _QueryFeatures:
    stripped = query.strip()
    semantic_query = mask_opaque_instrument_spans(query)
    normalized_query = normalize_text(semantic_query)
    ordered_direct_tokens = tuple(tokenize(semantic_query, korean_bigrams=False))
    direct_tokens = frozenset(ordered_direct_tokens)
    all_tokens = set(tokenize(semantic_query))
    fragment_tokens = frozenset(reviewed_query_fragments(all_tokens.difference(direct_tokens)))
    synonym_tokens = frozenset(synonym_only_tokens(ordered_direct_tokens)).difference(all_tokens)
    cited_ids = identity_tokens(query)
    retrieval_tokens = (
        set(direct_tokens)
        | set(fragment_tokens)
        | set(synonym_tokens)
        | set(tokenize(stripped, korean_bigrams=False))
        | {token.casefold() for token in cited_ids}
        | set(cited_ids)
    )
    return _QueryFeatures(
        stripped=stripped,
        semantic_query=semantic_query,
        normalized_query=normalized_query,
        ordered_direct_tokens=ordered_direct_tokens,
        direct_tokens=direct_tokens,
        fragment_tokens=fragment_tokens,
        synonym_tokens=synonym_tokens,
        cited_ids=cited_ids,
        retrieval_tokens=frozenset(retrieval_tokens),
    )


def rank_document(
    query: str,
    document: OperationDocument,
    uninformative: frozenset[tuple[str, str]] = frozenset(),
    *,
    features: _QueryFeatures | None = None,
) -> RankedDocument:
    features = features or _query_features(query)
    stripped = features.stripped
    normalized_query = features.normalized_query
    direct_tokens = features.direct_tokens
    fragment_tokens = features.fragment_tokens
    synonym_tokens = features.synonym_tokens
    contributions: list[ScoreContribution] = []
    matched_direct: set[str] = set()
    matched_fragments: set[str] = set()

    if stripped == document.operation_ref:
        contributions.append(
            _contribution(
                ReasonCode.EXACT_OPERATION_REF, 10_000, {document.operation_ref}, "identity"
            )
        )
    if stripped == document.tr_id:
        contributions.append(
            _contribution(ReasonCode.EXACT_TR_ID, 5_000, {document.tr_id}, "identity")
        )
    if document.group_id is not None and stripped == document.group_id:
        contributions.append(
            _contribution(ReasonCode.EXACT_GROUP_ID, 4_000, {document.group_id}, "identity")
        )
    # A TR id cited inside a longer question ("ka10001 가치평가 지표만") is an
    # identity signal, not a lexical one. Matched case-sensitively on identity
    # boundaries so 0G/0g stay distinct and ka100010 never matches ka10001.
    if stripped != document.tr_id and document.tr_id in identity_tokens(query):
        contributions.append(
            _contribution(ReasonCode.TR_ID_TOKEN_MATCH, 3_000, {document.tr_id}, "identity")
        )

    for title in document.searchable_zones.get("title", ()):
        # A phrase is more than one word. Single-token titles such as "totals"
        # are generic enough to appear inside unrelated questions, and the 1,400
        # point phrase bonus would let them outrank the correct TR family.
        # They still earn TITLE_TOKEN_MATCH below.
        matched_phrase = _matched_phrase(title, normalized_query)
        if matched_phrase is not None:
            contributions.append(
                _contribution(ReasonCode.TITLE_PHRASE_MATCH, 1_400, {matched_phrase}, "title")
            )
            break

    for title in document.searchable_zones.get("family_capability", ()):
        matched_phrase = _matched_phrase(title, normalized_query)
        if matched_phrase is not None:
            contributions.append(
                _contribution(
                    ReasonCode.PROJECTION_TITLE_MATCH,
                    1_400,
                    {matched_phrase},
                    "family_capability",
                )
            )
            break

    for zone, (reason, points_per_token, cap) in _ZONE_RULES.items():
        zone_tokens = {
            token for token in _zone_tokens(document, zone) if (zone, token) not in uninformative
        }
        direct_matches = direct_tokens.intersection(zone_tokens)
        if direct_matches:
            matched_direct.update(direct_matches)
            points = min(cap, len(direct_matches) * points_per_token)
            contributions.append(_contribution(reason, points, direct_matches, zone))
        synonym_matches = synonym_tokens.intersection(zone_tokens).difference(direct_matches)
        if synonym_matches:
            points = min(cap, len(synonym_matches) * points_per_token * 3 // 4)
            contributions.append(
                _contribution(ReasonCode.SYNONYM_MATCH, points, synonym_matches, zone)
            )
        fragment_matches = (
            fragment_tokens.intersection(zone_tokens)
            .difference(direct_matches)
            .difference(synonym_matches)
        )
        if fragment_matches:
            # Half weight, and reported under the zone's own reason code because it is the
            # same kind of evidence, only weaker: it reaches into a compound rather than
            # naming it.
            matched_fragments.update(fragment_matches)
            points = min(cap, len(fragment_matches) * points_per_token // 2)
            contributions.append(_contribution(reason, points, fragment_matches, zone))

    corroboration = sum(item.points for item in contributions if item.scope in _CORROBORATION_ZONES)
    if corroboration > _CORROBORATION_CAP:
        # Scaled rather than truncated so the returned explanation still shows which zones
        # supported the match and in what proportion; only their combined weight is bounded.
        contributions = [
            item.model_copy(update={"points": item.points * _CORROBORATION_CAP // corroboration})
            if item.scope in _CORROBORATION_ZONES
            else item
            for item in contributions
        ]

    # Coordination factor: reward covering more of what was actually asked.
    # Without it a document can win by accumulating points for one common word
    # across several zones while a rival matches strictly more of the question.
    # A word counts as covered when the document reached it at all, including through one
    # of its own fragments: coverage asks how much of the question was addressed, and
    # matching 주식체결 does address the word 체결. Only whole words are counted, so a long
    # compound cannot inflate the denominator with the fragments it happens to decompose to.
    covered = {
        token
        for token in direct_tokens
        if token in matched_direct or any(fragment in token for fragment in matched_fragments)
    }
    if direct_tokens and covered:
        coverage = len(covered) / len(direct_tokens)
        contributions.append(
            _contribution(
                ReasonCode.QUERY_COVERAGE,
                round(_COVERAGE_POINTS * coverage),
                covered,
                "query",
            )
        )

    ordered = tuple(
        sorted(
            contributions,
            key=lambda item: (-item.points, item.reason_code.value, item.scope),
        )
    )
    return RankedDocument(document, sum(item.points for item in ordered), ordered)


def rank_documents(
    query: str, documents: tuple[OperationDocument, ...]
) -> tuple[RankedDocument, ...]:
    # Computed over the candidate set, not the whole catalog: what a token can discriminate
    # depends on what it is being asked to discriminate between.
    features = _query_features(query)
    frame = extract_query_frame(query)
    stripped = features.stripped
    cited_ids = features.cited_ids
    identity_matches = {
        document.operation_ref
        for document in documents
        if stripped in {document.operation_ref, document.tr_id, document.group_id}
        or document.tr_id in cited_ids
    }
    eligibility = {
        document.operation_ref: evaluate_eligibility(frame, document) for document in documents
    }
    eligible_documents = tuple(
        document
        for document in documents
        if eligibility[document.operation_ref].eligible
        or document.operation_ref in identity_matches
    )
    uninformative = uninformative_zone_tokens(query, eligible_documents)
    ranked = []
    for document in eligible_documents:
        item = rank_document(query, document, uninformative, features=features)
        typed = eligibility[document.operation_ref]
        contributions = tuple(
            sorted(
                (*item.contributions, *typed.contributions),
                key=lambda contribution: (
                    -contribution.points,
                    contribution.reason_code.value,
                    contribution.scope,
                ),
            )
        )
        ranked.append(
            RankedDocument(
                document=document,
                score=item.score,
                contributions=contributions,
                # A visible canonical identity preserves the selector's exact-ID contract.
                # Visibility was already applied by the caller; semantic extraction cannot
                # reinterpret an explicitly cited TR as another family.
                typed_tier=(
                    max(typed.tier, 1_000)
                    if document.operation_ref in identity_matches
                    else typed.tier
                ),
            )
        )
    ranked = [item for item in ranked if item.score > 0 or item.typed_tier > 0]
    return tuple(
        sorted(
            ranked,
            key=lambda item: (
                # Ranking is display-only.  Preserve whole-query canonical identity
                # and typed eligibility as coarse gates, then let the operation's
                # authored lexical evidence order equally eligible diagnostics.
                # Fine-grained typed tiers are not execution authority.
                -(item.typed_tier >= 1_000),
                -(item.typed_tier > 0),
                -item.score,
                -item.typed_tier,
                -item.authoritative_score,
                not item.document.generic_callable,
                item.document.kind != "query",
                item.document.operation_ref,
            ),
        )
    )


@dataclass(frozen=True, slots=True)
class _SurfaceIndex:
    documents: tuple[OperationDocument, ...]
    postings: dict[str, tuple[int, ...]]


def _surface_index(catalog: OperationCatalog, intent: DiscoveryIntent) -> _SurfaceIndex:
    key = (catalog.version, intent.value)
    cached = _SURFACE_INDEX_CACHE.get(key)
    if cached is not None:
        _SURFACE_INDEX_CACHE.move_to_end(key)
        return cached
    documents = catalog.visible_for(intent)
    buckets: dict[str, list[int]] = {}
    for index, document in enumerate(documents):
        tokens = set()
        for zone in _ZONE_RULES:
            tokens.update(_zone_tokens(document, zone))
        tokens.add(document.operation_ref)
        tokens.add(document.tr_id)
        tokens.add(document.tr_id.casefold())
        if document.group_id:
            tokens.add(document.group_id)
            tokens.update(tokenize(document.group_id, korean_bigrams=False))
        tokens.update(tokenize(document.operation_ref, korean_bigrams=False))
        for token in tokens:
            buckets.setdefault(token, []).append(index)
    built = _SurfaceIndex(
        documents=documents,
        postings={token: tuple(indexes) for token, indexes in buckets.items()},
    )
    _SURFACE_INDEX_CACHE[key] = built
    _SURFACE_INDEX_CACHE.move_to_end(key)
    while len(_SURFACE_INDEX_CACHE) > _SURFACE_INDEX_CACHE_LIMIT:
        _SURFACE_INDEX_CACHE.popitem(last=False)
    return built


def retrieve_candidates(query: str, index: _SurfaceIndex) -> tuple[OperationDocument, ...]:
    """Cheap dual-encoder analog: inverted-index shortlist before cross scoring."""
    documents = index.documents
    if not documents:
        return documents
    features = _query_features(query)
    overlap: dict[int, int] = {}
    for token in features.retrieval_tokens:
        for document_index in index.postings.get(token, ()):
            overlap[document_index] = overlap.get(document_index, 0) + 1
    identity_indexes = [
        document_index
        for document_index, document in enumerate(documents)
        if features.stripped in {document.operation_ref, document.tr_id, document.group_id}
        or document.tr_id in features.cited_ids
    ]
    for document_index in identity_indexes:
        overlap.setdefault(document_index, 0)
    if len(overlap) < _RETRIEVAL_FLOOR:
        return documents
    ranked_indexes = sorted(
        overlap,
        key=lambda document_index: (
            -overlap[document_index],
            documents[document_index].operation_ref,
        ),
    )
    selected = set(ranked_indexes[:_RETRIEVAL_CAP])
    selected.update(identity_indexes)
    return tuple(
        documents[document_index]
        for document_index in range(len(documents))
        if document_index in selected
    )


def _is_multi_tool_query(ranked: tuple[RankedDocument, ...]) -> bool:
    family_best: dict[str, int] = {}
    for item in ranked[:8]:
        family = item.document.family_ref
        score = family_best.get(family, 0)
        if item.score > score:
            family_best[family] = item.score
    if len(family_best) < 2:
        return False
    leading = sorted(family_best.values(), reverse=True)
    return leading[1] >= max(400, leading[0] * 7 // 10)


def hierarchy_aware_rerank(ranked: tuple[RankedDocument, ...]) -> tuple[RankedDocument, ...]:
    """Concentrate one family, or diversify when two families both score."""
    if len(ranked) < 2:
        return ranked
    if _is_multi_tool_query(ranked):
        buckets: OrderedDict[str, list[RankedDocument]] = OrderedDict()
        for item in ranked:
            buckets.setdefault(item.document.family_ref, []).append(item)
        mixed: list[RankedDocument] = []
        while any(buckets.values()):
            for family in list(buckets):
                if buckets[family]:
                    mixed.append(buckets[family].pop(0))
        return tuple(mixed)
    top_family = ranked[0].document.family_ref
    primary = [item for item in ranked if item.document.family_ref == top_family]
    rest = [item for item in ranked if item.document.family_ref != top_family]
    return tuple(primary + rest)


def adaptive_truncate_limit(
    ranked: tuple[RankedDocument, ...],
    limit: int,
    *,
    seen_families: frozenset[str] | None = None,
) -> int:
    """Seen/high-margin hits keep a short window; unseen hits keep recall."""
    if not ranked:
        return 0
    if limit <= 1:
        return min(1, len(ranked))
    # Wider search windows keep recall for diagnostics; the cold-path shortlist
    # (limit<=3) is what Adaptive Truncation is for.
    if limit > 3:
        return min(limit, len(ranked))
    top = ranked[0]
    seen = seen_family_refs() if seen_families is None else seen_families
    seen_hit = top.document.family_ref in seen or any(
        contribution.reason_code in _SEEN_REASONS for contribution in top.contributions
    )
    if not seen_hit:
        return min(limit, len(ranked))
    if len(ranked) == 1:
        return 1
    gap = top.score - ranked[1].score
    if gap >= max(400, top.score // 4):
        return 1
    return min(2, limit, len(ranked))


def searchable_surface(
    catalog: OperationCatalog, request: SearchRequest
) -> tuple[OperationDocument, ...]:
    """Return the complete callable surface for the requested intent."""
    return catalog.visible_for(request.intent)


_WEBSOCKET_SIGNALS = (
    "실시간",
    "구독",
    "스트림",
    "realtime",
    "real time",
    "stream",
    "subscribe",
    "websocket",
)
_ORDER_SIGNALS = ("매수", "매도", "주문", "order", "buy", "sell")
# A read of past activity, not a request to act. "미체결 주문 조회" is a query TR.
_READ_MARKERS = (
    "조회",
    "내역",
    "현황",
    "추이",
    "목록",
    "리스트",
    "잔고",
    "history",
    "list",
    "inquiry",
    "status",
)


def _suggested_intent(
    request: SearchRequest, ranked: tuple[RankedDocument, ...]
) -> DiscoveryIntent | None:
    """Name the intent that would have seen what this question is asking for.

    Score cannot detect the miss: an unrelated read operation still scores in the
    hundreds on shared tokens, and the 12 order documents have titles too short to
    outscore it, so no threshold and no cross-surface comparison separates them. The
    discriminator is linguistic. "매수 주문 넣어줘" asks to act; "미체결 주문 조회" asks
    to read, and a read marker always wins because reads are what this surface serves.
    """
    if request.intent not in {DiscoveryIntent.AUTO, DiscoveryIntent.QUERY}:
        return None
    text = normalize_text(request.query)
    if any(marker in text for marker in _READ_MARKERS):
        return None
    if any(signal in text for signal in _WEBSOCKET_SIGNALS):
        return DiscoveryIntent.WEBSOCKET
    if any(signal in text for signal in _ORDER_SIGNALS):
        return DiscoveryIntent.ORDER
    return None


def search_catalog(catalog: OperationCatalog, request: SearchRequest) -> SearchResponse:
    index = _surface_index(catalog, request.intent)
    retrieved = retrieve_candidates(request.query, index)
    ranked = hierarchy_aware_rerank(rank_documents(request.query, retrieved))
    truncated = adaptive_truncate_limit(ranked, request.limit)
    results = []
    for item in ranked[:truncated]:
        document = item.document
        results.append(
            SearchHit(
                operation_ref=document.operation_ref,
                kind=document.kind,  # type: ignore[arg-type]
                domain=document.domain,
                name=document.name,
                group_title=document.group_title_ko or document.group_title_en,
                score=item.score,
                # Raw lexical points are evidence contributions, not calibrated
                # confidence. SelectorService aligns this label with the final canonical
                # policy outcome after ambiguity and typed eligibility are evaluated.
                confidence="low",
                contributions=list(item.contributions),
                generic_callable=document.generic_callable,
                discovery_only=document.visibility == "explicit",
            )
        )
    return SearchResponse(
        catalog_version=catalog.version,
        normalized_query=normalize_text(request.query),
        results=results,
        suggested_intent=_suggested_intent(request, ranked),
    )
