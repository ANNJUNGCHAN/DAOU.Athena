"""No Torch/model/network: contract, probability, transport and turn boundary tests."""
import asyncio
import hashlib
import io
import json
import math
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
import httpx

from athena_api.laya.client import RuntimeClient
from athena_api.laya.contracts import Contracts, DecisionError, Deployment, canonical, sha256
from athena_api.laya.bundle import resolve_bundle
from athena_api.laya.runtime import DecisionRuntime, create_app
from athena_api.laya import runtime as runtime_module
from athena_api.laya.service import SemanticService, TurnExpired
from athena_api.config import Settings


def catalog():
    choices = [{"label": "yes", "description": "yes"}, {"label": "no", "description": "no"},
               {"label": "defer", "description": "uncertain"}]
    return {"tasks": [{"task_id": name, "choices": choices, "instructions": "Choose.",
                       **({"candidate_bank": "query_candidates"} if name.startswith("query.") else {})}
                      for name in ("native", "query.operation_relevance", "memory.entity_kind")],
            "query_candidates": [{"candidate_id": "base:one", "description": "Actual descriptor",
                                  "operation_ref": "base:one", "kind": "query", "source_refs": ["private"]}]}


def contracts(**policy):
    return Contracts(catalog(), {"temperature": 2.0, "thresholds": {"native": 0.7}, **policy})


