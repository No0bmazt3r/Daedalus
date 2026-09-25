"""User preference endpoints.

Mirrors the contract the Odysseus UI used (`GET`/`PUT /api/prefs/<key>` with a
`{"value": ...}` envelope) so the shape is familiar, but persists to SQLite
rather than the browser.
"""

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from ..db import prefs_store

router = APIRouter(prefix="/api/prefs", tags=["prefs"])

# Only keys the UI actually owns are writable — an unknown key is a bug or an
# abuse, not something to persist.
# `keybinds` is the shortcut map and `ui-chrome` the visibility of the app's own
# furniture. Both belong here rather than in browser storage for the reason the
# rest of this file exists: a console whose keyboard map lives in one machine's
# localStorage cannot be described in a write-up, restored from a backup, or
# read back when somebody asks what the interface was when a result was taken.
# `forge-shortlist` is the Forge's starred models, stored as edits against the
# report's six candidates so a catalogue change still reaches an untouched list.
ALLOWED_KEYS = {
    "theme", "custom-themes", "ui-scale", "settings-ui", "keybinds", "ui-chrome",
    "forge-shortlist",
}


class PrefBody(BaseModel):
    value: Any


def _check_key(key: str) -> None:
    if key not in ALLOWED_KEYS:
        raise HTTPException(
            status_code=404,
            detail=f"unknown preference '{key}' (allowed: {sorted(ALLOWED_KEYS)})",
        )


@router.get("")
def read_all() -> dict[str, Any]:
    """Every stored preference in one round trip.

    The UI calls this once on boot, so the first paint costs a single request
    rather than one per key.
    """
    return {"values": prefs_store.get_all_prefs()}


# Colours the UI paints onto :root, mapped to the CSS variable each one sets.
_COLOR_VARS = {
    "bg": "--bg",
    "sidebar": "--sidebar",
    "card": "--card",
    "border": "--border",
    "primary": "--primary",
    "text": "--text-main",
    "textMuted": "--text-muted",
}

_FONT_STACKS = {
    # Monocraft — the Minecraft face, bundled with the UI. Kept in step with
    # FONT_MAP in frontend/src/lib/themes.ts; both render the same selector.
    "minecraft": "'Monocraft', ui-monospace, SFMono-Regular, Menlo, monospace",
    "sans": "'Geist Variable', system-ui, -apple-system, 'Segoe UI', sans-serif",
    "mono": "'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace",
    "serif": "Georgia, 'Times New Roman', serif",
    "opendyslexic": "'OpenDyslexic', 'Comic Sans MS', sans-serif",
}

# What a machine with no saved theme paints on its first frame — matches
# DEFAULT_FONT in themes.ts, so the boot does not flash a different face.
_DEFAULT_FONT = "minecraft"

# Monocraft is a bitmap face and wants antialiasing off. themes.ts applies the
# same rule through .font-pixel once React boots; this is the first-frame copy.
_PIXEL_FONTS = {"minecraft"}

_DENSITY_FONT_SIZE = {"compact": "14px", "spacious": "17px"}

_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


# Declared before /{key} so the path parameter cannot swallow it.
@router.get("/theme.css", response_class=Response)
def theme_css() -> Response:
    """The saved palette as a stylesheet.

    The page links this in <head>, so the user's theme is painted on the very
    first frame. Without it the UI would flash the default palette on every
    load, since preferences live on the server and cannot be read
    synchronously the way localStorage could.
    """
    theme = prefs_store.get_pref("theme") or {}
    lines: list[str] = []

    colors = theme.get("colors") if isinstance(theme, dict) else None
    if isinstance(colors, dict):
        for key, var in _COLOR_VARS.items():
            value = colors.get(key)
            # Interpolated straight into CSS, so only accept exact hex.
            if isinstance(value, str) and _HEX.match(value):
                lines.append(f"  {var}: {value};")

    font_key = theme.get("font") if isinstance(theme, dict) else None
    # Only ever an exact key from the table below — never interpolated raw.
    if not isinstance(font_key, str) or font_key not in _FONT_STACKS:
        font_key = _DEFAULT_FONT
    lines.append(f"  --font-family: {_FONT_STACKS[font_key]};")
    if font_key in _PIXEL_FONTS:
        lines.append("  -webkit-font-smoothing: none;")
        lines.append("  font-smooth: never;")

    root = ":root {\n" + "\n".join(lines) + "\n}" if lines else ""

    extra = ""
    if isinstance(theme, dict):
        size = _DENSITY_FONT_SIZE.get(theme.get("density"))
        if size:
            extra += f"\n:root {{ font-size: {size}; }}"
    if prefs_store.get_pref("ui-scale") == "125":
        extra += "\n:root { zoom: 1.25; }"

    css = "/* Generated from the saved theme — see backend/app/api/prefs.py */\n"
    return Response(
        content=css + root + extra + "\n",
        media_type="text/css",
        # Always reflect the latest save; the file is tiny.
        headers={"Cache-Control": "no-store"},
    )


@router.get("/{key}")
def read_one(key: str) -> dict[str, Any]:
    _check_key(key)
    return {"value": prefs_store.get_pref(key)}


@router.put("/{key}")
def write_one(key: str, body: PrefBody) -> dict[str, Any]:
    _check_key(key)
    try:
        updated_at = prefs_store.set_pref(key, body.value)
    except prefs_store.PrefTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    return {"ok": True, "updated_at": updated_at}


@router.delete("/{key}")
def clear_one(key: str) -> dict[str, Any]:
    _check_key(key)
    return {"ok": True, "deleted": prefs_store.delete_pref(key)}
