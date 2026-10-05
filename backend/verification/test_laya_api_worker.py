from collections import Counter
import json
import io
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
import httpx

from athena_api.api.laya import router
from athena_api.laya.client import RuntimeClient
from athena_api.laya.service import SemanticService
from athena_api.laya.worker import ManagedWorker


class LocalChoices:
    token = "runtime-only"
    deployment_sha256 = "pin"

    def __init__(self):
        self.counts = Counter()
        self.requests = []

    async def decide(self, requests):
        self.requests.extend(requests)
        choices = {"general.builtin_tool": "athena_graph_view", "graph.action": "navigate", "graph.surface": "map"}
        return [{"task_id": item["task_id"], "label": choices.get(item["task_id"], "defer"),
                 "accepted": item["task_id"] in choices, "reason": "fixture"} for item in requests]


class ApiTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        self.choices = LocalChoices()
        app.state.laya_service = SemanticService(self.choices)
        app.state.local_bearer_token = "backend-only"
        app.include_router(router)
        self.client = TestClient(app, client=("127.0.0.1", 50000))
        self.headers = {"Authorization": "Bearer backend-only", "X-Athena-Laya-Lease": "x" * 32,
                        "X-Athena-Laya-Generation": "generation"}

    def ticket(self):
        response = self.client.post("/api/v1/laya/turns", headers=self.headers, json={
            "lease_id": "x" * 32, "generation_id": "generation", "conversation_id": "one", "turn_id": "turn",
            "utterance": "지도로 이동해", "context": {"canvasMode": "graph"}})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["ticket"]

    def test_authenticated_registered_plan_and_actual_existing_handler_dispatch(self):
        ticket = self.ticket()
        prefix = "/api/v1/laya/turns/" + ticket
        plan = self.client.post(prefix + "/plan", headers=self.headers, json={}).json()
        self.assertTrue(plan["complete"])
        self.assertNotIn("result", plan)
        response = self.client.post(prefix + "/dispatch", headers=self.headers, json={})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertTrue(result["applied"])
        envelope = json.loads(result["result"]["content"][0]["text"])
        self.assertEqual(envelope["kind"], "navigate")
        self.assertEqual(envelope["surface"], "map")
        self.assertEqual(result, self.client.post(prefix + "/dispatch", headers=self.headers, json={}).json())
        self.assertEqual(len(self.choices.requests), 3)

    def test_foreign_binding_wrong_bearer_and_revoked_ticket_fail_closed(self):
        ticket = self.ticket()
        url = "/api/v1/laya/turns/" + ticket
        foreign = {**self.headers, "X-Athena-Laya-Lease": "y" * 32}
        self.assertEqual(self.client.post(url + "/plan", headers=foreign).status_code, 409)
        self.assertEqual(self.client.post(url + "/plan").status_code, 401)
        self.assertEqual(self.client.delete(url, headers=self.headers).status_code, 200)
        self.assertEqual(self.client.post(url + "/plan", headers=self.headers).status_code, 409)
        self.assertEqual(self.choices.requests, [])

    def test_first_tool_route_is_enforced_before_existing_handler(self):
        ticket = self.ticket()
        response = self.client.post("/api/v1/laya/turns/" + ticket + "/refine", headers=self.headers,
                                    json={"tool_name": "athena_routine", "arguments": {"action": "list"}})
        self.assertTrue(response.json()["blocked"])
        self.assertEqual(response.json()["expected_tool"], "athena_graph_view")
        self.assertNotIn("routine.action", [item["task_id"] for item in self.choices.requests])