class ContractTests(unittest.TestCase):
    def test_checkpoint_digest_streams_large_files_with_bounded_reads(self):
        content = b"checkpoint-content" * 200000
        class BoundedStream(io.BytesIO):
            def read(self, size=-1):
                if not 0 < size <= 1024 * 1024:
                    raise AssertionError("Unbounded checkpoint read")
                return super().read(size)
        with patch.object(Path, 'open', return_value=BoundedStream(content)):
            self.assertEqual(sha256(Path('checkpoint')), hashlib.sha256(content).hexdigest())

    def test_matches_training_whitelist_and_order_without_annotation(self):
        state, question = contracts().encode({"task_id": "query.operation_relevance", "utterance": "질문",
            "context": {"screen": "query"}, "candidate_id": "base:one", "label": "no", "rationale": "gold"})
        self.assertEqual(json.loads(state), {"utterance": "질문", "context": {"screen": "query"},
            "candidate": {"description": "Actual descriptor", "kind": "query"}})
        self.assertEqual(list(question["crit"]), ["yes", "no", "defer"])
        self.assertEqual(state, canonical(json.loads(state)))

    def test_candidate_and_missing_memory_target_fail_closed(self):
        for request, reason in [({"task_id": "memory.entity_kind", "utterance": "a"}, "memory_target_required"),
            ({"task_id": "query.operation_relevance", "utterance": "a", "candidate_id": "invented"}, "unknown_candidate"),
            ({"task_id": "query.operation_relevance", "utterance": "a", "candidate_id": "base:one",
              "context": {"candidate": "forged"}}, "candidate_override")]:
            with self.assertRaisesRegex(DecisionError, reason):
                contracts().encode(request)

    def test_temperature_once_full_precision_not_sdk_entropy_or_rounded_values(self):
        result = contracts().decide("native", [4, 0, -2])
        expected = math.exp(2) / (math.exp(2) + 1 + math.exp(-1))
        self.assertAlmostEqual(result["confidence"], expected, places=14)
        self.assertNotEqual(result["confidence"], round(expected, 4))
        self.assertTrue(result["accepted"])
        policy = contracts(thresholds={"native": expected + 0.000001})
        self.assertFalse(policy.decide("native", [4, 0, -2])["accepted"])

    def test_reject_all_missing_policy_defer_and_nan(self):
        self.assertEqual(contracts(thresholds={}).decide("native", [100, 0, 0])["reason"], "reject_all")
        self.assertEqual(contracts().decide("native", [0, 0, 100])["reason"], "defer")
        with self.assertRaisesRegex(DecisionError, "invalid_logits"):
            contracts().decide("native", [float("nan"), 1, 2])
        with self.assertRaisesRegex(ValueError, "invalid_temperature"):
            contracts(temperature=0.1)

    def test_deployment_pins_artifacts_and_temperature(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            files = {"model.safetensors": b"fixture-not-weights", "encoder/config.json": b"{}",
                     "tokenizer/tokenizer.json": b"{}",
                     "tokenizer/tokenizer_config.json": b'{"tokenizer_class":"PreTrainedTokenizerFast"}',
                     "rl_agent_config.json": b'{"max_len":2560,"head_max_len":1024,"temperature":[2.0,1,1]}'}
            for name, content in files.items():
                target = root / "model" / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
            (root / "catalog.json").write_text(json.dumps(catalog()), encoding="utf-8")
            (root / "policy.json").write_text(json.dumps({"temperature": 2, "thresholds": {}}), encoding="utf-8")
            digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
            manifest = {"schema_version": 1, "model_id": "fixture", "checkpoint_path": "model",
                        "catalog_path": "catalog.json", "policy_path": "policy.json",
                        "catalog_sha256": digest(root / "catalog.json"), "policy_sha256": digest(root / "policy.json"),
                        "checkpoint_sha256": {name: digest(root / "model" / name) for name in files}}
            path = root / "deployment.json"
            path.write_text(json.dumps(manifest), encoding="utf-8")
            self.assertEqual(Deployment(path).max_len, 2560)
            (root / "model/model.safetensors").write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "checkpoint_hash_mismatch"):
                Deployment(path)


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.deployment = SimpleNamespace(contracts=contracts(), identity={"deployment_sha256": "pin"},
                                         manifest_sha256="pin", max_len=2560, head_max_len=1024)

    def test_each_head_is_separate_and_predictor_failure_has_fixed_reason(self):
        calls = []
        def predictor(state, question):
            calls.append((state, question))
            if len(calls) == 2:
                raise RuntimeError("private data must not escape")
            return [4, 0, -2]
        result = DecisionRuntime(self.deployment, predictor).decide([
            {"task_id": "native", "utterance": "first"}, {"task_id": "native", "utterance": "second"}])
        self.assertEqual(len(calls), 2)
        self.assertTrue(result["decisions"][0]["accepted"])
        self.assertEqual(result["decisions"][1]["reason"], "inference_failed")
        self.assertNotIn("private", json.dumps(result))

    def test_runtime_reports_lock_wait_separately_from_inference(self):
        now = [0.0]
        class WaitingLock:
            def __enter__(self):
                now[0] += 3
            def __exit__(self, *args):
                pass
        def predictor(*args):
            now[0] += 2
            return [4, 0, -2]
        runtime = DecisionRuntime(self.deployment, predictor)
        runtime.lock = WaitingLock()
        with patch('athena_api.laya.runtime.time.monotonic', side_effect=lambda: now[0]):
            result = runtime.decide([{'task_id': 'native', 'utterance': 'text'}])
        self.assertEqual(result['timings'], {'lock_wait_ms': 3000, 'processing_ms': 2000, 'total_ms': 5000})
        self.assertEqual(result['decisions'][0]['latency_ms'], 2000)

    def test_startup_warms_real_contract_before_server_and_failure_never_serves(self):
        schema = catalog()
        schema['tasks'][0]['task_id'] = 'general.builtin_tool'
        deployment = SimpleNamespace(contracts=Contracts(schema, {'temperature': 2, 'thresholds': {}}))
        for fails in (False, True):
            calls = []
            def predictor(state, question):
                calls.append((json.loads(state), question))
                if fails:
                    raise RuntimeError('warmup_failed')
                return [4, 0, -2]
            def serve(*args, **kwargs):
                self.assertEqual(len(calls), 1)
                self.assertEqual(list(calls[0][1]['crit']), ['yes', 'no', 'defer'])
            with self.subTest(fails=fails), patch.dict(os.environ, {'ATHENA_LAYA_RUNTIME_TOKEN': 'test'}), patch(
                    'sys.argv', ['runtime', '--deployment', 'fixture.json', '--device', 'cpu']), patch(
                    'athena_api.laya.runtime.Deployment', return_value=deployment), patch(
                    'athena_api.laya.runtime.SdkPredictor', return_value=predictor), patch('uvicorn.run', side_effect=serve) as run:
                if fails:
                    with self.assertRaisesRegex(RuntimeError, 'warmup_failed'):
                        runtime_module.main()
                    run.assert_not_called()
                else:
                    runtime_module.main()
                    run.assert_called_once()
            self.assertEqual(len(calls), 1)
            self.assertEqual(DecisionRuntime(deployment, predictor).counts, {})

    def test_runtime_auth_identity_and_bounded_request_before_predictor(self):
        calls = []
        app = create_app(self.deployment, lambda *x: calls.append(x) or [4, 0, -2], "secret")
        with TestClient(app) as client:
            self.assertEqual(client.post("/decide", json={}).status_code, 401)
            headers = {"Authorization": "Bearer secret"}
            request = {"requests": [{"task_id": "native", "utterance": "text"}], "deployment_sha256": "wrong"}
            self.assertEqual(client.post("/decide", headers=headers, json=request).status_code, 409)
            request["deployment_sha256"] = "pin"
            request["requests"] *= 33
            self.assertEqual(client.post("/decide", headers=headers, json=request).status_code, 422)
            self.assertEqual(calls, [])

    def test_health_reports_predictor_device_behind_authentication(self):
        def predictor(*args):
            return [4, 0, -2]
        predictor.device = "cpu"
        with TestClient(create_app(self.deployment, predictor, "secret")) as client:
            self.assertEqual(client.get("/health").status_code, 401)
            payload = client.get("/health", headers={"Authorization": "Bearer secret"}).json()
            self.assertEqual(payload["device"], "cpu")
            self.assertEqual(payload["identity"]["deployment_sha256"], "pin")


