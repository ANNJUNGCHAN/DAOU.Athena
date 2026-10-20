from __future__ import annotations

import json
import os
import secrets
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

import pytest
from fastapi.testclient import TestClient

from athena_api.readonly_app import (
    API_VERSION,
    CANVAS_KINDS,
    PROFILE,
    ReadonlySettings,
    create_readonly_app,
)

TOKEN = "readonly-test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
ALLOWED_ROUTES = {
    ("GET", "/health"),
    ("GET", "/api/v1/readonly/capabilities"),
    ("GET", "/api/v1/readonly/manifest"),
    ("POST", "/api/v1/readonly/search"),
    ("POST", "/api/v1/readonly/describe"),
}


def _app() -> TestClient:
    return TestClient(
        create_readonly_app(ReadonlySettings(_env_file=None, local_bearer_token=TOKEN))
    )


def _route_inventory(client: TestClient) -> set[tuple[str, str]]:
    inventory: set[tuple[str, str]] = set()
    for route in client.app.routes:
        for method in getattr(route, "methods", set()):
            inventory.add((method, route.path))
    return inventory


def test_readonly_app_fails_closed_without_a_bearer() -> None:
    with pytest.raises(RuntimeError, match="requires ATHENA_LOCAL_BEARER_TOKEN"):
        create_readonly_app(ReadonlySettings(_env_file=None, local_bearer_token=None))


def test_readonly_import_does_not_load_full_app_or_router() -> None:
    completed = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import sys; import athena_api.readonly_app; "
                "assert 'athena_api.main' not in sys.modules; "
                "assert 'athena_api.api' not in sys.modules; "
                "assert 'athena_api.lifespan' not in sys.modules; "
                "assert 'athena_api.selector.service' not in sys.modules; "
                "assert 'athena_api.generated.runtime' not in sys.modules; "
                "assert 'athena_api.accounts' not in sys.modules; "
                "assert 'athena_api.kiwoom' not in sys.modules"
            ),
        ],
        cwd=Path(__file__).resolve().parents[1],
        stdin=subprocess.DEVNULL,
        capture_output=True,
        timeout=20,
        check=False,
    )
    assert completed.returncode == 0


def test_selector_package_keeps_the_execution_service_as_a_lazy_compatible_export() -> None:
    completed = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import sys; import athena_api.selector as package; "
                "assert 'SelectorService' in package.__all__; "
                "assert 'athena_api.selector.service' not in sys.modules; "
                "assert 'athena_api.kiwoom' not in sys.modules; "
                "exported = package.SelectorService; "
                "from athena_api.selector import SelectorService as imported; "
                "from athena_api.selector.service import SelectorService as direct; "
                "assert exported is imported is direct"
            ),
        ],
        cwd=Path(__file__).resolve().parents[1],
        stdin=subprocess.DEVNULL,
        capture_output=True,
        timeout=20,
        check=False,
    )
    assert completed.returncode == 0


def test_readonly_launcher_without_bearer_fails_before_announcement() -> None:
    environment = {key: value for key, value in os.environ.items() if not key.startswith("ATHENA_")}
    completed = subprocess.run(
        [sys.executable, "-m", "athena_api.launcher", "--profile", "wts-readonly"],
        cwd=Path(__file__).resolve().parents[1],
        env=environment,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        timeout=20,
        check=False,
    )
    assert completed.returncode != 0
    assert b"ATHENA_BACKEND_URL=" not in completed.stdout


def test_every_allowed_route_requires_the_exact_bearer() -> None:
    client = _app()
    calls = [
        ("GET", "/health", None),
        ("GET", "/api/v1/readonly/capabilities", None),
        ("GET", "/api/v1/readonly/manifest", None),
        ("POST", "/api/v1/readonly/search", {"query": "현재가"}),
        ("POST", "/api/v1/readonly/describe", {"operation_ref": "base:ka10003"}),
    ]
    for method, path, body in calls:
        assert client.request(method, path, json=body).status_code == 401
        assert (
            client.request(
                method,
                path,
                json=body,
                headers={"Authorization": "Bearer wrong"},
            ).status_code
            == 401
        )
        assert client.request(method, path, json=body, headers=AUTH).status_code == 200


