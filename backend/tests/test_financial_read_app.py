from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from athena_api.financial_query_runtime import FinancialQueryError
from athena_api.financial_read_app import (
    API_VERSION,
    CARD_VERSION,
    MAX_REQUEST_BYTES,
    METHODS,
    PROFILE,
    RENDER_KINDS,
    FinancialReadSettings,
    create_financial_read_app,
)
from athena_api.selector.catalog import build_operation_catalog

TOKEN = "financial-test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


class FakeCredentialRuntime:
    def __init__(self) -> None:
        self.catalog = build_operation_catalog()
        self.calls = 0
        self.unavailable = False

    def attach_query_runtime(self, runtime) -> None:
        self.query_runtime = runtime

    def start_refresh(self) -> None:
        pass

    def assert_available(self) -> None:
        if self.unavailable:
            raise FinancialQueryError("VAULT_UNAVAILABLE")

    async def aclose(self) -> None:
        pass

    async def status(self, mutation_id=None):
        return {
            "profile": PROFILE,
            "apiVersion": API_VERSION,
            "catalogVersion": self.catalog.version,
            "profiles": [],
            "mutation": None,
        }

    async def configure(self, payload):
        self.calls += 1
        return {"mutation": payload}

    async def delete(self, payload):
        self.calls += 1
        return {"mutation": payload}


class FakeQueryRuntime:
    def __init__(self) -> None:
        self.calls = 0

    async def aclose(self) -> None:
        pass

    async def start(self, **kwargs):
        self.calls += 1
        return {}

    async def status(self, *args):
        self.calls += 1
        return {}

    async def page(self, *args):
        self.calls += 1
        return {}

    async def continue_query(self, **kwargs):
        self.calls += 1
        return {}

    async def cancel(self, **kwargs):
        self.calls += 1
        return {}


def _client() -> TestClient:
    return TestClient(
        create_financial_read_app(
            FinancialReadSettings(
                _env_file=None,
                local_bearer_token=TOKEN,
                data_dir=Path("C:/synthetic-financial-test"),
            ),
            query_runtime=FakeQueryRuntime(),
            credential_runtime=FakeCredentialRuntime(),
        )
    )


def test_capability_and_route_inventory_is_finite_and_authenticated() -> None:
    with _client() as client:
        inventory = {
            (method, route.path)
            for route in client.app.routes
            for method in getattr(route, "methods", set())
        }
        assert inventory == {
            ("GET", "/health"),
            ("GET", "/api/v1/financial/capabilities"),
            ("POST", "/api/v1/financial/credentials/status"),
            ("POST", "/api/v1/financial/credentials/configure"),
            ("POST", "/api/v1/financial/credentials/delete"),
            ("POST", "/api/v1/financial/query/start"),
            ("POST", "/api/v1/financial/query/status"),
            ("POST", "/api/v1/financial/query/page"),
            ("POST", "/api/v1/financial/query/continue"),
            ("POST", "/api/v1/financial/query/cancel"),
        }
        assert client.get("/health").json() == {
            "error": {"code": "LOCAL_AUTH_FAILED", "message": "Local authorization failed."}
        }
        capability = client.get("/api/v1/financial/capabilities", headers=AUTH).json()
        assert capability == {
            "profile": PROFILE,
            "apiVersion": API_VERSION,
            "cardVersion": CARD_VERSION,
            "catalogVersion": client.app.state.catalog.version,
            "methods": list(METHODS),
            "renderKinds": list(RENDER_KINDS),
            "queryOnly": True,
            "credentialSetup": True,
            "order": False,
            "websocket": False,
            "externalAi": False,
        }


def test_financial_app_import_does_not_load_full_lifespan_or_execution_surfaces() -> None:
    completed = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import sys; import athena_api.financial_read_app; "
                "forbidden=('athena_api.main','athena_api.lifespan','athena_api.orders',"
                "'athena_api.routines','athena_api.brain'); "
                "assert not [name for name in forbidden if name in sys.modules]"
            ),
        ],
        cwd=Path(__file__).resolve().parents[1],
        stdin=subprocess.DEVNULL,
        capture_output=True,
        timeout=20,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr.decode(errors="replace")


def test_validation_and_not_found_errors_never_expose_fastapi_detail() -> None:
    with _client() as client:
        invalid = client.post(
            "/api/v1/financial/query/status", headers=AUTH, json={"jobId": "bad"}
        )
        assert invalid.status_code == 422
        assert invalid.json() == {
            "error": {"code": "REQUEST_INVALID", "message": "Request is invalid."}
        }
        missing = client.get("/not-a-route", headers=AUTH)
        assert missing.status_code == 404
        assert missing.json() == {
            "error": {
                "code": "RESOURCE_NOT_FOUND",
                "message": "Requested local resource was not found.",
            }
        }


