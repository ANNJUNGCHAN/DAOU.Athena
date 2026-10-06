"""One broken routine must not stop other routines in the same schedule pass."""
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from athena_api.routines.guard_settings import KST
from athena_api.routines.ledger import RoutineLedger
from athena_api.routines.models import Condition, RoutineSpec
from athena_api.routines.scheduler import RoutineScheduler
from athena_api.routines.store import RoutineStore
from athena_api.routines.triggers import TriggerEngine


class SchedulerIsolationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.now = datetime(2030, 9, 23, 10, 0, tzinfo=KST)
        self.store = RoutineStore(root / 'routines.json')
        self.ledger = RoutineLedger(root / 'ledger.jsonl')
        self.events = []

    def spec(self):
        return RoutineSpec(condition=Condition('schedule.daily', 'at', 'ALL@10:00'),
                           symbol='023590', cooldown_s=60, note='fixture', status='active',
                           created_at=self.now - timedelta(days=1),
                           approved_at=self.now - timedelta(hours=1),
                           expires_at=self.now + timedelta(days=2))

    def scheduler(self):
        async def notify(event):
            self.events.append(event)
        return RoutineScheduler(self.store, TriggerEngine(self.ledger), notify,
                                now_kst=lambda: self.now)

    async def test_malformed_ledger_row_isolated_to_its_routine_and_error_clears(self):
        broken, healthy = self.spec(), self.spec()
        self.store.upsert(broken)
        self.store.upsert(healthy)
        # A corrupted fired row makes this routine's dedup check raise ValueError.
        self.ledger.record('fired', routine_id=broken.id, symbol=broken.symbol,
                           source='schedule.daily', observed='10:00', threshold='ALL@10:00',
                           reason='fixture', ts=self.now - timedelta(days=1),
                           scheduled_for='not-a-timestamp')
        scheduler = self.scheduler()
        await scheduler.run_schedule_once()

        self.assertEqual([event['routine_id'] for event in self.events], [healthy.id])
        self.assertIn(broken.id, scheduler.last_error)
        self.assertIn('ValueError', scheduler.last_error)

        self.store.transition(broken.id, 'cancelled')
        await scheduler.run_schedule_once()
        self.assertEqual(len(self.events), 1)
        self.assertIsNone(scheduler.last_error)

    async def test_success_does_not_clear_another_loops_error(self):
        scheduler = self.scheduler()
        scheduler.last_error = '배포 판정 실패: fixture'
        await scheduler.run_schedule_once()
        self.assertEqual(scheduler.last_error, '배포 판정 실패: fixture')


if __name__ == '__main__':
    unittest.main()
