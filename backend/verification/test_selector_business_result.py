import httpx
import pytest
from fastapi import FastAPI, Request, Response

from athena_api.errors import KiwoomApiError, install_exception_handlers
from athena_api.kiwoom import ResponseEnvelope
from athena_api.selector.catalog import build_operation_catalog
from athena_api.selector.errors import PlanAlreadyUsedError
from athena_api.selector.plans import PlanSigner
from athena_api.selector.schemas import CallRequest
from athena_api.selector.service import SelectorService


def fixture(body):
    catalog = build_operation_catalog()
    document = catalog.find_exact("base:ka10054")
    signer = PlanSigner(b"synthetic-public-business-result-test-key")
    selector = SelectorService(catalog, signer)
    token, _ = signer.issue(
        catalog=catalog,
        document=document,
        arguments={name: "0" for name in document.request_model.model_fields},
        question="VI 발동 종목",
    )

    class Client:
        calls = 0

        async def post_with_headers(self, tr_id, upstream_path, arguments, options):
            self.calls += 1
            assert tr_id == "ka10054"
            return ResponseEnvelope(body=body, cont_yn="N", next_key=None)

    return selector, CallRequest(plan_token=token), Client()


@pytest.mark.asyncio
async def test_vi_business_failure_keeps_error_code_and_consumes_plan_once():
    selector, call, client = fixture({
        "return_code": 1234,
        "return_msg": "synthetic upstream detail must not be exposed",
    })
    request = Request({"type": "http", "headers": []})
    with pytest.raises(KiwoomApiError) as failed:
        await selector.call(call, request, Response(), client)
    assert failed.value.code == "1234"
    assert "synthetic upstream detail" not in str(failed.value)
    with pytest.raises(PlanAlreadyUsedError):
        await selector.call(call, request, Response(), client)
    assert client.calls == 1


@pytest.mark.asyncio
async def test_business_failure_http_boundary_is_error_not_500_or_empty_success():
    selector, call, client = fixture({"return_code": 1234, "return_msg": "synthetic"})
    app = FastAPI()
    install_exception_handlers(app)

    @app.get("/synthetic-query")
    async def query(request: Request, response: Response):
        return await selector.call(call, request, response, client)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://synthetic"
    ) as test_client:
        result = await test_client.get("/synthetic-query")
    assert result.status_code == 502
    assert result.json() == {"detail": "Kiwoom upstream request failed", "code": "1234"}


@pytest.mark.asyncio
async def test_successful_vi_response_still_uses_typed_model():
    selector, call, client = fixture({"return_code": 0, "return_msg": "synthetic success"})
    result = await selector.call(call, Request({"type": "http", "headers": []}), Response(), client)
    assert result.operation_ref == "base:ka10054"
    assert result.data["return_code"] == 0
    assert result.continuation.cont_yn == "N"
    assert client.calls == 1
