import asyncio
import json
import threading
from collections.abc import Awaitable, Callable

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from athena_api.config import Settings
from athena_api.dependencies import require_kiwoom_ws_client
from athena_api.kiwoom import KiwoomWsClient, RateLimiter
from athena_api.main import create_app


class FakeSocket:
    def __init__(self) -> None:
        self.incoming: asyncio.Queue[str | BaseException] = asyncio.Queue()
        self.sent: list[str] = []
        self.closed = False

    async def send(self, data: str) -> None:
        self.sent.append(data)

    async def recv(self) -> str:
        value = await self.incoming.get()
        if isinstance(value, BaseException):
            raise value
        return value

    async def close(self) -> None:
        self.closed = True

    def push(self, message: dict[str, object]) -> None:
        self.incoming.put_nowait(json.dumps(message))


async def until(check: Callable[[], bool]) -> None:
    for _ in range(100):
        if check():
            return
        await asyncio.sleep(0)
    raise AssertionError("condition not reached")


def client_for(
    connect: Callable[[str], Awaitable[FakeSocket]],
    **kwargs: object,
) -> KiwoomWsClient:
    return KiwoomWsClient(
        lambda: "memory-token",
        RateLimiter(1000, per_api_rate=None),
        connect=connect,
        **kwargs,
    )


async def start_client(client: KiwoomWsClient, socket: FakeSocket) -> None:
    task = asyncio.create_task(client.start())
    await until(lambda: bool(socket.sent))
    socket.push({"trnm": "LOGIN", "return_code": 0})
    await task


@pytest.mark.asyncio
async def test_subscriber_gets_current_status_then_reconnect_and_restored_ready() -> None:
    first = FakeSocket()
    second = FakeSocket()
    sockets = iter((first, second))

    async def connect(_url: str) -> FakeSocket:
        return next(sockets)

    client = client_for(connect, reconnect_base_seconds=0.001)
    await start_client(client, first)
    queue = client.subscribe_events()
    try:
        assert queue.get_nowait() == {
            "type": "feed-status",
            "feed": "kiwoom-real",
            "state": "ready",
            "upstreamGeneration": 1,
            "revision": 1,
        }

        registration = asyncio.create_task(client.register("0B", ["005930"]))
        await until(lambda: len(first.sent) == 2)
        first.push({"trnm": "REG", "return_code": 0})
        await registration

        first.incoming.put_nowait(ConnectionError("upstream dropped"))
        reconnecting = await asyncio.wait_for(queue.get(), 1)
        assert reconnecting == {
            "type": "feed-status",
            "feed": "kiwoom-real",
            "state": "reconnecting",
            "upstreamGeneration": 1,
            "revision": 2,
            "reasonCode": "reader_failed",
        }

        await until(lambda: bool(second.sent))
        second.push({"trnm": "LOGIN", "return_code": 0})
        await until(lambda: len(second.sent) == 2)
        assert queue.empty()
        second.push({"trnm": "REG", "return_code": 0})
        ready = await asyncio.wait_for(queue.get(), 1)
        assert ready == {
            "type": "feed-status",
            "feed": "kiwoom-real",
            "state": "ready",
            "upstreamGeneration": 2,
            "revision": 3,
        }
    finally:
        client.unsubscribe_events(queue)
        await client.close()


@pytest.mark.asyncio
async def test_client_instances_keep_status_and_real_queues_isolated() -> None:
    async def unused_connect(_url: str) -> FakeSocket:
        raise AssertionError("network must not be used")

    first = client_for(unused_connect)
    second = client_for(unused_connect)
    first_queue = first.subscribe_events()
    second_queue = second.subscribe_events()
    try:
        first_queue.get_nowait()
        second_queue.get_nowait()
        first._publish_status("reconnecting", "reader_failed")  # noqa: SLF001
        first._publish({"trnm": "REAL", "data": [{"item": "005930"}]})  # noqa: SLF001

        assert (await first_queue.get())["state"] == "reconnecting"
        assert (await first_queue.get())["trnm"] == "REAL"
        assert second_queue.empty()
    finally:
        first.unsubscribe_events(first_queue)
        second.unsubscribe_events(second_queue)
        await first.close()
        await second.close()


@pytest.mark.asyncio
async def test_pending_status_is_not_evicted_by_real_event_backpressure() -> None:
    async def unused_connect(_url: str) -> FakeSocket:
        raise AssertionError("network must not be used")

    client = client_for(unused_connect, subscriber_queue_size=1)
    queue = client.subscribe_events()
    try:
        assert queue.get_nowait()["state"] == "unavailable"
        client._publish_status("reconnecting", "reader_failed")  # noqa: SLF001
        client._publish({"trnm": "REAL", "data": [{"item": "005930"}]})  # noqa: SLF001
        event = queue.get_nowait()
        assert event["type"] == "feed-status"
        assert event["state"] == "reconnecting"
    finally:
        client.unsubscribe_events(queue)
        await client.close()


@pytest.mark.asyncio
async def test_real_backpressure_keeps_status_and_latest_real_event() -> None:
    async def unused_connect(_url: str) -> FakeSocket:
        raise AssertionError("network must not be used")

    client = client_for(unused_connect, subscriber_queue_size=2)
    queue = client.subscribe_events()
    try:
        client._publish({"trnm": "REAL", "data": [{"item": "old"}]})  # noqa: SLF001
        client._publish({"trnm": "REAL", "data": [{"item": "latest"}]})  # noqa: SLF001

        assert queue.get_nowait()["type"] == "feed-status"
        assert queue.get_nowait()["data"] == [{"item": "latest"}]
    finally:
        client.unsubscribe_events(queue)
        await client.close()


def test_downstream_ready_is_sent_only_after_auth_and_before_upstream_status() -> None:
    class FakeStreamClient:
        def __init__(self) -> None:
            self.queues: list[asyncio.Queue[dict[str, object]]] = []
            self.unsubscribed = threading.Event()

        def subscribe_events(self) -> asyncio.Queue[dict[str, object]]:
            queue: asyncio.Queue[dict[str, object]] = asyncio.Queue()
            queue.put_nowait(
                {
                    "type": "feed-status",
                    "feed": "kiwoom-real",
                    "state": "reconnecting",
                    "upstreamGeneration": 4,
                    "revision": 9,
                    "reasonCode": "reader_failed",
                }
            )
            self.queues.append(queue)
            return queue

        def unsubscribe_events(self, queue: asyncio.Queue[dict[str, object]]) -> None:
            self.queues.remove(queue)
            self.unsubscribed.set()

    upstream = FakeStreamClient()
    app = create_app(Settings(local_bearer_token="stream-secret", _env_file=None))
    app.dependency_overrides[require_kiwoom_ws_client] = lambda: upstream

    with TestClient(app) as client:
        with client.websocket_connect("/api/v1/ws/stream") as stream:
            stream.send_json({"type": "auth", "token": "stream-secret"})
            assert stream.receive_json() == {"type": "feed-ready", "feed": "kiwoom-real"}
            assert stream.receive_json()["state"] == "reconnecting"
            stream.close()
            assert upstream.unsubscribed.wait(timeout=1)

        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/api/v1/ws/stream") as stream:
                stream.send_json({"type": "auth", "token": "wrong"})
                stream.receive_json()
        assert upstream.queues == []
