"""The LLM judge over an exported run: docs/EVAL_SHEETS.md, PROJECT.md §9.3 Method B.

    python -m app.cli_eval judge <run_id> --model gpt-oss:120b-cloud

One answer at a time (never pairwise, so no position or length bias between
arms), temperature 0, JSON constrained by Ollama's `format: json` and then
validated here. An invalid reply is retried once, then recorded `judge_failed`.
A seeded 10 % is judged a second time to measure the judge's self-consistency.

Rule 1: this runs after the run, over files the local system already wrote,
never during operator chat. A cloud tag is refused in Simple mode, like every
other cloud use (`model_config.cloud_allowed`). Judging with the model that
answered is refused unless `allow_self`, since a model grading itself is the
weakest form of LLM-as-judge.

Output: `data/eval/<run_id>/judgments.json`. Resumable: answers already judged
by the same model and prompt are kept.
"""

from __future__ import annotations

import hashlib
import json
import random
from datetime import datetime, timezone
from typing import Any, Callable

from ..db import paths
from . import evaluation, panel

PROMPT_PATH = paths.CONFIG_DIR / "eval" / "judge_prompt.md"
REPEAT_SHARE = 0.10
MAX_EVIDENCE_CHARS = 6000


class JudgeError(RuntimeError):
    pass


def prompt() -> tuple[str, str, str]:
    """(text, version, sha) of the judge prompt."""
    text = PROMPT_PATH.read_text(encoding="utf-8")
    first = text.splitlines()[0] if text else ""
    version = first.split(":", 1)[1].strip() if first.startswith("version:") else "?"
    return text, version, hashlib.sha256(text.encode()).hexdigest()[:12]


def item(query: dict[str, Any], row: dict[str, Any]) -> str:
    """What the judge sees for one answer. The arm is never in it."""
    expect = query.get("expect") or {}
    lines = row.get("evidence_lines") or {}
    evidence = "\n".join(f"[{k}] {v}" for k, v in lines.items())[:MAX_EVIDENCE_CHARS] or "(no evidence lines)"
    return json.dumps({
        "question": row.get("question"),
        "answerable": expect.get("answerable"),
        "required_facts": expect.get("key_facts"),
        "must_not_contain": expect.get("forbidden") or [],
        "reference_note": query.get("notes"),
        "evidence_lines": evidence,
        "answer": row.get("answer") or "(no answer: the turn failed)",
    }, ensure_ascii=False, indent=1)


def parse(reply: str) -> dict[str, Any]:
    """The judge's JSON, checked. Raises ValueError naming what is wrong."""
    data = json.loads(reply)
    if not isinstance(data, dict):
        raise ValueError("not an object")
    out: dict[str, Any] = {}
    for c in panel.CRITERIA:
        v = data.get(c)
        if isinstance(v, float) and v.is_integer():
            v = int(v)
        if not isinstance(v, int) or v not in panel.SCALE:
            raise ValueError(f"{c} must be an integer 1-5, got {v!r}")
        out[c] = v
    if not isinstance(data.get("acceptable"), bool):
        raise ValueError("acceptable must be true or false")
    out["acceptable"] = data["acceptable"]
    for k in ("analysis", "summary"):
        if not isinstance(data.get(k), str) or not data[k].strip():
            raise ValueError(f"{k} must be non-empty text")
        out[k] = " ".join(data[k].split())
    return out


def _ask(model: str, system: str, user: str) -> dict[str, Any]:
    from ..forge import ollama_client  # noqa: PLC0415

    last = None
    for _ in range(2):  # one retry, then give up on this answer
        try:
            return parse(ollama_client.generate(model, user, system=system, json_format=True,
                                                temperature=0.0, timeout=240))
        except (ValueError, json.JSONDecodeError) as exc:
            last = f"invalid reply: {exc}"
        except Exception as exc:  # noqa: BLE001 — network, model missing
            last = f"{exc.__class__.__name__}: {exc}"
    return {"judge_failed": last}


def _check_model(model: str, record: dict[str, Any], allow_self: bool) -> None:
    from ..forge import benchmark, model_config  # noqa: PLC0415

    if not model:
        raise JudgeError("name the judge model: --model <ollama tag> or DAEDALUS_JUDGE_MODEL in .env")
    answered = ((record.get("snapshot") or {}).get("chat_model") or {}).get("tag")
    if model == answered and not allow_self:
        raise JudgeError(f"{model} also answered this run; a model grading itself is not a fair judge. "
                         "Pick a stronger model, or pass --allow-self and say so in the report.")
    if benchmark._is_remote(model) and not model_config.cloud_allowed():  # noqa: SLF001
        raise JudgeError(f"{model} is a cloud model and cloud models are off (Simple mode or "
                         "Settings → General → Cloud models).")


def run(run_id: str, model: str, *, allow_self: bool = False,
        on_progress: Callable[[int, int, str], None] | None = None) -> dict[str, Any]:
    record = evaluation.get_run(run_id)
    _check_model(model, record, allow_self)
    text, version, sha = prompt()
    keys = panel.answer_keys(record)
    queries = {q["id"]: q for q in record["queries"]}
    rows = {(arm, r["id"]): r for arm, rs in record["results"].items() for r in rs}

    path = evaluation.RUNS_DIR / run_id / "judgments.json"
    old = json.loads(path.read_text()) if path.exists() else {}
    same = old.get("model") == model and old.get("prompt_sha") == sha
    out = {"run_id": run_id, "model": model, "prompt_version": version, "prompt_sha": sha,
           "judged_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "items": old.get("items", {}) if same else {}, "repeats": old.get("repeats", {}) if same else {}}

    ids = sorted(keys)
    repeat_ids = sorted(random.Random(f"{run_id}-repeat").sample(ids, max(1, round(len(ids) * REPEAT_SHARE))))
    todo = [(a, "items") for a in ids if "judge_failed" in out["items"].get(a, {"judge_failed": 1})]
    todo += [(a, "repeats") for a in repeat_ids if a not in out["repeats"]]
    for n, (aid, where) in enumerate(todo, 1):
        arm, qid = keys[aid]
        if on_progress:
            on_progress(n, len(todo), f"{aid}{' (repeat)' if where == 'repeats' else ''}")
        out[where][aid] = _ask(model, text, item(queries.get(qid, {}), rows[(arm, qid)]))
        path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return out


def load(run_id: str) -> dict[str, Any] | None:
    path = evaluation.RUNS_DIR / run_id / "judgments.json"
    return json.loads(path.read_text()) if path.exists() else None
