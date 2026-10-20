"""Start Athena on an OS-assigned loopback port and announce its endpoint."""

from __future__ import annotations

import argparse
import socket
from pathlib import Path

import uvicorn
from fastapi import FastAPI

ANNOUNCE_PREFIX = "ATHENA_BACKEND_URL="
DEFAULT_PROFILE = "default"
WTS_READONLY_PROFILE = "wts-readonly"
WTS_FINANCIAL_READ_PROFILE = "wts-financial-read"
PROFILE_CHOICES = (DEFAULT_PROFILE, WTS_READONLY_PROFILE, WTS_FINANCIAL_READ_PROFILE)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--profile", choices=PROFILE_CHOICES, default=DEFAULT_PROFILE)
    parser.add_argument("--data-dir", type=Path)
    return parser.parse_args()


def application_for_profile(profile: str, *, data_dir: Path | None = None) -> str | FastAPI:
    """Return one of the finite application targets supported by this launcher."""
    if profile == DEFAULT_PROFILE:
        return "athena_api.main:app"
    if profile == WTS_READONLY_PROFILE:
        # Keep the read-only app out of the default launch/import path.  Its factory
        # validates the per-process bearer before any socket is bound or announced.
        from athena_api.readonly_app import create_readonly_app

        return create_readonly_app()
    if profile == WTS_FINANCIAL_READ_PROFILE:
        if data_dir is None or not data_dir.is_absolute():
            raise ValueError("wts-financial-read requires an absolute --data-dir")
        from athena_api.financial_read_app import (
            FinancialReadSettings,
            create_financial_read_app,
        )

        return create_financial_read_app(
            FinancialReadSettings(_env_file=None, data_dir=data_dir)
        )
    raise ValueError(f"unsupported backend profile: {profile}")


def validate_profile_bind(profile: str, host: str) -> None:
    """Keep the WTS metadata child private to the local machine."""
    if profile in {WTS_READONLY_PROFILE, WTS_FINANCIAL_READ_PROFILE} and host != "127.0.0.1":
        raise ValueError(f"{profile} must bind to 127.0.0.1")


def create_listener(host: str, port: int) -> socket.socket:
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        listener.bind((host, port))
        listener.listen(2048)
        return listener
    except BaseException:
        listener.close()
        raise


def main() -> None:
    args = parse_args()
    validate_profile_bind(args.profile, args.host)
    application = application_for_profile(args.profile, data_dir=args.data_dir)
    listener = create_listener(args.host, args.port)
    try:
        selected_port = listener.getsockname()[1]
        print(f"{ANNOUNCE_PREFIX}http://{args.host}:{selected_port}", flush=True)

        config_options = {}
        if args.profile == WTS_FINANCIAL_READ_PROFILE:
            config_options = {
                "access_log": False,
                "log_level": "warning",
                "use_colors": False,
            }
        config = uvicorn.Config(
            application,
            host=args.host,
            port=selected_port,
            workers=1,
            **config_options,
        )
        uvicorn.Server(config).run(sockets=[listener])
    finally:
        listener.close()


if __name__ == "__main__":
    main()
