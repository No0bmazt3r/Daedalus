"""Settings → Ariadne's Thread: how the Thread labels a turn.

Every turn ends in one of six statuses (`thread.status`). The Thread files each
into one of three buckets the list filters on — Grounded, Not grounded, Not
checked — and this is where that mapping, the buckets' names, and what
"grounded" requires are set.

## It relabels the view, never the record

Nothing here touches the stored audit rows, the validator, or what an
evaluation run counts. `conversation_logs.grounded_flag` stays what the
validator recorded; these settings decide how the Thread *reads* those rows.
So they stay editable while the comparison is frozen — changing them cannot
tune an answer.

## What "grounded" requires

The validator's definition: passed, had evidence, and cited some of it. Each of
the last two can be dropped to see how the counts move:

- `require_citation` — off: a passed answer is grounded without citing.
- `require_evidence` — off: …even when no tool returned anything. "Had
  evidence" is read as *at least one tool call succeeded*, which is what the
  audit log can tell after the fact.

Stored as one preference row (`thread`), like Settings → Assistant.
"""

from __future__ import annotations

from typing import Any

from ..db import prefs_store

KEY = "thread"

STATUSES = ("grounded", "ungrounded", "blocked", "refused", "no_model", "error")
BUCKETS = ("grounded", "ungrounded", "unchecked")
MAX_LABEL_CHARS = 24

DEFAULTS: dict[str, Any] = {
    "require_citation": True,
    "require_evidence": True,
    "buckets": {
        "grounded": "grounded",
        "ungrounded": "ungrounded",
        "blocked": "ungrounded",
        "refused": "unchecked",
        "no_model": "unchecked",
        "error": "unchecked",
    },
    "labels": {"grounded": "Grounded", "ungrounded": "Not grounded", "unchecked": "Not checked"},
}


class SettingsError(ValueError):
    """A value was rejected; the message says which and why."""


def _stored() -> dict[str, Any]:
    # A prefs problem must not break the Thread: fall back to the defaults.
    try:
        value = prefs_store.get_pref(KEY)
    except Exception:  # noqa: BLE001
        return {}
    return value if isinstance(value, dict) else {}


def read() -> dict[str, Any]:
    """The settings in force: stored values over the defaults, unknown keys dropped."""
    raw = _stored()
    buckets = raw.get("buckets") if isinstance(raw.get("buckets"), dict) else {}
    labels = raw.get("labels") if isinstance(raw.get("labels"), dict) else {}
    return {
        "require_citation": bool(raw.get("require_citation", DEFAULTS["require_citation"])),
        "require_evidence": bool(raw.get("require_evidence", DEFAULTS["require_evidence"])),
        "buckets": {
            s: buckets[s] if buckets.get(s) in BUCKETS else DEFAULTS["buckets"][s] for s in STATUSES
        },
        "labels": {
            b: labels[b].strip() if isinstance(labels.get(b), str) and labels[b].strip() else DEFAULTS["labels"][b]
            for b in BUCKETS
        },
    }


def write(patch: dict[str, Any]) -> dict[str, Any]:
    """Merge a partial body. `null` for a field (or the whole body `{"reset": true}`) restores the default."""
    if patch.get("reset") is True:
        prefs_store.set_pref(KEY, {})
        return read()
    current = _stored()
    for flag in ("require_citation", "require_evidence"):
        if flag in patch:
            value = patch[flag]
            if value is None:
                current.pop(flag, None)
            elif isinstance(value, bool):
                current[flag] = value
            else:
                raise SettingsError(f"{flag} must be true or false")
    if "buckets" in patch:
        value = patch["buckets"]
        if value is None:
            current.pop("buckets", None)
        elif isinstance(value, dict):
            merged = dict(current.get("buckets") or {})
            for status, bucket in value.items():
                if status not in STATUSES:
                    raise SettingsError(f"unknown status '{status}'")
                if bucket not in BUCKETS:
                    raise SettingsError(f"'{bucket}' is not one of {', '.join(BUCKETS)}")
                merged[status] = bucket
            current["buckets"] = merged
        else:
            raise SettingsError("buckets must be an object")
    if "labels" in patch:
        value = patch["labels"]
        if value is None:
            current.pop("labels", None)
        elif isinstance(value, dict):
            merged = dict(current.get("labels") or {})
            for bucket, label in value.items():
                if bucket not in BUCKETS:
                    raise SettingsError(f"unknown bucket '{bucket}'")
                if label is None:
                    merged.pop(bucket, None)
                    continue
                if not isinstance(label, str) or not label.strip():
                    raise SettingsError(f"the label for '{bucket}' cannot be empty")
                if len(label.strip()) > MAX_LABEL_CHARS:
                    raise SettingsError(f"the label for '{bucket}' is longer than {MAX_LABEL_CHARS} characters")
                merged[bucket] = label.strip()
            current["labels"] = merged
        else:
            raise SettingsError("labels must be an object")
    prefs_store.set_pref(KEY, current)
    return read()