def test_exact_route_and_capability_inventory_has_no_execution_surface() -> None:
    client = _app()
    assert _route_inventory(client) == ALLOWED_ROUTES
    response = client.get("/api/v1/readonly/capabilities", headers=AUTH)
    assert response.status_code == 200
    assert response.json() == {
        "profile": PROFILE,
        "apiVersion": API_VERSION,
        "catalog": True,
        "search": True,
        "describe": True,
        "financialQuery": False,
        "credentials": False,
        "externalAi": False,
        "jobs": False,
        "order": False,
        "websocket": False,
        "canvasKinds": list(CANVAS_KINDS),
    }
    for forbidden in (
        "/docs",
        "/openapi.json",
        "/api/v1/selector/resolve",
        "/api/v1/selector/call",
        "/api/v1/orders",
        "/api/v1/ws",
    ):
        assert client.get(forbidden, headers=AUTH).status_code == 404


def test_manifest_search_and_describe_are_actual_query_only_selector_data() -> None:
    client = _app()
    manifest = client.get("/api/v1/readonly/manifest", headers=AUTH).json()
    assert manifest["profile"] == PROFILE
    assert manifest["catalogVersion"].startswith("sha256:")
    assert len(manifest["operations"]) > 100
    assert {item["kind"] for item in manifest["operations"]} == {"query"}

    search = client.post(
        "/api/v1/readonly/search",
        headers=AUTH,
        json={"query": "삼성전자 현재가", "limit": 3},
    )
    assert search.status_code == 200
    hits = search.json()["results"]
    assert 0 < len(hits) <= 3
    assert {hit["kind"] for hit in hits} == {"query"}

    described = client.post(
        "/api/v1/readonly/describe",
        headers=AUTH,
        json={"operation_ref": hits[0]["operation_ref"]},
    )
    assert described.status_code == 200
    assert described.json()["kind"] == "query"
    assert described.json()["operation_ref"] == hits[0]["operation_ref"]

    order_ref = next(
        document.operation_ref
        for document in client.app.state.operation_catalog.documents
        if document.kind == "order"
    )
    assert (
        client.post(
            "/api/v1/readonly/describe",
            headers=AUTH,
            json={"operation_ref": order_ref},
        ).status_code
        == 404
    )


