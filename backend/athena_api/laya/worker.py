"""Lifecycle of the one local inference child owned by this backend instance."""
from __future__ import annotations

import asyncio
import os
from pathlib import Path
import subprocess
from urllib.parse import urlsplit
import uuid

import httpx


class ManagedWorker:
    def __init__(self, settings, client, *, spawn=asyncio.create_subprocess_exec, transport=None):
        self.settings, self.client, self.spawn, self.transport = settings, client, spawn, transport
        self.process, self.monitor, self.log_file = None, None, None
        self.state = "unconfigured"

    async def health(self):
        try:
            # Windows loopback refusal can take about two seconds. A shorter
            # connect timeout cannot distinguish an absent port from a slow peer.
            async with httpx.AsyncClient(timeout=httpx.Timeout(1, connect=3),
                                         transport=self.transport, trust_env=False) as http:
                response = await http.get(self.client.url + "/health",
                    headers={"Authorization": "Bearer " + self.client.token})
            if response.status_code != 200:
                return "conflicting_runtime"
            payload = response.json()
            matches = (payload.get("identity", {}).get("deployment_sha256") == self.client.deployment_sha256
                       and payload.get("device") == self.settings.laya_device)
            return "ready" if matches else "conflicting_runtime"
        except httpx.ConnectError:
            return "absent"
        except (httpx.HTTPError, ValueError, TypeError):
            return "unresponsive_runtime"

    async def start(self):
        settings = self.settings
        if (not settings.laya_python_executable or not settings.laya_deployment_path
                or not self.client.token or not self.client.deployment_sha256):
            return
        existing = await self.health()
        if existing != "absent":
            self.state = "reused" if existing == "ready" else existing
            return
        python = Path(settings.laya_python_executable).resolve()
        deployment = Path(settings.laya_deployment_path).resolve()
        if not python.is_file() or not deployment.is_file():
            self.state = "configuration_invalid"
            return
        logs = deployment.parent / "runtime-logs"
        logs.mkdir(parents=True, exist_ok=True)
        self.log_file = (logs / ("laya-" + uuid.uuid4().hex + ".log")).open("xb")
        env = dict(os.environ)
        env["PYTHONPATH"] = str(Path(__file__).resolve().parents[2])
        env["ATHENA_LAYA_RUNTIME_TOKEN"] = self.client.token
        argv = [str(python), "-X", "utf8", "-u", "-m", "athena_api.laya.runtime",
                "--deployment", str(deployment), "--device", settings.laya_device,
                "--port", str(urlsplit(self.client.url).port or 8769)]
        try:
            self.process = await self.spawn(*argv, env=env, cwd=str(deployment.parent),
                stdin=asyncio.subprocess.DEVNULL, stdout=self.log_file, stderr=asyncio.subprocess.STDOUT,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        except (OSError, ValueError):
            self.state = "startup_failed"
            self.log_file.close()
            self.log_file = None
            return
        self.state = "starting"
        self.monitor = asyncio.create_task(self._await_ready(), name="athena-laya-readiness")

    async def _await_ready(self):
        # Loading is asynchronous; other Athena features remain available and use
        # their existing fallback until this exact artifact reports ready.
        for _ in range(90):
            if self.process.returncode is not None:
                self.state = "startup_failed"
                return
            await asyncio.sleep(1)
            status = await self.health()
            if status == "ready":
                self.state = "ready"
                return
            if status == "conflicting_runtime":
                self.state = status
                return
        self.state = "startup_timeout"

    async def close(self):
        try:
            if self.monitor:
                self.monitor.cancel()
                await asyncio.gather(self.monitor, return_exceptions=True)
                self.monitor = None
            # Never terminate a reused or unrelated service; only our live handle.
            if self.process is not None and self.process.returncode is None:
                if os.name == "nt":
                    # Windows venv launchers own the real Python/CUDA child.
                    # A wrapper-only terminate would leak it across restarts.
                    killer = await self.spawn("taskkill.exe", "/PID", str(self.process.pid), "/T", "/F",
                        stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
                    try:
                        code = await asyncio.wait_for(killer.wait(), timeout=5)
                    except TimeoutError:
                        if killer.returncode is None:
                            killer.kill()  # Only this task-owned cleanup command.
                            await asyncio.wait_for(killer.wait(), timeout=5)
                        raise
                    if code != 0:
                        raise RuntimeError("owned_runtime_tree_stop_failed")
                    await asyncio.wait_for(self.process.wait(), timeout=5)
                else:
                    self.process.terminate()
                    try:
                        await asyncio.wait_for(self.process.wait(), timeout=5)
                    except TimeoutError:
                        self.process.kill()
                        await asyncio.wait_for(self.process.wait(), timeout=5)
            self.state = "stopped"
        except (Exception, asyncio.CancelledError):
            self.state = "shutdown_failed"
            raise
        finally:
            if self.log_file:
                self.log_file.close()
                self.log_file = None