def write_default_bundle(root):
    root.mkdir(parents=True, exist_ok=True)
    files = {"model.safetensors": b"fixture-not-weights", "encoder/config.json": b"{}",
             "tokenizer/tokenizer.json": b"{}",
             "tokenizer/tokenizer_config.json": b'{"tokenizer_class":"PreTrainedTokenizerFast"}',
             "rl_agent_config.json": b'{"max_len":2560,"head_max_len":1024,"temperature":[2.0,1,1]}'}
    for name, content in files.items():
        path = root / "checkpoint" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    (root / "catalog.json").write_text(json.dumps(catalog()), encoding="utf-8")
    (root / "policy.json").write_text(json.dumps({"temperature": 2, "thresholds": {}}), encoding="utf-8")
    deployment = {"schema_version": 1, "model_id": "fixture", "checkpoint_path": "checkpoint",
                  "catalog_path": "catalog.json", "policy_path": "policy.json",
                  "catalog_sha256": sha256(root / "catalog.json"),
                  "policy_sha256": sha256(root / "policy.json"),
                  "checkpoint_sha256": {name: sha256(root / "checkpoint" / name) for name in files}}
    (root / "deployment.json").write_text(json.dumps(deployment), encoding="utf-8")
    bundle = {"schema_version": 1, "deployment_sha256": sha256(root / "deployment.json")}
    (root / "bundle.json").write_text(json.dumps(bundle), encoding="utf-8")
    return deployment, bundle


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'runtime with spaces'
        self.deployment, self.bundle = write_default_bundle(self.root)
        environment = patch.dict(os.environ, {"USERPROFILE": str(Path.home())}, clear=True)
        environment.start()
        self.addCleanup(environment.stop)

    def repin(self):
        (self.root / 'deployment.json').write_text(json.dumps(self.deployment), encoding='utf-8')
        self.bundle['deployment_sha256'] = sha256(self.root / 'deployment.json')
        (self.root / 'bundle.json').write_text(json.dumps(self.bundle), encoding='utf-8')

    def test_defaults_use_backend_python_cpu_and_fresh_private_tokens_without_mutation(self):
        settings = Settings(_env_file=None)
        environment = dict(os.environ)
        first, state = resolve_bundle(settings, bundle_root=self.root)
        second, _ = resolve_bundle(settings, bundle_root=self.root)
        self.assertEqual(state, 'bundled')
        self.assertEqual(first.laya_python_executable, Path(sys.executable))
        self.assertEqual(first.laya_deployment_path, self.root / 'deployment.json')
        self.assertEqual(first.laya_deployment_sha256, self.bundle['deployment_sha256'])
        self.assertEqual(first.laya_device, 'cpu')
        self.assertEqual(first.laya_timeout_seconds, 30)
        self.assertFalse(first.laya_catalog_enabled)
        self.assertIsNone(settings.laya_deployment_path)
        self.assertIsNone(settings.laya_runtime_token)
        one, two = (s.laya_runtime_token.get_secret_value() for s in (first, second))
        self.assertGreaterEqual(len(one), 32)
        self.assertNotEqual(one, two)
        self.assertEqual(dict(os.environ), environment)
        self.assertNotIn(one, repr(first))
        self.assertFalse(any(one.encode() in p.read_bytes() for p in self.root.rglob('*') if p.is_file()))

    def test_explicit_auto_overrides_and_dotenv_manual_configuration_are_preserved(self):
        settings = Settings(_env_file=None, laya_device='cuda', laya_python_executable='custom-python',
                            laya_runtime_token='custom-token', laya_runtime_url='http://127.0.0.1:8999',
                            laya_timeout_seconds=7)
        resolved, state = resolve_bundle(settings, bundle_root=self.root)
        self.assertEqual(state, 'bundled')
        for field in settings.model_fields_set:
            self.assertEqual(getattr(resolved, field), getattr(settings, field))
        dotenv = self.root / '.env'
        dotenv.write_text('ATHENA_LAYA_DEPLOYMENT_PATH=manual.json\nATHENA_LAYA_DEVICE=cpu\n', encoding='utf-8')
        settings = Settings(_env_file=dotenv)
        with patch('athena_api.laya.bundle._deployment', side_effect=AssertionError('No auto discovery')):
            self.assertEqual(resolve_bundle(settings, bundle_root=self.root), (settings, 'manual'))
        with patch.dict(os.environ, {'ATHENA_LAYA_DEPLOYMENT_SHA256': 'manual-pin'}):
            settings = Settings(_env_file=None)
            self.assertEqual(resolve_bundle(settings, bundle_root=self.root), (settings, 'manual'))

    def test_missing_corrupt_and_wrong_pin_bundles_fall_back_without_loading_weights(self):
        settings = Settings(_env_file=None)
        self.assertEqual(resolve_bundle(settings, bundle_root=self.root / 'missing'), (settings, 'bundle_missing'))
        for payload in ('not-json', '[]', '{"schema_version":true}', json.dumps({**self.bundle, 'deployment_sha256': '0' * 64})):
            with self.subTest(payload=payload):
                (self.root / 'bundle.json').write_text(payload, encoding='utf-8')
                self.assertEqual(resolve_bundle(settings, bundle_root=self.root), (settings, 'bundle_invalid'))

    def test_auto_bundle_rejects_escaped_and_missing_paths_even_when_manifest_is_repinned(self):
        settings = Settings(_env_file=None)
        for key in ('checkpoint_path', 'catalog_path', 'policy_path'):
            original = self.deployment[key]
            for value in ('../outside', str(self.root.parent / 'outside'), 'C:relative-drive'):
                with self.subTest(key=key, value=value):
                    self.deployment[key] = value
                    self.repin()
                    self.assertEqual(resolve_bundle(settings, bundle_root=self.root), (settings, 'bundle_invalid'))
            self.deployment[key] = original
        self.deployment['checkpoint_sha256']['../outside'] = '0' * 64
        self.repin()
        self.assertEqual(resolve_bundle(settings, bundle_root=self.root), (settings, 'bundle_invalid'))
        del self.deployment['checkpoint_sha256']['../outside']
        self.repin()
        (self.root / 'checkpoint/model.safetensors').unlink()
        self.assertEqual(resolve_bundle(settings, bundle_root=self.root), (settings, 'bundle_invalid'))

    def test_symlink_resolution_cannot_escape_bundle_root(self):
        original = Path.resolve
        def resolve(path, *args, **kwargs):
            if path == self.root / 'catalog.json':
                return self.root.parent / 'outside.json'
            return original(path, *args, **kwargs)
        with patch.object(Path, 'resolve', resolve):
            settings = Settings(_env_file=None)
            self.assertEqual(resolve_bundle(settings, bundle_root=self.root), (settings, 'bundle_invalid'))

    def test_lifespan_uses_bundle_and_keeps_missing_bundle_nonfatal(self):
        from athena_api.lifespan import build_lifespan

        settings = Settings(_env_file=None, instrument_db_path=self.root / 'instruments.sqlite3',
                            nudge_guard_path=self.root / 'guard.json')
        for root, expected in [(self.root, 'bundled'), (self.root / 'missing', 'bundle_missing')]:
            with self.subTest(state=expected), patch('athena_api.laya.bundle.DEFAULT_BUNDLE_ROOT', root), \
                    patch('athena_api.laya.worker.ManagedWorker.start', new=AsyncMock()) as start, \
                    patch('athena_api.laya.worker.ManagedWorker.close', new=AsyncMock()) as close:
                app = FastAPI(lifespan=build_lifespan(settings))
                with TestClient(app):
                    self.assertEqual(app.state.laya_worker.bundle_state, expected)
                    self.assertIsNone(settings.laya_runtime_token)
                    if expected == 'bundled':
                        self.assertEqual(app.state.settings.laya_device, 'cpu')
                        self.assertEqual(app.state.laya_service.client.token,
                                         app.state.settings.laya_runtime_token.get_secret_value())
                    else:
                        self.assertEqual(app.state.laya_worker.state, 'bundle_missing')
                    self.assertNotEqual(app.state.laya_worker.state, 'ready')
                start.assert_awaited_once()
                close.assert_awaited_once()


