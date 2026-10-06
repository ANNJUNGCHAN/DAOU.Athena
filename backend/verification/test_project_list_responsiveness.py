import asyncio
import threading
from types import SimpleNamespace

from fastapi import FastAPI
import httpx
import pytest

from athena_api.api import projects
from athena_api.projects.store import ProjectStore


def project_app(tmp_path):
    registry = tmp_path / "registry"
    entry = ProjectStore(registry).create_managed("fixture")
    app = FastAPI()
    app.state.settings = SimpleNamespace(projects_root=registry)
    app.include_router(projects.router)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    return app, entry


@pytest.mark.parametrize("operation", ["list", "create", "open", "relink"])
async def test_project_scan_does_not_block_unrelated_backend_requests(tmp_path, monkeypatch, operation):
    app, entry = project_app(tmp_path)
    started, release, finished = threading.Event(), threading.Event(), threading.Event()
    external = tmp_path / "external"
    external.mkdir()
    requests = {
        "list": ("GET", "/api/v1/projects", None),
        "create": ("POST", "/api/v1/projects", {"name": "new-fixture"}),
        "open": ("POST", "/api/v1/projects/open", {"path": str(external)}),
        "relink": ("POST", f"/api/v1/projects/{entry.id}/relink", {"path": str(external)}),
    }

    def slow_count(_path):
        started.set()
        try:
            release.wait()
            return 7
        finally:
            finished.set()

    monkeypatch.setattr(projects, "count_py_files", slow_count)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
        # The test releases the scan after the health check. A separate watchdog
        # prevents a blocking regression from deadlocking the test event loop.
        watchdog = threading.Timer(10, release.set)
        watchdog.daemon = True
        watchdog.start()
        method, path, body = requests[operation]
        pending = asyncio.create_task(client.request(method, path, json=body))
        try:
            assert await asyncio.to_thread(started.wait, 5)
            health = await client.get("/health")
            assert health.json() == {"status": "ok"}
            assert not finished.is_set(), "The project scan blocked unrelated requests until it completed"
        finally:
            release.set()
            watchdog.cancel()
            response = await pending
        assert response.status_code == 200
        payload = response.json()
        view = payload["projects"][0] if operation == "list" else payload["project"]
        assert view["py_files"] == 7


async def test_project_listing_keeps_current_file_counts_and_ignores_environment_dirs(tmp_path):
    app, entry = project_app(tmp_path)
    (entry.path / "source.py").write_text("", encoding="utf-8")
    for name in (".venv", "node_modules", ".git", "__pycache__"):
        folder = entry.path / name
        folder.mkdir()
        (folder / "ignored.py").write_text("", encoding="utf-8")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
        first = (await client.get("/api/v1/projects")).json()
        assert first["projects"][0]["exists"] is True
        assert first["projects"][0]["py_files"] == 2
        (entry.path / "new.py").write_text("", encoding="utf-8")
        second = (await client.get("/api/v1/projects")).json()
        assert second["projects"][0]["py_files"] == 3
        assert second["notice"] == first["notice"]
