from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from athena_api.api import routines

KST = timezone(timedelta(hours=9))


def spec_for(value: str, created: datetime, approved: datetime | None = None):
    return SimpleNamespace(
        id="scheduled-test",
        mode="scheduled",
        status="active",
        condition=SimpleNamespace(source="schedule.daily", value=value),
        created_at=created,
        approved_at=approved,
    )


class ScheduledCatchupLifetimeTests(unittest.TestCase):
    def test_weekly_first_fire_is_future_not_last_weeks_missed_event(self):
        now = datetime(2026, 9, 22, 2, 32, tzinfo=KST)
        spec = spec_for("2@17:07", now - timedelta(minutes=15))
        self.assertIsNone(routines._missed_since(spec, now=now))
        self.assertFalse(routines._is_missed(routines._missed_since(spec, now=now), None))
        self.assertEqual(routines._next_fire_at(spec, now=now), "2026-09-22T17:07:00+09:00")

    def test_daily_schedule_does_not_catch_up_before_creation(self):
        now = datetime(2026, 9, 22, 2, 32, tzinfo=KST)
        spec = spec_for("ALL@17:07", now - timedelta(minutes=15))
        self.assertIsNone(routines._missed_since(spec, now=now))

    def test_old_draft_approved_after_occurrence_has_no_missed_fire(self):
        now = datetime(2026, 9, 22, 18, tzinfo=KST)
        spec = spec_for("2@17:07", now - timedelta(days=8), now - timedelta(minutes=10))
        self.assertIsNone(routines._missed_since(spec, now=now))

    def test_genuine_missed_occurrence_still_offered_with_utc_stored_timestamps(self):
        due = datetime(2026, 9, 22, 17, 7, tzinfo=KST)
        spec = spec_for("2@17:07", (due - timedelta(days=1)).astimezone(UTC),
                        (due - timedelta(hours=1)).astimezone(UTC))
        missed = routines._missed_since(spec, now=due + timedelta(minutes=3))
        self.assertEqual(missed, due)
        self.assertTrue(routines._is_missed(missed, None))
        self.assertFalse(routines._is_missed(missed, due.isoformat()))

    def test_creation_boundary_is_inclusive_and_existing_legacy_approval_can_be_none(self):
        due = datetime(2026, 9, 22, 17, 7, tzinfo=KST)
        spec = spec_for("2@17:07", due)
        self.assertEqual(routines._missed_since(spec, now=due), due)


class ScheduledCatchupEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def test_future_first_fire_rejected_without_recording_a_fire(self):
        now = datetime(2026, 9, 22, 2, 32, tzinfo=KST)
        spec = spec_for("2@17:07", now - timedelta(minutes=15))
        runtime = SimpleNamespace(store=SimpleNamespace(get=lambda _: spec))

        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return now.astimezone(tz)

        with patch.object(routines, "_runtime", return_value=runtime), \
                patch.object(routines, "datetime", Clock), \
                patch.object(routines, "record_scheduled_fire") as record:
            with self.assertRaises(HTTPException) as raised:
                await routines.catchup_fire(SimpleNamespace(), spec.id)
            self.assertEqual(raised.exception.status_code, 409)
            self.assertEqual(raised.exception.detail, "놓친 예약이 없다")
            record.assert_not_called()


if __name__ == "__main__":
    unittest.main()
