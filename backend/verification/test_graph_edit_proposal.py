from __future__ import annotations

import asyncio
import json
from typing import Any

from athena_mcp import graph_view_tools


def _run(arguments: dict[str, Any]) -> Any:
    return asyncio.run(graph_view_tools.dispatch(arguments))


def _payload(result: Any) -> dict[str, Any]:
    return json.loads(result.content[0].text)


def test_remove_proposal_requires_id_and_preserves_correction_payload() -> None:
    blocked = _run(
        {
            "action": "propose_edit",
            "edit": {
                "op": "remove",
                "object": "삼성전자",
                "relation": "interested_in",
            },
        }
    )
    assert blocked.isError

    payload = _payload(
        _run(
            {
                "action": "propose_edit",
                "edit": {
                    "op": "remove",
                    "object": "삼성전자",
                    "relation": "interested_in",
                    "relation_id": "relation:ambiguous-interest",
                    "reason": "이번 조회만으로 관심이나 보유를 추론하지 않는다",
                },
            }
        )
    )
    assert payload["op"] == "remove"
    assert payload["relation_id"] == "relation:ambiguous-interest"
    assert payload["reason"] == "이번 조회만으로 관심이나 보유를 추론하지 않는다"
    assert "바로 반영" in payload["notice"]


def test_add_proposal_requires_both_endpoint_ids() -> None:
    for edit in (
        {"op": "add", "object": "삼성전자", "relation": "researched"},
        {
            "op": "add",
            "object": "삼성전자",
            "relation": "researched",
            "subject_id": "entity:investor-profile",
        },
        {
            "op": "add",
            "subject": "SK하이닉스",
            "object": "삼성전자",
            "relation": "competes_with",
            "object_id": "entity:samsung",
        },
    ):
        assert _run({"action": "propose_edit", "edit": edit}).isError


def test_change_is_blocked_instead_of_forcing_relation_certainty() -> None:
    result = _run(
        {
            "action": "propose_edit",
            "edit": {
                "op": "change",
                "object": "삼성전자",
                "relation": "researched",
                "subject_id": "entity:investor-profile",
                "object_id": "entity:samsung",
            },
        }
    )
    assert result.isError
    text = "".join(getattr(block, "text", "") for block in result.content)
    assert "add/remove" in text


def test_investor_preference_add_gets_the_fixed_investor_profile_id() -> None:
    from athena_api.brain.store import INVESTOR_PROFILE_ENTITY_ID

    result = _run(
        {
            "action": "propose_edit",
            "edit": {
                "op": "add",
                "object": "배당주",
                "relation": "prefers",
                "object_id": "entity:dividend",
            },
        }
    )
    assert not result.isError
    payload = json.loads(result.content[0].text)
    assert payload["subject"] is None
    assert payload["subject_id"] == INVESTOR_PROFILE_ENTITY_ID


def test_named_subject_add_still_requires_its_own_id() -> None:
    edit = {
        "op": "add",
        "subject": "삼성전자",
        "object": "애플",
        "relation": "supplies",
        "object_id": "entity:apple",
    }
    assert _run({"action": "propose_edit", "edit": edit}).isError
