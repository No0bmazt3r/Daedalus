"""`GET /api/events` — one server-sent event stream per open browser tab.

See `services/live_events.py` for what is published and why an event names a
topic rather than carrying data.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from ..services import live_events

router = APIRouter(prefix="/api/events", tags=["events"])

# A comment line every so often. Proxies and some browsers close a stream that
# has been silent for a minute or two, and a dead connection is only noticed
# when a write to it fails — this is that write.
_HEARTBEAT_S = 20.0


@router.get("")
async def stream(request: Request) -> StreamingResponse:
    async def events() -> AsyncIterator[str]:
        entry = live_events.subscribe()
        _, queue = entry
        try:
            # Tells the client the stream is live. It re-fetches on this, which
            # is also what makes a reconnect catch up on anything it missed
            # while disconnected.
            yield "event: ready\ndata: {}\n\n"
            while not await request.is_disconnected():
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=_HEARTBEAT_S)
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
                    continue
                yield live_events.format_sse(event)
        finally:
            live_events.unsubscribe(entry)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