class CpuSettingsTests(unittest.TestCase):
    def test_cpu_timeout_default_and_explicit_override(self):
        with patch.dict(os.environ, {"USERPROFILE": str(Path.home())}, clear=True):
            self.assertEqual(Settings(_env_file=None, laya_device="cpu").laya_timeout_seconds, 30)
            self.assertEqual(Settings(_env_file=None, laya_device="cuda").laya_timeout_seconds, 2.5)
            self.assertEqual(Settings(_env_file=None, laya_device="cpu",
                                      laya_timeout_seconds=4).laya_timeout_seconds, 4)
        with patch.dict(os.environ, {"USERPROFILE": str(Path.home()), "ATHENA_LAYA_DEVICE": "cpu",
                                   "ATHENA_LAYA_TIMEOUT_SECONDS": "7"}, clear=True):
            self.assertEqual(Settings(_env_file=None).laya_timeout_seconds, 7)


class TransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_transport_distinguishes_setup_http_and_close_cost_without_input_data(self):
        now = [0.0]
        class TimedClient:
            def __init__(self, **kwargs):
                now[0] += 3
            async def __aenter__(self):
                return self
            async def __aexit__(self, *args):
                now[0] += 2
            async def post(self, *args, **kwargs):
                now[0] += 7
                return httpx.Response(200, request=httpx.Request('POST', 'http://127.0.0.1/decide'),
                    json={'identity': {'deployment_sha256': 'pin'}, 'decisions': [
                        {'task_id': 'native', 'accepted': False, 'reason': 'defer'}],
                        'timings': {'lock_wait_ms': 1000, 'processing_ms': 4000, 'total_ms': 5000}})
        client = RuntimeClient('http://127.0.0.1:8769', 'private-token', 'pin')
        with patch('athena_api.laya.client.httpx.AsyncClient', TimedClient), patch(
                'athena_api.laya.client.time.monotonic', side_effect=lambda: now[0]):
            await client.decide([{'task_id': 'native', 'utterance': 'private-utterance'}])
        self.assertEqual(client.last_timing['client_setup_ms'], 3000)
        self.assertEqual(client.last_timing['http_ms'], 7000)
        self.assertEqual(client.last_timing['close_ms'], 2000)
        self.assertEqual(client.last_timing['total_ms'], 12000)
        self.assertEqual(client.last_timing['runtime_timings']['lock_wait_ms'], 1000)
        self.assertNotIn('private', json.dumps(client.last_timing))

    async def test_loopback_only_and_runtime_identity_mismatch(self):
        with self.assertRaisesRegex(ValueError, "loopback"):
            RuntimeClient("https://remote.example", "secret", "pin")
        seen = []
        def handler(request):
            seen.append(request)
            return httpx.Response(200, json={"identity": {"deployment_sha256": "other"}, "decisions": []})
        client = RuntimeClient("http://127.0.0.1:8769", "secret", "pin", transport=httpx.MockTransport(handler))
        result = await client.decide([{"task_id": "native", "utterance": "x"}])
        self.assertEqual(result[0]["reason"], "deployment_mismatch")
        self.assertEqual(seen[0].headers["Authorization"], "Bearer secret")

    async def test_timeout_and_unconfigured_are_fallbacks(self):
        def handler(request):
            raise httpx.ReadTimeout("private details", request=request)
        client = RuntimeClient("http://127.0.0.1:8769", "secret", "pin", transport=httpx.MockTransport(handler))
        self.assertEqual((await client.decide([{"task_id": "native"}]))[0]["reason"], "timeout")
        client.token = ""
        self.assertEqual((await client.decide([{"task_id": "native"}]))[0]["reason"], "unconfigured")


