"""The Forge — hardware and model console (Layer 11).

Step 1 of `PROJECT.md` §8.2: detect what this machine is, so the model-fit
estimate has measured numbers rather than assumptions. The remaining five steps
(estimate · score · manage · benchmark · commit) are specified in
`docs/MODULES.md` §2 and not built yet.

**Rule 5 — setup tools are not runtime tools.** Everything under `/api/forge`
is a setup surface. The orchestrator must never call it on the chat path, and
nothing here is exposed to the model as a tool.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from ..services import hardware

router = APIRouter(prefix="/api/forge", tags=["forge"])


@router.get("/hardware")
def hardware_profile() -> dict[str, Any]:
    """RAM, CPU, GPU/VRAM, disk and Ollama, as far as they can be determined.

    Serves the snapshot a background task keeps warm rather than probing here:
    detection costs seconds on this machine — a PowerShell interop call, a
    subprocess, an HTTP timeout — and paying it per panel open made the cost
    scale with how often somebody looked. `hardware.profile()` explains the
    tiers; the `refresh` block in the response says how current the numbers are,
    so the UI can show a cached figure honestly instead of passing it off as
    live.

    Always 200. Every probe is independently guarded and reports what it could
    not determine — a machine with no GPU and no Ollama is a normal machine,
    not an error, and the panel needs to render on it.
    """
    return hardware.profile()


@router.post("/hardware/refresh")
def redetect_hardware() -> dict[str, Any]:
    """Re-probe everything now, ignoring the schedule. Backs "Re-detect".

    POST rather than GET because it is the one call here with a cost worth
    declaring: it pays for every probe, including the ~2.5s WSL interop call the
    cache exists to avoid. Correct — somebody pressing the button is asking a
    question the cache cannot answer, namely *has this machine changed?*
    """
    return hardware.redetect()
