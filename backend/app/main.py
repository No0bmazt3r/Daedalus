"""Daedalus FastAPI backend.

Serves the presentation layer's preference store and chat session state; the
answering endpoint and tool routers from Layer 7 mount alongside them as they
land.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api import chat, forge, graph, health, logs, prefs, providers, sessions, system
from .db import migrations, paths, sqlite_util
# Aliased: `api.forge` is already imported above under that name, and the two
# shadowing each other broke router registration at import time.
from .services import forge as forge_service
from .services import chat_service, hardware

log = logging.getLogger("daedalus.startup")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Bring every store to a known-good state before serving a request.

    Migrating on boot means a fresh deployment and an upgraded one reach the
    same schema without anyone remembering to run a command. `migrate` is a
    no-op when nothing is pending, so the cost is two queries per store.

    A migration failure is deliberately fatal. Serving requests against a
    database whose shape the code does not agree with produces corrupt data
    that is discovered much later — refusing to start is the cheaper failure.
    """
    paths.ensure_dirs()

    for store, applied in migrations.migrate_all().items():
        for migration in applied:
            log.info("migrated %s → %s", store, migration.label)

    # Corruption is rare but silent; quick_check is cheap enough to pay for on
    # every boot rather than discover mid-evaluation.
    for store, path in migrations.STORES.items():
        problem = sqlite_util.integrity_check(path)
        if problem:
            log.error("integrity check failed for %s (%s): %s", store, path, problem)

    # A restart ends an incognito session by definition. Sweeping at boot also
    # clears whatever a crash left behind.
    swept = chat_service.purge_ephemeral()
    if swept:
        log.info("swept %d ephemeral session(s) left by a previous run", swept)

    # Hardware detection is slow (a subprocess, an HTTP timeout, and under WSL a
    # ~2.5s PowerShell interop call) and was being paid inside the request every
    # time somebody opened the Forge. It now runs here instead: one warm-up pass
    # off the request path, then a refresh only while somebody is actually
    # watching the panel. Started, not awaited — a machine that is slow to probe
    # must not be slow to boot, and the endpoint serves whatever it has.
    hardware_task = asyncio.create_task(hardware.background_refresh())

    # The Forge's model table needs one registry manifest per catalogue tag —
    # fifty round trips, ~11s, and the answers are immutable per tag. Fetched
    # once here so the first panel open is instant instead of paying for it.
    # A thread, not the event loop: these are blocking HTTP reads.
    registry_task = asyncio.create_task(asyncio.to_thread(forge_service.warm_registry))

    try:
        yield
    finally:
        # Ordinary shutdown. Without this the task is garbage-collected
        # mid-sleep and asyncio complains about it on the way out.
        for task in (hardware_task, registry_task):
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

        chat_service.purge_ephemeral()


app = FastAPI(
    title="Daedalus Backend",
    version="0.1.0",
    description="Local orchestration + preference API for the Daedalus UI.",
    lifespan=lifespan,
)

# The Vite dev server proxies /api, so same-origin covers normal development.
# These origins keep a directly-pointed frontend working too.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_credentials=True,
    allow_methods=["GET", "PUT", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)

app.include_router(health.router)
app.include_router(prefs.router)
app.include_router(sessions.router)
app.include_router(logs.router)
app.include_router(providers.router)
app.include_router(system.router)
app.include_router(forge.router)
app.include_router(graph.router)
app.include_router(chat.router)


# ── Serve the built dashboard ────────────────────────────────────────────────
# In the container the Vite bundle is copied to DAEDALUS_STATIC_DIR, and this
# one process serves both the API and the UI — same origin, one port, no CORS.
# In development the directory doesn't exist and this block is skipped, because
# the Vite dev server owns the UI and proxies /api back here.
_static_dir = Path(os.environ.get("DAEDALUS_STATIC_DIR", "static"))

if _static_dir.is_dir():
    # Hashed build assets: safe to cache hard.
    app.mount(
        "/assets",
        StaticFiles(directory=_static_dir / "assets"),
        name="assets",
    )

    _index = _static_dir / "index.html"

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str) -> FileResponse:
        """Serve real files when they exist, else hand back index.html.

        The router is client-side, so a deep link like /device/x/chat has no
        file behind it and must still boot the app. Declared after every API
        router so it can only ever catch what they didn't.
        """
        # …except under /api, where catching what the routers didn't is the
        # wrong answer. A stale image that predates an endpoint would serve
        # index.html with a 200, and the client would fail parsing HTML as
        # JSON instead of seeing an honest 404.
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail=f"no such endpoint: /{full_path}")

        candidate = (_static_dir / full_path).resolve()
        # Guard against ../ escaping the static root.
        if (
            full_path
            and _static_dir.resolve() in candidate.parents
            and candidate.is_file()
        ):
            return FileResponse(candidate)
        return FileResponse(_index)