class TurnTests(unittest.IsolatedAsyncioTestCase):
    def register(self, service, conversation="one", lease="lease-one", turn="first", origin="shell"):
        return service.register(lease_id=lease, generation_id="generation", conversation_id=conversation,
            turn_id=turn, utterance="original", context={"selected": "one"}, origin=origin)

    async def test_foreign_lease_generation_supersession_and_isolated_context(self):
        service = SemanticService(None)
        one, two = self.register(service), self.register(service, "two", "lease-two")
        with self.assertRaisesRegex(TurnExpired, "binding"):
            service.context(one, lease_id="lease-two", generation_id="generation")
        with self.assertRaisesRegex(TurnExpired, "binding"):
            service.context(one, lease_id="lease-one", generation_id="wrong")
        service.context(one)["context"]["selected"] = "tampered"
        self.assertEqual(service.context(one)["context"]["selected"], "one")
        self.register(service, turn="replacement")
        with self.assertRaises(TurnExpired):
            service.context(one)
        self.assertEqual(service.context(two)["conversation_id"], "two")

    async def test_supersession_during_inference_and_backtest_never_calls(self):
        started, release = asyncio.Event(), asyncio.Event()
        async def decide(requests):
            started.set()
            await release.wait()
            return []
        service = SemanticService(SimpleNamespace(decide=decide))
        ticket = self.register(service)
        pending = asyncio.create_task(service.decide(ticket, [{"task_id": "native"}]))
        await started.wait()
        self.register(service, turn="next")
        release.set()
        with self.assertRaises(TurnExpired):
            await pending
        ticket = self.register(service, origin="backtest")
        result = await service.decide(ticket, [{"task_id": "native"}])
        self.assertEqual(result[0]["reason"], "excluded_scope")

    async def test_expiry_and_capacity(self):
        now = [0]
        service = SemanticService(None, clock=lambda: now[0], ttl=3, capacity=1)
        old = self.register(service)
        latest = self.register(service, "two", "lease-two")
        with self.assertRaises(TurnExpired):
            service.context(old)
        now[0] = 3
        with self.assertRaises(TurnExpired):
            service.context(latest)


if __name__ == "__main__":
    unittest.main()
