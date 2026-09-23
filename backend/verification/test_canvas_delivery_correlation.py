import json

import httpx
import pytest
from pydantic import ValidationError

from athena_api.api.canvas_push import RenderPlanRequest, _display_receipt
from athena_mcp.canvas_data import render_with_plan


@pytest.mark.asyncio
async def test_mcp_generates_delivery_identity_and_returns_only_matching_control_receipt():
    requests = []

    def render(request):
        payload = json.loads(request.content)
        requests.append(payload)
        parsed = RenderPlanRequest.model_validate(payload)
        receipt = _display_receipt(
            delivery="side_channel",
            canvas_kind="chart",
            screen_id="fixture-screen",
            meta={},
            delivery_id=parsed.delivery_id,
        )
        # An unrelated extra backend value must never enter the model receipt.
        receipt["data"] = {"fixture": "renderer only"}
        return httpx.Response(200, json={
            "queued": True, "delivery": "side_channel", "status": "queued",
            "canvas_type": "chart", "envelope": None, "receipt": receipt,
        })

    async with httpx.AsyncClient(
        base_url="http://fixture", transport=httpx.MockTransport(render)
    ) as client:
        results = [await render_with_plan(
            {"plan_token": "fixture-plan", "delivery_id": "model-must-not-choose"},
            client, call_timeout_seconds=1,
        ) for _ in range(2)]
    assert len(requests[0]["delivery_id"]) == 32
    assert requests[0]["delivery_id"] != requests[1]["delivery_id"]
    for payload, result in zip(requests, results, strict=True):
        assert not result.isError
        assert result.structuredContent["delivery_id"] == payload["delivery_id"]
        assert "data" not in result.structuredContent
        assert "plan_token" not in result.structuredContent


@pytest.mark.asyncio
async def test_mcp_rejects_receipt_for_another_delivery():
    def render(request):
        receipt = _display_receipt(
            delivery="side_channel", canvas_kind="table", screen_id="fixture-screen",
            meta={}, delivery_id="a" * 32,
        )
        return httpx.Response(200, json={
            "queued": True, "delivery": "side_channel", "status": "queued",
            "canvas_type": "table", "envelope": None, "receipt": receipt,
        })

    async with httpx.AsyncClient(
        base_url="http://fixture", transport=httpx.MockTransport(render)
    ) as client:
        result = await render_with_plan(
            {"plan_token": "fixture-plan"}, client, call_timeout_seconds=1,
        )
    assert result.isError


def test_uncorrelated_callers_remain_supported_and_arbitrary_delivery_keys_are_rejected():
    assert RenderPlanRequest(plan_token="fixture-plan").delivery_id is None
    assert "delivery_id" not in _display_receipt(
        delivery="side_channel", canvas_kind="table", screen_id="fixture-screen", meta={},
    )
    with pytest.raises(ValidationError):
        RenderPlanRequest(plan_token="fixture-plan", delivery_id="unbounded-model-input")
