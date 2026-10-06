"""Condition command ACKs must not masquerade as transport failures or frames."""

import json

import pytest

from athena_mcp.canvas_data import websocket_lifecycle_receipt
from athena_mcp.result import success


@pytest.mark.parametrize(("operation", "command", "state"), [
    ("base:ka10171", "CNSRLST", "completed"),
    ("base:ka10172", "CNSRREQ", "completed"),
    ("base:ka10173", "CNSRREQ", "started"),
    ("base:ka10174", "CNSRCLR", "stopped"),
])
def test_condition_commands_have_value_free_receipts(operation, command, state):
    result = websocket_lifecycle_receipt(success({
        "operation_ref": operation,
        "data": {
            "return_code": "0", "trnm": command,
            "data": [{"seq": "7", "name": "synthetic condition", "price": 1234}],
            "return_msg": "synthetic upstream message",
        },
    }))
    assert not result.isError
    assert result.structuredContent["lifecycle"] == state
    assert set(result.structuredContent) == {"lifecycle", "receipt"}
    assert json.loads(result.content[0].text) == result.structuredContent
    assert "synthetic" not in result.content[0].text
    if state == "completed":
        assert "수신을 시작" not in result.content[0].text
        assert "캔버스" not in result.content[0].text


@pytest.mark.parametrize("return_code", [None, "-1", "1234"])
def test_failed_condition_command_remains_error(return_code):
    result = websocket_lifecycle_receipt(success({
        "operation_ref": "base:ka10171",
        "data": {"return_code": return_code, "trnm": "CNSRLST"},
    }))
    assert result.isError
    assert result.structuredContent["lifecycle"] == "error"


def test_unknown_or_mismatched_command_is_not_reported_as_success():
    for operation, command in [
        ("base:ka10171", "CNSRREQ"), ("base:ka10172", "CNSRLST"),
        ("base:ka10171", "UNKNOWN"),
    ]:
        result = websocket_lifecycle_receipt(success({
            "operation_ref": operation,
            "data": {"return_code": "0", "trnm": command},
        }))
        assert result.isError


@pytest.mark.parametrize(("command", "state"), [("REG", "started"), ("REMOVE", "stopped")])
def test_market_feed_lifecycle_is_unchanged(command, state):
    result = websocket_lifecycle_receipt(success({
        "operation_ref": "base:0B",
        "data": {"return_code": "0", "trnm": command},
    }))
    assert not result.isError
    assert result.structuredContent["lifecycle"] == state


def test_transport_errors_are_preserved():
    from athena_mcp.canvas_data import _error
    result = _error("synthetic transport failure")
    assert websocket_lifecycle_receipt(result) is result
