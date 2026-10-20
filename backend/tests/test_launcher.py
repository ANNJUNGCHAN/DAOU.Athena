from __future__ import annotations

import socket
from pathlib import Path
from types import SimpleNamespace

import pytest

from athena_api import launcher
from athena_api.launcher import (
    DEFAULT_PROFILE,
    PROFILE_CHOICES,
    WTS_FINANCIAL_READ_PROFILE,
    WTS_READONLY_PROFILE,
    application_for_profile,
    create_listener,
    validate_profile_bind,
)


def test_create_listener_keeps_os_assigned_port_exclusively_bound() -> None:
    listener = create_listener("127.0.0.1", 0)
    try:
        host, port = listener.getsockname()
        assert host == "127.0.0.1"
        assert port > 0

        contender = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            with pytest.raises(OSError):
                contender.bind((host, port))
        finally:
            contender.close()
    finally:
        listener.close()


def test_default_profile_preserves_the_existing_application_target() -> None:
    assert application_for_profile(DEFAULT_PROFILE) == "athena_api.main:app"
    assert PROFILE_CHOICES == (
        DEFAULT_PROFILE,
        WTS_READONLY_PROFILE,
        WTS_FINANCIAL_READ_PROFILE,
    )


def test_launcher_refuses_an_unregistered_profile() -> None:
    with pytest.raises(ValueError, match="unsupported backend profile"):
        application_for_profile("arbitrary.module:app")


def test_readonly_profile_refuses_non_loopback_bind_without_changing_default() -> None:
    validate_profile_bind(DEFAULT_PROFILE, "0.0.0.0")
    validate_profile_bind(WTS_READONLY_PROFILE, "127.0.0.1")
    with pytest.raises(ValueError, match="must bind to 127.0.0.1"):
        validate_profile_bind(WTS_READONLY_PROFILE, "0.0.0.0")
    validate_profile_bind(WTS_FINANCIAL_READ_PROFILE, "127.0.0.1")
    with pytest.raises(ValueError, match="must bind to 127.0.0.1"):
        validate_profile_bind(WTS_FINANCIAL_READ_PROFILE, "0.0.0.0")


def test_financial_profile_requires_an_absolute_data_dir_before_import() -> None:
    with pytest.raises(ValueError, match="absolute --data-dir"):
        application_for_profile(WTS_FINANCIAL_READ_PROFILE)
    with pytest.raises(ValueError, match="absolute --data-dir"):
        application_for_profile(WTS_FINANCIAL_READ_PROFILE, data_dir=Path("relative"))


def test_launcher_disables_access_logs_and_colored_trace_output(monkeypatch) -> None:
    captured: dict = {}

    class Listener:
        def getsockname(self):
            return ("127.0.0.1", 32123)

        def close(self):
            pass

    class Server:
        def __init__(self, config):
            captured["config"] = config

        def run(self, *, sockets):
            captured["sockets"] = sockets

    monkeypatch.setattr(
        launcher,
        "parse_args",
        lambda: SimpleNamespace(
            host="127.0.0.1",
            port=0,
            profile=WTS_FINANCIAL_READ_PROFILE,
            data_dir=Path("C:/financial-test"),
        ),
    )
    monkeypatch.setattr(launcher, "application_for_profile", lambda *args, **kwargs: "app")
    monkeypatch.setattr(launcher, "create_listener", lambda *_: Listener())
    monkeypatch.setattr(launcher.uvicorn, "Config", lambda app, **kwargs: kwargs)
    monkeypatch.setattr(launcher.uvicorn, "Server", Server)

    launcher.main()

    assert captured["config"]["access_log"] is False
    assert captured["config"]["log_level"] == "warning"
    assert captured["config"]["use_colors"] is False
