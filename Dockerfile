# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — build the React dashboard
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24-slim AS frontend

WORKDIR /build

# Enable pnpm via corepack (the repo ships a pnpm-lock.yaml).
RUN corepack enable

# Dependency manifests first, so a source-only change doesn't reinstall.
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Everything the Vite build touches.
COPY tsconfig*.json vite.config.ts index.html components.json ./
COPY src ./src
COPY public ./public

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

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
