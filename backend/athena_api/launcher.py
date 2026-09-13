"""Start Athena on an OS-assigned loopback port and announce its endpoint."""

from __future__ import annotations

import argparse
import socket

import uvicorn

ANNOUNCE_PREFIX = "ATHENA_BACKEND_URL="


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0)
    return parser.parse_args()


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
    listener = create_listener(args.host, args.port)
    try:
        selected_port = listener.getsockname()[1]
        print(f"{ANNOUNCE_PREFIX}http://{args.host}:{selected_port}", flush=True)

        config = uvicorn.Config(
            "athena_api.main:app",
            host=args.host,
            port=selected_port,
            workers=1,
        )
        uvicorn.Server(config).run(sockets=[listener])
    finally:
        listener.close()


if __name__ == "__main__":
    main()