@pytest.mark.parametrize("query", ["매수 주문", "실시간 체결"])
def test_search_never_surfaces_forbidden_intent_hints(query: str) -> None:
    response = _app().post(
        "/api/v1/readonly/search",
        headers=AUTH,
        json={"query": query, "limit": 5},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["suggested_intent"] is None
    assert all(hit["kind"] == "query" for hit in body["results"])


@pytest.mark.parametrize(
    "payload",
    [
        {"query": " "},
        {"query": "x" * 501},
        {"query": "현재가", "limit": 0},
        {"query": "현재가", "limit": 11},
        {"query": "현재가", "intent": "order"},
        {"query": "현재가", "path": "/api/v1/orders"},
        {"query": "현재가", "headers": {"x": "y"}},
    ],
)
def test_search_rejects_unbounded_or_transport_shaping_input(payload: dict[str, object]) -> None:
    assert _app().post("/api/v1/readonly/search", headers=AUTH, json=payload).status_code == 422


@pytest.mark.parametrize(
    "operation_ref",
    ["", "ka10001", "base:../orders", "BASE:KA10001", "base:ka10001?path=/orders"],
)
def test_describe_rejects_invalid_operation_identity(operation_ref: str) -> None:
    assert (
        _app()
        .post(
            "/api/v1/readonly/describe",
            headers=AUTH,
            json={"operation_ref": operation_ref},
        )
        .status_code
        == 422
    )


def test_dotenv_and_feature_environment_cannot_expand_routes(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    (tmp_path / ".env").write_text(
        "ATHENA_LOCAL_BEARER_TOKEN=dotenv-token\n"
        "ATHENA_ENABLE_ORDER_API=true\n"
        "ATHENA_BRAIN_ENABLED=true\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("ATHENA_LOCAL_BEARER_TOKEN", TOKEN)
    monkeypatch.setenv("ATHENA_ENABLE_ORDER_API", "true")
    monkeypatch.setenv("ATHENA_BRAIN_ENABLED", "true")
    monkeypatch.setenv("ATHENA_ROUTINES_ENABLED", "true")
    monkeypatch.setenv("ATHENA_BACKTEST_ENABLED", "true")
    monkeypatch.setenv("ATHENA_KIWOOM_ACCOUNTS", "not-json")
    monkeypatch.setenv("ATHENA_KIWOOM_BASE_URL", "https://example.invalid")
    monkeypatch.setenv("ATHENA_INSTRUMENT_DB_PATH", str(tmp_path / "must-not-exist.sqlite3"))
    monkeypatch.setenv("ATHENA_PROJECTS_ROOT", str(tmp_path / "must-not-exist"))
    client = TestClient(create_readonly_app())
    assert _route_inventory(client) == ALLOWED_ROUTES
    assert client.get("/health", headers=AUTH).status_code == 200
    assert sorted(path.name for path in tmp_path.iterdir()) == [".env"]


def _request_json(
    method: str,
    url: str,
    token: str,
    body: dict[str, object] | None = None,
) -> tuple[int, dict[str, object]]:
    encoded = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=encoded,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


def test_real_readonly_subprocess_smoke_and_owned_shutdown(tmp_path: Path) -> None:
    token = secrets.token_urlsafe(32)
    stdout_path = tmp_path / "stdout.log"
    stderr_path = tmp_path / "stderr.log"
    environment = {key: value for key, value in os.environ.items() if not key.startswith("ATHENA_")}
    environment["ATHENA_LOCAL_BEARER_TOKEN"] = token
    process: subprocess.Popen[bytes] | None = None
    endpoint = ""
    try:
        with stdout_path.open("wb") as stdout, stderr_path.open("wb") as stderr:
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "athena_api.launcher",
                    "--profile",
                    "wts-readonly",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    "0",
                ],
                cwd=Path(__file__).resolve().parents[1],
                env=environment,
                stdin=subprocess.DEVNULL,
                stdout=stdout,
                stderr=stderr,
            )
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline and process.poll() is None:
                lines = stdout_path.read_text(encoding="utf-8", errors="replace").splitlines()
                announced = [line for line in lines if line.startswith("ATHENA_BACKEND_URL=")]
                if announced:
                    endpoint = announced[-1].split("=", 1)[1]
                    break
                time.sleep(0.05)
            assert endpoint.startswith("http://127.0.0.1:")

            deadline = time.monotonic() + 15
            while True:
                try:
                    status_code, _ = _request_json("GET", endpoint + "/health", token)
                    if status_code == 200:
                        break
                except (OSError, TimeoutError):
                    pass
                assert time.monotonic() < deadline
                time.sleep(0.05)

            manifest_status, manifest = _request_json(
                "GET", endpoint + "/api/v1/readonly/manifest", token
            )
            assert manifest_status == 200
            assert len(manifest["operations"]) > 100

            search_status, search = _request_json(
                "POST",
                endpoint + "/api/v1/readonly/search",
                token,
                {"query": "삼성전자 현재가", "limit": 2},
            )
            assert search_status == 200
            hits = search["results"]
            assert len(hits) > 0
            describe_status, described = _request_json(
                "POST",
                endpoint + "/api/v1/readonly/describe",
                token,
                {"operation_ref": hits[0]["operation_ref"]},
            )
            assert describe_status == 200
            assert described["kind"] == "query"
            forbidden_status, _ = _request_json(
                "POST", endpoint + "/api/v1/selector/call", token, {}
            )
            assert forbidden_status == 404
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

    assert process is not None and process.poll() is not None
    parsed = urlparse(endpoint)
    deadline = time.monotonic() + 5
    while True:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.settimeout(1)
            released = probe.connect_ex((parsed.hostname or "127.0.0.1", parsed.port or 0)) != 0
        if released:
            break
        assert time.monotonic() < deadline
        time.sleep(0.05)