class WorkerTests(unittest.IsolatedAsyncioTestCase):
    def settings(self, root):
        return SimpleNamespace(laya_python_executable=root / "python.exe",
                               laya_deployment_path=root / "deployment.json", laya_device="cpu")

    async def test_unconfigured_worker_has_no_spawn_or_http(self):
        async def spawn(*args, **kwargs):
            self.fail("Unexpected child")
        def http(request):
            self.fail("Unexpected request")
        worker = ManagedWorker(SimpleNamespace(laya_python_executable=None, laya_deployment_path=None),
            RuntimeClient("http://127.0.0.1:8769", "", ""), spawn=spawn, transport=httpx.MockTransport(http))
        await worker.start()
        self.assertEqual(worker.state, "unconfigured")

    async def test_exact_existing_worker_reused_and_never_terminated(self):
        async def spawn(*args, **kwargs):
            self.fail("Existing authenticated worker must not be duplicated")
        def http(request):
            return httpx.Response(200, json={"identity": {"deployment_sha256": "pin"}, "device": "cpu"})
        worker = ManagedWorker(self.settings(Path("unused")), RuntimeClient("http://127.0.0.1:8769", "secret", "pin"),
                               spawn=spawn, transport=httpx.MockTransport(http))
        await worker.start()
        self.assertEqual(worker.state, "reused")
        self.assertIsNone(worker.process)
        await worker.close()

    async def test_same_model_wrong_or_unknown_device_is_not_reused(self):
        async def spawn(*args, **kwargs):
            self.fail("An existing runtime must not be replaced or duplicated")
        for device in ("cuda", None):
            with self.subTest(device=device):
                def http(request):
                    return httpx.Response(200, json={"identity": {"deployment_sha256": "pin"},
                                                     "device": device})
                worker = ManagedWorker(self.settings(Path("unused")),
                    RuntimeClient("http://127.0.0.1:8769", "secret", "pin"),
                    spawn=spawn, transport=httpx.MockTransport(http))
                await worker.start()
                self.assertEqual(worker.state, "conflicting_runtime")
                self.assertIsNone(worker.process)
                await worker.close()

    async def test_foreign_existing_runtime_does_not_trigger_spawn(self):
        async def spawn(*args, **kwargs):
            self.fail("Conflicting runtime must not be modified")
        def http(request):
            return httpx.Response(401)
        worker = ManagedWorker(self.settings(Path("unused")), RuntimeClient("http://127.0.0.1:8769", "secret", "pin"),
                               spawn=spawn, transport=httpx.MockTransport(http))
        await worker.start()
        self.assertEqual(worker.state, "conflicting_runtime")

    async def test_connect_timeout_is_not_absence_and_read_probe_remains_bounded(self):
        async def spawn(*args, **kwargs):
            self.fail("An ambiguous connection must not spawn a competing worker")
        def timeout(request):
            self.assertEqual(request.extensions["timeout"]["connect"], 3)
            self.assertEqual(request.extensions["timeout"]["read"], 1)
            raise httpx.ConnectTimeout("fixture peer not established", request=request)
        worker = ManagedWorker(self.settings(Path("unused")), RuntimeClient("http://127.0.0.1:8769", "secret", "pin"),
                               spawn=spawn, transport=httpx.MockTransport(timeout))
        await worker.start()
        self.assertEqual(worker.state, "unresponsive_runtime")
        self.assertIsNone(worker.process)

    async def test_owned_child_uses_private_env_hidden_window_and_only_owned_handle_closes(self):
        class Child:
            pid = 12345
            returncode = None
            terminated = False
            def terminate(self):
                self.terminated = True
                self.returncode = 0
            async def wait(self):
                return self.returncode
        child, calls = Child(), []
        async def spawn(*args, **kwargs):
            calls.append((args, kwargs))
            if args[0] == "taskkill.exe":
                child.terminate()
            return child
        def absent(request):
            raise httpx.ConnectError("absent", request=request)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "python.exe").write_bytes(b"fixture-executable-never-run")
            (root / "deployment.json").write_text("{}")
            worker = ManagedWorker(self.settings(root), RuntimeClient("http://127.0.0.1:8769", "secret", "pin"),
                                   spawn=spawn, transport=httpx.MockTransport(absent))
            await worker.start()
            self.assertEqual(worker.state, "starting")
            argv, options = calls[0]
            self.assertIn("athena_api.laya.runtime", argv)
            self.assertEqual(argv[argv.index("--device") + 1], "cpu")
            self.assertNotIn("secret", " ".join(argv))
            self.assertEqual(options["env"]["ATHENA_LAYA_RUNTIME_TOKEN"], "secret")
            self.assertNotIn("shell", options)
            await worker.close()
            self.assertTrue(child.terminated)
            self.assertEqual(worker.state, "stopped")
            if os.name == "nt":
                self.assertEqual(calls[1][0], ("taskkill.exe", "/PID", "12345", "/T", "/F"))
                self.assertNotIn("shell", calls[1][1])

    async def test_already_exited_owned_handle_does_not_kill_reused_pid(self):
        async def spawn(*args, **kwargs):
            self.fail("An exited handle must never cause a PID-based kill")
        worker = ManagedWorker(self.settings(Path("unused")), RuntimeClient("http://127.0.0.1:8769", "secret", "pin"), spawn=spawn)
        worker.process = SimpleNamespace(pid=12345, returncode=0)
        await worker.close()

    async def test_startup_failure_retains_fallback_without_child(self):
        async def spawn(*args, **kwargs):
            raise OSError("fixture process startup failure")
        def absent(request):
            raise httpx.ConnectError("absent", request=request)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "python.exe").write_bytes(b"not-run")
            (root / "deployment.json").write_text("{}")
            worker = ManagedWorker(self.settings(root), RuntimeClient("http://127.0.0.1:8769", "secret", "pin"),
                                   spawn=spawn, transport=httpx.MockTransport(absent))
            await worker.start()
            self.assertEqual(worker.state, "startup_failed")
            self.assertIsNone(worker.process)
            self.assertIsNone(worker.log_file)

    @unittest.skipUnless(os.name == "nt", "Windows process-tree cleanup contract")
    async def test_tree_stop_failure_never_claims_stopped_and_always_closes_log(self):
        class Killer:
            async def wait(self):
                return 1
        calls = []
        async def spawn(*args, **kwargs):
            calls.append(args)
            return Killer()
        worker = ManagedWorker(self.settings(Path("unused")), RuntimeClient("http://127.0.0.1:8769", "secret", "pin"), spawn=spawn)
        worker.process = SimpleNamespace(pid=45678, returncode=None)
        log = worker.log_file = io.StringIO()
        with self.assertRaisesRegex(RuntimeError, "owned_runtime_tree_stop_failed"):
            await worker.close()
        self.assertEqual(calls, [("taskkill.exe", "/PID", "45678", "/T", "/F")])
        self.assertEqual(worker.state, "shutdown_failed")
        self.assertIsNone(worker.process.returncode)
        self.assertTrue(log.closed)
        self.assertIsNone(worker.log_file)

    @unittest.skipUnless(os.name == "nt", "Windows process-tree cleanup contract")
    async def test_cleanup_spawn_error_closes_log_and_surfaces_owned_stop_failure(self):
        async def spawn(*args, **kwargs):
            raise OSError("fixture cleanup launch denied")
        worker = ManagedWorker(self.settings(Path("unused")), RuntimeClient("http://127.0.0.1:8769", "secret", "pin"), spawn=spawn)
        worker.process = SimpleNamespace(pid=45678, returncode=None)
        log = worker.log_file = io.StringIO()
        with self.assertRaises(OSError):
            await worker.close()
        self.assertEqual(worker.state, "shutdown_failed")
        self.assertTrue(log.closed)

    @unittest.skipUnless(os.name == "nt", "Windows process-tree cleanup contract")
    async def test_owned_process_wait_timeout_is_not_reported_as_stopped(self):
        class Child:
            pid, returncode = 45678, None
            async def wait(self):
                raise TimeoutError("fixture owned process remains live")
        class Killer:
            async def wait(self):
                return 0
        async def spawn(*args, **kwargs):
            return Killer()
        worker = ManagedWorker(self.settings(Path("unused")), RuntimeClient("http://127.0.0.1:8769", "secret", "pin"), spawn=spawn)
        worker.process = Child()
        log = worker.log_file = io.StringIO()
        with self.assertRaises(TimeoutError):
            await worker.close()
        self.assertEqual(worker.state, "shutdown_failed")
        self.assertTrue(log.closed)


if __name__ == "__main__":
    unittest.main()
