from __future__ import annotations

from dataclasses import dataclass

from athena_api.api.brain import EdgeDetailOut
from athena_api.brain.projection import GraphProjector
from athena_api.brain.store import EntityRow, RelationRow


def _entity(entity_id: str, kind: str, name: str) -> EntityRow:
    return EntityRow(
        id=entity_id,
        kind=kind,
        name=name,
        normalized_name=name,
        aliases=(),
        degree=1,
        created_at="2026-10-01T00:00:00+00:00",
    )


def _relation(
    relation_id: str,
    kind: str,
    *,
    confidence: str,
    tier: str,
    source_id: str,
    observed_at: str,
) -> RelationRow:
    return RelationRow(
        id=relation_id,
        kind=kind,
        source_entity_id="security:samsung",
        target_entity_id="theme:semiconductor",
        confidence=confidence,
        tier=tier,
        rationale=None,
        source_id=source_id,
        observed_at=observed_at,
    )


@dataclass
class _Source:
    relation_rows: tuple[RelationRow, ...]

    async def graph_revision(self) -> int:
        return 7

    async def entities(self, *, kind=None) -> tuple[EntityRow, ...]:
        del kind
        return (
            _entity("security:samsung", "security", "삼성전자"),
            _entity("theme:semiconductor", "theme", "반도체"),
        )

    async def relations(self) -> tuple[RelationRow, ...]:
        return self.relation_rows


async def test_projected_edge_keeps_relation_provenance_independent_of_row_order():
    ambiguous = _relation(
        "relation:001",
        "relates_to",
        confidence="AMBIGUOUS",
        tier="conversational",
        source_id="chat:question-1",
        observed_at="2026-10-01T09:00:00+00:00",
    )
    manual = _relation(
        "relation:999",
        "belongs_to",
        confidence="EXTRACTED",
        tier="manual",
        source_id="manual:edit-1",
        observed_at="2026-10-02T09:00:00+00:00",
    )

    forward = (await GraphProjector(_Source((ambiguous, manual))).analysis()).graph
    reverse = (await GraphProjector(_Source((manual, ambiguous))).analysis()).graph
    forward_data = forward.get_edge_data("security:samsung", "theme:semiconductor")
    reverse_data = reverse.get_edge_data("security:samsung", "theme:semiconductor")

    assert forward_data == reverse_data
    assert forward_data["kinds"] == ("belongs_to", "relates_to")
    assert forward_data["tier"] == "manual"
    assert forward_data["confidence"] == "EXTRACTED"
    assert forward_data["observed_at"] == "2026-10-02T09:00:00+00:00"
    assert forward_data["relations"] == (
        {
            "source": "security:samsung",
            "target": "theme:semiconductor",
            "kind": "belongs_to",
            "tier": "manual",
            "confidence": "EXTRACTED",
            "source_id": "manual:edit-1",
            "observed_at": "2026-10-02T09:00:00+00:00",
        },
        {
            "source": "security:samsung",
            "target": "theme:semiconductor",
            "kind": "relates_to",
            "tier": "conversational",
            "confidence": "AMBIGUOUS",
            "source_id": "chat:question-1",
            "observed_at": "2026-10-01T09:00:00+00:00",
        },
    )

    serialized = EdgeDetailOut(
        source="security:samsung",
        target="theme:semiconductor",
        kinds=list(forward_data["kinds"]),
        relations=list(forward_data["relations"]),
        tier=forward_data["tier"],
        confidence=forward_data["confidence"],
        observed_at=forward_data["observed_at"],
    ).model_dump()
    assert serialized["relations"] == list(forward_data["relations"])
