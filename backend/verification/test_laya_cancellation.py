import asyncio
from types import SimpleNamespace
import threading
import unittest

from athena_api.laya.runtime import DecisionRuntime
from athena_api.laya.service import SemanticService, TurnExpired


class CancellationTests(unittest.IsolatedAsyncioTestCase):
    async def test_normal_completion_stops_monitor_even_if_receive_swallows_cancellation(self):
        from athena_api.laya.cancellation import until_disconnect
        entered = asyncio.Event()
        async def is_disconnected():
            entered.set()
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                return False  # Starlette's receive cancel scope can consume this.
        async def work():
            await entered.wait()
            return 'complete'
        before = set(asyncio.all_tasks())
        result = await asyncio.wait_for(until_disconnect(
            SimpleNamespace(is_disconnected=is_disconnected), work()), 3)
        self.assertEqual(result, 'complete')
        self.assertEqual(set(asyncio.all_tasks()) - before, set())

    async def test_retire_cancels_pending_inference_without_affecting_other_turn(self):
        entered, cancelled = asyncio.Event(), asyncio.Event()
        async def infer(requests):
            entered.set()
            try:
                await asyncio.Future()
            finally:
                cancelled.set()
        service = SemanticService(SimpleNamespace(decide=infer))
        def register(name):
            return service.register(lease_id=name, generation_id='g', conversation_id=name,
                turn_id='t', utterance='text', context={}, origin='shell')
        ticket, other = register('one'), register('two')
        pending = asyncio.create_task(service.decide(ticket, [{'task_id': 'head'}]))
        await entered.wait()
        service.retire(ticket)
        try:
            await asyncio.wait_for(cancelled.wait(), 3)
            with self.assertRaises(TurnExpired):
                await pending
            self.assertEqual(service.context(other)['conversation_id'], 'two')
            self.assertEqual(service.inflight, {})
        finally:
            pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)

    async def test_pending_inference_expires_without_another_request(self):
        cancelled = asyncio.Event()
        async def infer(requests):
            try:
                await asyncio.Future()
            finally:
                cancelled.set()
        # Freeze semantic-clock admission so host scheduling cannot expire the
        # ticket before inference starts; wait_for still uses the real loop clock.
        service = SemanticService(SimpleNamespace(decide=infer), ttl=.03, clock=lambda: 0)
        ticket = service.register(lease_id='one', generation_id='g', conversation_id='one',
            turn_id='t', utterance='text', context={}, origin='shell')
        pending = asyncio.create_task(service.decide(ticket, [{'task_id': 'head'}]))
        try:
            with self.assertRaises(TurnExpired):
                await asyncio.wait_for(asyncio.shield(pending), 3)
            self.assertTrue(cancelled.is_set())
            self.assertEqual(service.inflight, {})
        finally:
            pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)

    async def test_disconnect_cancels_work_and_joins_monitor(self):
        from athena_api.laya.cancellation import until_disconnect
        disconnected, entered, stopped = asyncio.Event(), asyncio.Event(), asyncio.Event()
        async def work():
            entered.set()
            try:
                await asyncio.Future()
            finally:
                stopped.set()
        async def is_disconnected():
            return disconnected.is_set()
        before = set(asyncio.all_tasks())
        task = asyncio.create_task(until_disconnect(SimpleNamespace(is_disconnected=is_disconnected), work()))
        await entered.wait()
        disconnected.set()
        with self.assertRaises(asyncio.CancelledError):
            await asyncio.wait_for(task, 3)
        self.assertTrue(stopped.is_set())
        self.assertEqual(set(asyncio.all_tasks()) - before, set())


class RuntimeCancellationTests(unittest.TestCase):
    def runtime(self, predictor):
        contract = SimpleNamespace(tasks={'head': {}}, encode=lambda request: ('state', {}),
            decide=lambda *args: {'task_id': 'head', 'accepted': True, 'reason': 'accepted'})
        return DecisionRuntime(SimpleNamespace(contracts=contract, identity={}), predictor)

    def test_cancelled_queued_work_never_calls_predictor(self):
        calls, errors = [], []
        event = threading.Event()
        runtime = self.runtime(lambda *args: calls.append(args))
        runtime.lock.acquire()
        def run():
            try:
                runtime.decide([{'task_id': 'head'}], cancelled=event)
            except Exception as error:
                errors.append(type(error).__name__)
        worker = threading.Thread(target=run)
        worker.start()
        event.set()
        try:
            worker.join(3)
            self.assertFalse(worker.is_alive())
            self.assertEqual(calls, [])
            self.assertEqual(errors, ['InferenceCancelled'])
        finally:
            runtime.lock.release()
            worker.join()

    def test_cancellation_after_running_forward_skips_next_head_and_releases_lock(self):
        event, calls = threading.Event(), []
        def predictor(*args):
            calls.append(args)
            event.set()
            return [1]
        runtime = self.runtime(predictor)
        with self.assertRaisesRegex(Exception, 'inference_cancelled'):
            runtime.decide([{'task_id': 'head'}, {'task_id': 'head'}], cancelled=event)
        self.assertEqual(len(calls), 1)
        self.assertFalse(runtime.lock.locked())
