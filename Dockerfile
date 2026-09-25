# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — build the React dashboard
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24-slim AS frontend

WORKDIR /build

# Enable pnpm via corepack (the repo ships a pnpm-lock.yaml).
RUN corepack enable

# Dependency manifests first, so a source-only change doesn't reinstall.
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Everything the Vite build touches.
COPY frontend/tsconfig*.json frontend/vite.config.ts ./
COPY frontend/index.html frontend/components.json ./
COPY frontend/src ./src
COPY frontend/public ./public

# Produces /build/dist — the static bundle FastAPI will serve.
RUN pnpm build


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — runtime: FastAPI serves the API *and* the built dashboard
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

# Unbuffered output so container logs appear immediately; no .pyc clutter.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    DAEDALUS_STATIC_DIR=/app/static

WORKDIR /app

# curl is here for the healthcheck only.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY backend/app ./app
COPY --from=frontend /build/dist ./static

# Writable state lives on mounted volumes, so the image itself stays immutable.
RUN mkdir -p /app/data /data /logs \
    && useradd --create-home --uid 1000 daedalus \
    && chown -R daedalus:daedalus /app /data /logs
USER daedalus

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:8000/api/health || exit 1

# `--timeout-graceful-shutdown`: the live-update stream (`GET /api/events`) is
# held open by every browser tab, and uvicorn otherwise waits for open
# connections before stopping — so a stop would hang until the tab closed.
# Clients reconnect on their own and resynchronise when they do.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--timeout-graceful-shutdown", "3"]


# ─────────────────────────────────────────────────────────────────────────────
# Stage 3 — development: the same runtime, with the source bind-mounted over it
# ─────────────────────────────────────────────────────────────────────────────
#
# Built `FROM runtime` on purpose. A dev image assembled separately drifts from
# the one that ships — a different Python patch version, a dependency installed
# in one and not the other — and the whole reason to develop in a container is
# that "works on my machine" and "works in the image" stop being two questions.
#
# The `COPY backend/app` from the runtime stage is still in this image and is
# still shadowed by the bind mount in docker-compose.dev.yml. That is deliberate
# too: the image runs on its own without a mount, so a broken compose override
# fails loudly rather than starting an empty container.
#
# `uvicorn --reload` needs watchfiles, which arrives with `uvicorn[standard]`.
# NOTE: this is the last stage in the file, which makes it the *default* build
# target. docker-compose.yml names `target: runtime` explicitly so that the
# shipping image is never this one by accident.
FROM runtime AS dev

# Vite serves the UI in this mode, so FastAPI must not also serve a stale bundle
# built into the image — it would be served at the same path and win.
ENV DAEDALUS_STATIC_DIR=/app/static-disabled

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--reload", "--reload-dir", "/app/app", "--timeout-graceful-shutdown", "3"]