def test_status_returns_truthful_empty_unconfigured_profile_list() -> None:
    with _client() as client:
        response = client.post(
            "/api/v1/financial/credentials/status",
            headers=AUTH,
            json={"mutationId": None},
        )
        assert response.status_code == 200
        assert response.json()["profiles"] == []
        assert response.json()["mutation"] is None


def test_actual_request_body_limit_rejects_chunked_and_lying_content_length() -> None:
    oversized = b"x" * (MAX_REQUEST_BYTES + 1)
    with _client() as client:
        lying = client.post(
            "/api/v1/financial/credentials/status",
            headers={**AUTH, "Content-Length": "1", "Content-Type": "application/json"},
            content=oversized,
        )
        assert lying.status_code == 413
        assert lying.json() == {
            "error": {"code": "PAYLOAD_TOO_LARGE", "message": "Payload is too large."}
        }

        chunked = client.post(
            "/api/v1/financial/credentials/status",
            headers={**AUTH, "Transfer-Encoding": "chunked"},
            content=(part for part in (oversized[:100_000], oversized[100_000:])),
        )
        assert chunked.status_code == 413
        assert chunked.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


def test_fatal_vault_state_makes_health_unavailable_without_debug_details() -> None:
    credential_runtime = FakeCredentialRuntime()

    def unavailable() -> None:
        raise FinancialQueryError("VAULT_UNAVAILABLE")

    credential_runtime.assert_available = unavailable
    app = create_financial_read_app(
        FinancialReadSettings(
            _env_file=None,
            local_bearer_token=TOKEN,
            data_dir=Path("C:/synthetic-financial-test"),
        ),
        query_runtime=FakeQueryRuntime(),
        credential_runtime=credential_runtime,
    )
    with TestClient(app) as client:
        response = client.get("/health", headers=AUTH)
    assert response.status_code == 503
    assert response.json() == {
        "error": {
            "code": "VAULT_UNAVAILABLE",
            "message": "Credential vault is unavailable.",
        }
    }


def test_fatal_vault_state_blocks_every_financial_operation_before_dispatch() -> None:
    credential_runtime = FakeCredentialRuntime()
    credential_runtime.unavailable = True
    query_runtime = FakeQueryRuntime()
    app = create_financial_read_app(
        FinancialReadSettings(
            _env_file=None,
            local_bearer_token=TOKEN,
            data_dir=Path("C:/synthetic-financial-test"),
        ),
        query_runtime=query_runtime,
        credential_runtime=credential_runtime,
    )
    profile_id = str(uuid4())
    job_id = str(uuid4())
    mutation_id = str(uuid4())
    submission_id = str(uuid4())
    requests = [
        (
            "/api/v1/financial/credentials/configure",
            {
                "mutationId": mutation_id,
                "profileId": profile_id,
                "expectedRevision": None,
                "label": "test",
                "environment": "mock",
                "appKey": "app",
                "secretKey": "secret",
            },
        ),
        (
            "/api/v1/financial/credentials/delete",
            {"mutationId": mutation_id, "profileId": profile_id, "expectedRevision": 1},
        ),
        (
            "/api/v1/financial/query/start",
            {
                "submissionId": submission_id,
                "profileId": profile_id,
                "operationRef": "base:ka00001",
                "arguments": {},
            },
        ),
        ("/api/v1/financial/query/status", {"jobId": job_id}),
        (
            "/api/v1/financial/query/page",
            {"jobId": job_id, "pageToken": "A" * 43},
        ),
        (
            "/api/v1/financial/query/continue",
            {
                "submissionId": submission_id,
                "parentJobId": job_id,
                "continuationToken": "A" * 43,
            },
        ),
        (
            "/api/v1/financial/query/cancel",
            {"jobId": job_id, "cancellationId": str(uuid4())},
        ),
    ]
    with TestClient(app) as client:
        for path, body in requests:
            for _ in range(2):
                response = client.post(path, headers=AUTH, json=body)
                assert response.status_code == 503, path
                assert response.json()["error"]["code"] == "VAULT_UNAVAILABLE"
        assert client.get("/api/v1/financial/capabilities", headers=AUTH).status_code == 200
    assert credential_runtime.calls == 0
    assert query_runtime.calls == 0
