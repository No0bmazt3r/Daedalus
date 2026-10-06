"""Operator-editable assistant settings: timezone, system prompt, extra safety rules.

Backs Settings → Assistant. Stored as one preference row (`assistant`) so it is
backed up with the rest of the preferences and never lives in the browser.

## Timezone

Which clock "this morning" and "at 10:00" mean. In order:

1. a zone picked by hand in Settings
2. `DAEDALUS_TZ` from `.env`
3. the zone the browser reported (auto-detect)
4. this machine's zone, which inside a container is usually UTC

## Prompt and safety

The system prompt can be replaced and reset. The safety guard's built-in rules
(`query_pipeline/safety.py`) stay fixed: they are deterministic on purpose, and
a setting that could switch them off would be a guard that can be argued with.
What can change is the wording of each refusal, plus extra blocked phrases that
only ever *add* refusals.

Prompt and safety edits are refused while the comparison is frozen
(`PROJECT.md` §5), for the same reason a track or embedding change is: tuning
after seeing results invalidates them. The timezone is not behaviour and stays
editable.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone, tzinfo
from typing import Any

from ..db import prefs_store

KEY = "assistant"

#: Which refusal texts can be reworded, and the guard reason each one answers.
REFUSAL_KINDS = ("control", "data", "override", "custom")

DEFAULT_CUSTOM_REFUSAL = "I can't help with that here. Ask me about the reactor's readings, trends or procedures."

MAX_PROMPT_CHARS = 8000
MAX_REFUSAL_CHARS = 500
MAX_PHRASES = 100
MAX_PHRASE_CHARS = 100


class SettingsError(ValueError):
    """A value was rejected; the message says which and why."""


class SettingsFrozen(SettingsError):
    """A behaviour edit while the comparison is frozen."""


def _stored() -> dict[str, Any]:
    # Never let a prefs problem break the chat path: fall back to the defaults.
    try:
        value = prefs_store.get_pref(KEY)
    except Exception:  # noqa: BLE001
        return {}
    return value if isinstance(value, dict) else {}


def read() -> dict[str, Any]:
    raw = _stored()
    refusals = raw.get("refusals") if isinstance(raw.get("refusals"), dict) else {}
    phrases = raw.get("blocked_phrases") if isinstance(raw.get("blocked_phrases"), list) else []
    return {
        "timezone": raw.get("timezone") or None,
        "detected_timezone": raw.get("detected_timezone") or None,
        "system_prompt": raw.get("system_prompt") or None,
        "refusals": {k: v for k, v in refusals.items() if k in REFUSAL_KINDS and isinstance(v, str) and v},
        "blocked_phrases": [p for p in phrases if isinstance(p, str) and p.strip()],
    }


def _zone(name: str | None) -> tzinfo | None:
    if not name:
        return None
    try:
        from zoneinfo import ZoneInfo  # noqa: PLC0415

        return ZoneInfo(name)
    except Exception:  # noqa: BLE001 — a bad name falls back, it does not crash
        return None


def timezone_source() -> tuple[tzinfo, str]:
    """The site clock and where it came from: manual, env, browser or machine."""
    settings = read()
    for name, source in (
        (settings["timezone"], "manual"),
        (os.environ.get("DAEDALUS_TZ", "").strip(), "env"),
        (settings["detected_timezone"], "browser"),
    ):
        zone = _zone(name)
        if zone is not None:
            return zone, source
    return datetime.now().astimezone().tzinfo or timezone.utc, "machine"


def site_tz() -> tzinfo:
    return timezone_source()[0]


def system_prompt(default: str) -> str:
    return read()["system_prompt"] or default


def refusal(kind: str, default: str) -> str:
    return read()["refusals"].get(kind) or default


def blocked_phrases() -> list[str]:
    return read()["blocked_phrases"]


def _clean_phrases(value: Any) -> list[str]:
    if not isinstance(value, list):
        raise SettingsError("blocked_phrases must be a list of strings")
    out: list[str] = []
    for item in value:
        if not isinstance(item, str):
            raise SettingsError("blocked_phrases must be a list of strings")
        phrase = " ".join(item.split()).lower()
        if not phrase:
            continue
        if len(phrase) > MAX_PHRASE_CHARS:
            raise SettingsError(f"a blocked phrase is longer than {MAX_PHRASE_CHARS} characters")
        if phrase not in out:
            out.append(phrase)
    if len(out) > MAX_PHRASES:
        raise SettingsError(f"at most {MAX_PHRASES} blocked phrases")
    return out


def write(patch: dict[str, Any], *, frozen: bool = False) -> dict[str, Any]:
    """Merge `patch` into the stored settings. A field set to null resets it."""
    current = _stored()
    behaviour = {"system_prompt", "refusals", "blocked_phrases"} & patch.keys()
    if behaviour and frozen:
        raise SettingsFrozen(
            "the comparison is frozen, so the prompt and safety rules can't change. "
            "Edit config/rag_config.json by hand to unfreeze."
        )

    for field in ("timezone", "detected_timezone"):
        if field in patch:
            name = patch[field]
            if name in (None, ""):
                current.pop(field, None)
            elif not isinstance(name, str) or _zone(name) is None:
                raise SettingsError(f"unknown timezone {name!r}. Use an IANA name like Asia/Kuala_Lumpur")
            else:
                current[field] = name

    if "system_prompt" in patch:
        prompt = patch["system_prompt"]
        if prompt in (None, "") or (isinstance(prompt, str) and not prompt.strip()):
            current.pop("system_prompt", None)
        elif not isinstance(prompt, str):
            raise SettingsError("system_prompt must be text")
        elif len(prompt) > MAX_PROMPT_CHARS:
            raise SettingsError(f"the system prompt is longer than {MAX_PROMPT_CHARS} characters")
        else:
            current["system_prompt"] = prompt

    if "refusals" in patch:
        given = patch["refusals"] or {}
        if not isinstance(given, dict):
            raise SettingsError("refusals must be an object")
        refusals = dict(current.get("refusals") or {})
        for kind, text in given.items():
            if kind not in REFUSAL_KINDS:
                raise SettingsError(f"unknown refusal {kind!r}; expected one of {list(REFUSAL_KINDS)}")
            if text in (None, "") or (isinstance(text, str) and not text.strip()):
                refusals.pop(kind, None)
            elif not isinstance(text, str) or len(text) > MAX_REFUSAL_CHARS:
                raise SettingsError(f"each refusal must be text of at most {MAX_REFUSAL_CHARS} characters")
            else:
                refusals[kind] = text.strip()
        current["refusals"] = refusals

    if "blocked_phrases" in patch:
        current["blocked_phrases"] = _clean_phrases(patch["blocked_phrases"] or [])

    prefs_store.set_pref(KEY, current)
    return read()

