"""Join request-scoped tasks when the local HTTP caller disconnects."""
import asyncio


async def until_disconnect(request, operation, *, on_cancel=None):
    stopping = False
    async def disconnected():
        while not stopping:
            if await request.is_disconnected():
                return
            await asyncio.sleep(.05)

    work = asyncio.create_task(operation)
    monitor = asyncio.create_task(disconnected())
    try:
        done, _ = await asyncio.wait((work, monitor), return_when=asyncio.FIRST_COMPLETED)
        if monitor in done:
            await monitor
            raise asyncio.CancelledError()
        return await work
    finally:
        stopping = True
        if on_cancel is not None:
            on_cancel()
        work.cancel()
        monitor.cancel()
        await asyncio.gather(work, monitor, return_exceptions=True)
