"""Pulling a gated Hugging Face GGUF (meta-llama and friends) into Ollama.

`ollama pull hf.co/{repo}:{quant}` covers public repos, but Ollama does not
reliably send a token for a gated one (ollama#7240), so those pulls fail. The
manual route was `huggingface-cli download` then `ollama create`; this is that
route, run by the backend:

1. List the repo's files with `HF_TOKEN` and pick the GGUF for the quant.
2. Download it into `$DATA_DIR/models/.hf-download/`, hashing as it streams.
3. Push it to Ollama as a blob (`POST /api/blobs/sha256:…`).
4. `POST /api/create` with that blob under the same `hf.co/…` tag.
5. Delete the download — Ollama now holds its own copy.

Progress comes out in `ollama_client.pull`'s event shape, so the Forge's pull
bar works unchanged. The token is read from `.env` (`HF_TOKEN`), never stored
by Daedalus, and only ever sent to huggingface.co. You still have to accept the
model's licence on its Hugging Face page first; without that the listing is a
403, reported as such.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from collections.abc import Iterator
from typing import Any, Final

import httpx

from ..db import paths
from . import ollama_client
from .hf_discovery import parse_hf_tag

HF: Final = "https://huggingface.co"
_CHUNK: Final = 1 << 20
_SPLIT = re.compile(r"-\d{5}-of-\d{5}\.gguf$", re.IGNORECASE)


class GatedPullError(ollama_client.OllamaError):
    """Raised with a reason the pull bar can show."""


def token() -> str | None:
    return os.environ.get("HF_TOKEN", "").strip() or None


def pull_with_fallback(tag: str) -> Iterator[dict[str, Any]]:
    """Ollama's own pull; for an `hf.co/` tag that fails, the gated route when a token is set."""
    try:
        yield from ollama_client.pull(tag)
        return
    except ollama_client.OllamaError as exc:
        if not (parse_hf_tag(tag) and token()):
            raise
        yield {"status": f"Ollama could not pull it ({exc}); trying with HF_TOKEN",
               "digest": None, "total_bytes": None, "completed_bytes": None,
               "percent": None, "done": False}
    yield from pull(tag)


def pick_file(files: list[dict[str, Any]], quant: str | None) -> dict[str, Any]:
    """The single-file GGUF matching the quant (Q4_K_M when none was named)."""
    wanted = (quant or "Q4_K_M").lower()
    ggufs = [f for f in files if f.get("rfilename", "").lower().endswith(".gguf")]
    matches = [f for f in ggufs if wanted in f["rfilename"].lower()]
    whole = [f for f in matches if not _SPLIT.search(f["rfilename"])]
    if whole:
        return whole[0]
    if matches:
        raise GatedPullError(f"{matches[0]['rfilename']} is split into parts; pull a single-file quant")
    names = ", ".join(f["rfilename"] for f in ggufs[:8]) or "none"
    raise GatedPullError(f"no {wanted.upper()} GGUF in this repo (GGUF files: {names})")


def _event(status: str, total: int | None = None, done_bytes: int | None = None, done: bool = False) -> dict[str, Any]:
    percent = round(min(100.0, done_bytes / total * 100), 1) if total and done_bytes is not None else None
    return {"status": status, "digest": None, "total_bytes": total, "completed_bytes": done_bytes,
            "percent": percent, "done": done}


def pull(tag: str) -> Iterator[dict[str, Any]]:
    parsed = parse_hf_tag(tag)
    if not parsed:
        raise GatedPullError(f"{tag} is not an hf.co/ tag")
    secret = token()
    if not secret:
        raise GatedPullError("set HF_TOKEN in .env to pull a gated Hugging Face repo")
    repo, quant = parsed
    auth = {"Authorization": f"Bearer {secret}"}

    listing = httpx.get(f"{HF}/api/models/{repo}", params={"blobs": "true"}, headers=auth, timeout=30.0)
    if listing.status_code in (401, 403):
        raise GatedPullError(
            f"Hugging Face refused the token for {repo} ({listing.status_code}). Accept the model's "
            f"licence at {HF}/{repo} with the account that owns the token, then retry"
        )
    listing.raise_for_status()
    chosen = pick_file(listing.json().get("siblings") or [], quant)
    name = chosen["rfilename"]

    folder = paths.DATA_DIR / "models" / ".hf-download"
    folder.mkdir(parents=True, exist_ok=True)
    part = folder / (name.replace("/", "_") + ".part")
    digest = hashlib.sha256()
    try:
        with httpx.stream("GET", f"{HF}/{repo}/resolve/main/{name}", headers=auth,
                          follow_redirects=True, timeout=httpx.Timeout(30.0, read=120.0)) as response:
            response.raise_for_status()
            total = int(response.headers.get("content-length") or chosen.get("size") or 0) or None
            got = 0
            with part.open("wb") as handle:
                for chunk in response.iter_bytes(_CHUNK):
                    handle.write(chunk)
                    digest.update(chunk)
                    got += len(chunk)
                    yield _event(f"downloading {name}", total, got)

        blob = f"sha256:{digest.hexdigest()}"
        base = ollama_client.candidate_base_urls()[0]
        yield _event("copying into Ollama")

        def body() -> Iterator[bytes]:
            with part.open("rb") as handle:
                while chunk := handle.read(_CHUNK):
                    yield chunk

        pushed = httpx.post(f"{base}/api/blobs/{blob}", content=body(), timeout=httpx.Timeout(30.0, read=600.0))
        if pushed.status_code >= 400:
            raise ollama_client.error_from(pushed)

        with httpx.stream("POST", f"{base}/api/create", timeout=httpx.Timeout(30.0, read=600.0),
                          json={"model": tag, "files": {name.rsplit("/", 1)[-1]: blob}, "stream": True}) as created:
            if created.status_code >= 400:
                created.read()
                raise ollama_client.error_from(created)
            for line in created.iter_lines():
                if not line.strip():
                    continue
                event = json.loads(line)
                if event.get("error"):
                    raise GatedPullError(str(event["error"]))
                yield _event(str(event.get("status") or ""), done=event.get("status") == "success")
    finally:
        part.unlink(missing_ok=True)
