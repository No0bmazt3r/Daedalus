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

    Always 200. Every probe is independently guarded and reports what it could
    not determine — a machine with no GPU and no Ollama is a normal machine,
    not an error, and the panel needs to render on it.
    """
    return hardware.profile()
