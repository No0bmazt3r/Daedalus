"""Daedalus FastAPI backend.

Right now it serves the presentation layer's preference store; the chat and
tool routers from Layer 7 mount alongside it as they land.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import health, prefs
from .db import prefs_store


@asynccontextmanager
async def lifespan(_app: FastAPI):
    prefs_store.init_db()
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
