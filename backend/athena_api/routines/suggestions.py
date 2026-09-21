"""Persistent presentation budget and explicit holds; no fabricated learning events."""
from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from athena_api.routines.guard_settings import GuardSettings, KST, in_quiet_hours


class SuggestionStore:
    def __init__(self, path: Path):
        self.path = path

    def _read(self) -> dict:
        if not self.path.exists():
            return {"holds": {}, "presented": {}, "dismissals": {}}
        # Never silently discard a broken budget and present unbounded suggestions.
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        for key in ("holds", "presented", "dismissals"):
            if not isinstance(raw.get(key), dict):
                raise ValueError("제안 보류 저장 형식이 올바르지 않습니다")
        return raw

    def _save(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        temporary.replace(self.path)

    def state(self, settings: GuardSettings, now: datetime) -> dict:
        data = self._read()
        return {
            "held_ids": [key for key, until in data["holds"].items()
                         if datetime.fromisoformat(until) > now],
            "show_rationale": settings.show_rationale,
            "scope": "new_proactive_suggestions",
        }

    def present(self, ids: list[str], settings: GuardSettings, now: datetime) -> dict:
        data = self._read()
        state = self.state(settings, now)
        day = now.astimezone(KST).date().isoformat()
        presented = list(data["presented"].get(day, []))
        visible, reason = [], None
        quiet = in_quiet_hours(settings, now)
        for entity_id in dict.fromkeys(ids):
            if entity_id in state["held_ids"]:
                continue
            if entity_id in presented:
                visible.append(entity_id)
            elif quiet:
                reason = "quiet_hours"
            elif len(presented) >= settings.max_daily_nudges:
                reason = "daily_limit"
            else:
                presented.append(entity_id)
                visible.append(entity_id)
        # Only daily presentation counters expire; holds and dismissal counts persist.
        data["presented"] = {day: presented}
        self._save(data)
        return {**state, "visible_ids": visible, "suppressed_reason": reason}

    def hold(self, entity_id: str, settings: GuardSettings, now: datetime) -> dict:
        data = self._read()
        count = int(data["dismissals"].get(entity_id, 0))
        if settings.learn_from_dismissals:
            count += 1
            data["dismissals"][entity_id] = count
        days = min(28, 7 * max(1, count)) if settings.learn_from_dismissals else 7
        until = (now.astimezone(UTC) + timedelta(days=days)).isoformat()
        data["holds"][entity_id] = until
        self._save(data)
        return {"entity_id": entity_id, "held_until": until, "hold_days": days,
                "learning_recorded": settings.learn_from_dismissals}
