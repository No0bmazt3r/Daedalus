"""Live change notifications — how every open view learns that something moved.

The UI used to fetch a model list once and keep it. Delete a model in the
Forge and the composer's picker still offered it until a page reload, because
nothing told the picker to look again. This is that telling.

## Notify, don't ship state

An event carries only a *topic* ("models changed"), never the new list. Each
view already knows how to fetch what it shows, and re-fetching keeps a single
source of truth: an event that carried data would be a second, parallel copy
of every list, with its own ways to be stale. The cost is one extra GET per
view per change, on a machine with one user.

| topic | published when |
|---|---|
| `models` | the set of models Ollama has changed — pulled, deleted, in the app or not |
| `embeddings` | the selected embedding model, or a verified vector width, changed |
| `endpoints` | a cloud endpoint was added, edited, tested or removed |

## Two sources, one topic

The app publishes `models` itself the moment a pull or delete finishes, so the
views it controls update at once. But `ollama rm` in a terminal never touches
this process, so a watcher also asks Ollama for its model list every few
seconds and publishes when the set differs from the last one it saw. It polls
only while at least one browser is listening: with nobody subscribed there is
nobody to tell, and a background loop hitting Ollama for no reader is waste.

## Threads

Most endpoints are plain `def`, so FastAPI runs them in a worker thread, while
each subscriber waits on an asyncio queue in the event loop. `publish` is
therefore thread-safe and hands each event to the subscriber's own loop with
`call_soon_threadsafe` — a direct `put_nowait` from a worker thread is a race.
A subscriber whose queue is full is behind; the event is dropped for it, and
the client resynchronises on its next reconnect, which re-fetches everything.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import threading
from typing import Any

from . import ollama_client

log = logging.getLogger("daedalus.events")

TOPICS = ("models", "embeddings", "endpoints")

# How often the watcher asks Ollama, while somebody is listening. Five seconds
# is quick enough that a terminal `ollama rm` shows up before anyone goes
# looking, and `/api/tags` is a local, cheap read.
WATCH_INTERVAL_S = 5.0

_QUEUE_SIZE = 64

_lock = threading.Lock()
_subscribers: set[tuple[asyncio.AbstractEventLoop, asyncio.Queue[dict[str, Any]]]] = set()


def subscriber_count() -> int:
    with _lock:
        return len(_subscribers)


def subscribe() -> tuple[asyncio.AbstractEventLoop, asyncio.Queue[dict[str, Any]]]:
    """Register the calling coroutine's loop and a fresh queue."""
    entry = (asyncio.get_running_loop(), asyncio.Queue(maxsize=_QUEUE_SIZE))
    with _lock:
        _subscribers.add(entry)
    return entry


def unsubscribe(entry: tuple[asyncio.AbstractEventLoop, asyncio.Queue[dict[str, Any]]]) -> None:
    with _lock:
        _subscribers.discard(entry)


def _offer(queue: asyncio.Queue[dict[str, Any]], event: dict[str, Any]) -> None:
    with contextlib.suppress(asyncio.QueueFull):
        queue.put_nowait(event)


def publish(topic: str, **detail: Any) -> None:
    """Tell every listener that `topic` changed. Safe from any thread; never raises.

    A notification is a courtesy on top of an action that already succeeded, so
    a failure here must not turn that success into an error.
    """
    if topic not in TOPICS:
        log.warning("ignoring publish to unknown topic %r", topic)
        return
    event = {"topic": topic, **detail}
    with _lock:
        targets = list(_subscribers)
    for loop, queue in targets:
        with contextlib.suppress(RuntimeError):  # that loop has already closed
            loop.call_soon_threadsafe(_offer, queue, event)


def format_sse(event: dict[str, Any]) -> str:
    return f"event: {event['topic']}\ndata: {json.dumps(event)}\n\n"


def _model_signature() -> frozenset[tuple[str, str]] | None:
    """What Ollama has, as (name, digest) pairs. None when it cannot be asked.

    The digest, not just the name, so a re-pull that replaced the weights under
    the same tag counts as a change.
    """
    try:
        models = ollama_client.list_models()
    except Exception:  # noqa: BLE001 — offline Ollama is a normal state here
        return None
    return frozenset((str(m.get("name")), str(m.get("digest"))) for m in models)


async def watch_ollama() -> None:
    """Publish `models` when Ollama's model set changes, however it changed.

    `None` (unreachable) is a state of its own: Ollama stopping or coming back
    changes what every model list can show, so that is published too.
    """
    last: frozenset[tuple[str, str]] | None = None
    primed = False  # whether `last` is a real observation yet
    while True:
        await asyncio.sleep(WATCH_INTERVAL_S)
        if not subscriber_count():
            # Forget the baseline, so the first poll after somebody connects
            # sets a new one rather than reporting everything since as a change.
            primed = False
            continue
        current = await asyncio.to_thread(_model_signature)
        if primed and current != last:
            publish("models", source="ollama")
        last, primed = current, True
