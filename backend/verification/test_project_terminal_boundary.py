import json
import sys
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from athena_api.api.projects import router, run_project_terminal
from athena_api.projects.store import ProjectStore

TOKEN = "terminal-test-token"
SECRET = "SENTINEL-7f3a"
DUMP_ENV = ["import json, os; print(json.dumps(dict(os.environ)))"]


def _request(tmp_path):
    folder = tmp_path / "technique"
    folder.mkdir()
    projects_root = tmp_path / "registry"
    project = ProjectStore(projects_root).open_external(str(folder))
    state = SimpleNamespace(
        settings=SimpleNamespace(projects_root=projects_root),
        local_bearer_token=TOKEN,
    )
    return SimpleNamespace(app=SimpleNamespace(state=state)), project


@pytest.mark.asyncio
@pytest.mark.parametrize("authorization", ["", "Bearer wrong-token", f"Basic {TOKEN}"])
async def test_terminal_refuses_without_the_local_bearer(tmp_path, authorization):
    request, project = _request(tmp_path)
    marker = tmp_path / "technique" / "ran.txt"
    body = {"argv": [sys.executable, "-c", f"open({str(marker)!r}, 'w').write('x')"]}

    with pytest.raises(HTTPException) as caught:
        await run_project_terminal(request, project.id, body, authorization=authorization)

    assert caught.value.status_code == 401
    assert not marker.exists()


def test_terminal_route_without_authorization_header_is_401(tmp_path):
    request, project = _request(tmp_path)
    app = FastAPI()
    app.include_router(router)
    app.state.settings = request.app.state.settings
    app.state.local_bearer_token = TOKEN

    response = TestClient(app).post(
        f"/api/v1/projects/{project.id}/terminal", json={"argv": [sys.executable, "-V"]}
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_terminal_child_does_not_inherit_backend_secrets(tmp_path, monkeypatch):
    accounts = [{"app_key": SECRET, "secret_key": SECRET}]
    monkeypatch.setenv("ATHENA_KIWOOM_ACCOUNTS", json.dumps(accounts))
    monkeypatch.setenv("ATHENA_LOCAL_BEARER_TOKEN", TOKEN)
    monkeypatch.setenv("ATHENA_ORDER_KEY", SECRET)
    monkeypatch.setenv("ANTHROPIC_API_KEY", SECRET)
    request, project = _request(tmp_path)

    result = await run_project_terminal(
        request,
        project.id,
        {"argv": [sys.executable, "-c", *DUMP_ENV]},
        authorization=f"Bearer {TOKEN}",
    )

    assert result["exit_code"] == 0, result["stderr"]
    child = json.loads(result["stdout"])
    names = {name.upper() for name in child}
    assert SECRET not in result["stdout"]
    assert not any(name.startswith("ATHENA_") for name in names - {"ATHENA_PROJECT_ROOT"})
    assert "PATH" in names
    assert child["ATHENA_PROJECT_ROOT"] == str(tmp_path / "technique")
    if sys.platform == "win32":
        assert "SYSTEMROOT" in names
