"""Daedalus FastAPI backend.

Right now it serves the presentation layer's preference store; the chat and
tool routers from Layer 7 mount alongside it as they land.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api import health, prefs, system
from .db import audit_store, paths, prefs_store


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Every store Daedalus owns is created up front, so a fresh deployment has
    # its schema in place before the first request rather than on first write.
    paths.ensure_dirs()
    prefs_store.init_db()
    audit_store.init_db()
    yield


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
    allow_methods=["GET", "PUT", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)

app.include_router(health.router)
app.include_router(prefs.router)
app.include_router(system.router)


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
        candidate = (_static_dir / full_path).resolve()
        # Guard against ../ escaping the static root.
        if (
            full_path
            and _static_dir.resolve() in candidate.parents
            and candidate.is_file()
        ):
            return FileResponse(candidate)
        return FileResponse(_index)
