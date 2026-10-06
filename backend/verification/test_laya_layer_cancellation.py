from types import SimpleNamespace
import threading
import unittest

from athena_api.laya.runtime import InferenceCancelled, SdkPredictor, DecisionRuntime


class Layer:
    def __init__(self, action=None):
        self.hooks = []
        self.calls = 0
        self.action = action

    def register_forward_pre_hook(self, hook):
        self.hooks.append(hook)
        return SimpleNamespace(remove=lambda: self.hooks.remove(hook))

    def __call__(self, value):
        for hook in self.hooks:
            assert hook(self, (value,)) is None
        self.calls += 1
        if self.action:
            self.action()
        return value + 1


class LayerCancellationTests(unittest.TestCase):
    def test_cancel_stops_next_layer_and_cleans_hooks_for_next_request(self):
        from athena_api.laya.runtime import cancellation_hooks
        event = threading.Event()
        layers = [Layer(event.set), Layer()]
        head = Layer()
        model = SimpleNamespace(encoder=SimpleNamespace(layers=layers),
                                head=SimpleNamespace(layers=[head]))
        with self.assertRaises(InferenceCancelled):
            with cancellation_hooks(model, event):
                value = 0
                for layer in layers + [head]:
                    value = layer(value)
        self.assertEqual([layer.calls for layer in layers + [head]], [1, 0, 0])
        self.assertTrue(all(not layer.hooks for layer in layers + [head]))
        event.clear()
        layers[0].action = None
        with cancellation_hooks(model, event):
            self.assertEqual(head.hooks, [])
            value = 0
            for layer in layers + [head]:
                value = layer(value)
        self.assertEqual(value, 3)
        self.assertTrue(all(not layer.hooks for layer in layers + [head]))

    def test_partial_install_failure_removes_prior_handles(self):
        from athena_api.laya.runtime import cancellation_hooks
        first = Layer()
        def fail(hook):
            raise ValueError('install failed')
        model = SimpleNamespace(encoder=SimpleNamespace(layers=[first,
            SimpleNamespace(register_forward_pre_hook=fail)]), head=None)
        with self.assertRaisesRegex(ValueError, 'install failed'):
            with cancellation_hooks(model, threading.Event()):
                self.fail('must not enter')
        self.assertEqual(first.hooks, [])

    def test_forward_error_removes_hooks(self):
        from athena_api.laya.runtime import cancellation_hooks
        layer = Layer()
        model = SimpleNamespace(encoder=SimpleNamespace(layers=[layer]), head=None)
        with self.assertRaisesRegex(ValueError, 'forward failed'):
            with cancellation_hooks(model, threading.Event()):
                raise ValueError('forward failed')
        self.assertEqual(layer.hooks, [])

    def test_runtime_passes_event_to_sdk_and_does_not_swallow_cancellation(self):
        event = threading.Event()
        class Predictor(SdkPredictor):
            def __init__(self):
                pass
            def __call__(self, state, question, *, cancelled=None):
                self.received = cancelled
                raise InferenceCancelled('inference_cancelled')
        predictor = Predictor()
        contracts = SimpleNamespace(tasks=['head'], encode=lambda request: ('state', {}))
        runtime = DecisionRuntime(SimpleNamespace(contracts=contracts, identity={}), predictor)
        with self.assertRaises(InferenceCancelled):
            runtime.decide([{'task_id': 'head'}], cancelled=event)
        self.assertIs(predictor.received, event)
        self.assertEqual(dict(runtime.counts), {})
