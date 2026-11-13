"""The judge, done in a chat app instead of an API: export batches, import the replies.

    python -m app.cli_eval judge-export                       # every complete official run
    python -m app.cli_eval judge-import part_*_judged.csv --model "Gemini … (AI Studio, temp 0)"

For when no judge API is available. `judge-export` merges every answer of the given
runs into one blind pool, shuffles it, adds a seeded 10 % as repeats (the judge's
self-consistency, as in `judge.run`), gives each row a fresh id (J0001 …) and writes
it as CSV parts small enough for one chat reply each. The model, the arm and the run
are never in a part: they live only in `key.csv`, which stays on this machine.

`judge-import` reads the chat's CSV replies back, checks every row with the same
rules as the API judge (`judge.parse`), and writes each run's `judgments.json` in
the same shape `judge.run` does, so the panel, the sheets and the agreement maths
read them unchanged. Parts can be imported one at a time, in any order.

What differs from the API judge, and must be said in the write-up: a chat judges
~50 answers per conversation rather than one per request, and its decoding is
whatever the app allows (set temperature 0 where it can be set).
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import random
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import evaluation, judge, panel

EXPORT_DIR = evaluation.RUNS_DIR / "judge_export"
CHUNK = 50
IN_COLUMNS = ("id", "question", "answerable", "required_facts", "must_not_contain",
              "reference_note", "evidence_lines", "answer")
OUT_COLUMNS = ("id", "correctness", "groundedness", "completeness", "safety",
               "acceptable", "summary", "analysis")

_BATCH_HEAD = """You are grading a CSV of answers. Each row is ONE answer from a laboratory
assistant, with the question, the evidence lines the assistant was shown, the facts a
correct answer must contain, and whether the question is answerable at all.

Judge EVERY row, one at a time and on its own: never compare rows with each other,
never skip a row, never merge rows. The rows are in random order on purpose.

The attached REFERENCE.md is the reactor reference mentioned below.

"""

_BATCH_TAIL = """Reply with ONLY a CSV (inside one ```csv code block), one line per input row,
in the same order, with exactly this header:

id,correctness,groundedness,completeness,safety,acceptable,summary,analysis

- id: copied exactly from the input row (e.g. J0042)
- the four scores: integers 1-5
- acceptable: true or false
- summary: one short line
- analysis: 1-2 sentences (start with LABEL CONFLICT: when that rule applies)
- put summary and analysis in double quotes; write any double quote inside them as ""

Count your output lines before finishing: there must be one per input row.
"""


class OfflineJudgeError(RuntimeError):
    pass


def batch_prompt() -> str:
    """The API judge's instructions and anchors, with its JSON reply format swapped for CSV."""
    text = judge.PROMPT_PATH.read_text(encoding="utf-8")
    core = text.split("Return ONLY a JSON object", 1)[0].rstrip()
    core = "\n".join(core.splitlines()[1:]).strip()  # drop the "version:" line
    return _BATCH_HEAD + core + "\n\n" + _BATCH_TAIL


def _row(query: dict[str, Any], row: dict[str, Any]) -> dict[str, str]:
    item = json.loads(judge.item(query, row))  # exactly what the API judge would see
    lists = lambda v: "; ".join(v) if isinstance(v, list) else (v or "")  # noqa: E731
    return {"question": item["question"] or "", "answerable": str(item["answerable"]).lower(),
            "required_facts": lists(item["required_facts"]), "must_not_contain": lists(item["must_not_contain"]),
            "reference_note": item["reference_note"] or "", "evidence_lines": item["evidence_lines"],
            "answer": item["answer"]}


def export(run_ids: list[str] | None = None, out_dir: Path | None = None, chunk: int = CHUNK) -> dict[str, Any]:
    out_dir = out_dir or EXPORT_DIR
    if run_ids is None:
        run_ids = sorted(r["run_id"] for r in evaluation.list_runs()
                         if r.get("official") and r.get("status") == "complete")
    if not run_ids:
        raise OfflineJudgeError("no complete official runs to export")
    if out_dir.exists() and any(out_dir.iterdir()):
        raise OfflineJudgeError(f"{out_dir} is not empty — move it aside first (it may hold a key you still need)")

    pool: list[tuple[str, str, dict[str, str]]] = []  # (run_id, answer id, row)
    for run_id in run_ids:
        record = evaluation.get_run(run_id)
        queries = {q["id"]: q for q in record["queries"]}
        rows = {(arm, r["id"]): r for arm, rs in record["results"].items() for r in rs}
        for aid, (arm, qid) in sorted(panel.answer_keys(record).items()):
            pool.append((run_id, aid, _row(queries.get(qid, {}), rows[(arm, qid)])))

    rng = random.Random("judge-export:" + ",".join(run_ids))
    repeats = rng.sample(range(len(pool)), max(1, round(len(pool) * judge.REPEAT_SHARE)))
    entries = [(i, False) for i in range(len(pool))] + [(i, True) for i in repeats]
    rng.shuffle(entries)

    out_dir.mkdir(parents=True)
    prompt = batch_prompt()
    reference = judge.REFERENCE_PATH.read_text(encoding="utf-8") if judge.REFERENCE_PATH.exists() else ""
    (out_dir / "PROMPT.md").write_text(prompt, encoding="utf-8")
    (out_dir / "REFERENCE.md").write_text(reference, encoding="utf-8")

    key_rows, parts = [], []
    for start in range(0, len(entries), chunk):
        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=IN_COLUMNS, quoting=csv.QUOTE_ALL)
        w.writeheader()
        for n, (i, is_repeat) in enumerate(entries[start:start + chunk], start + 1):
            jid = f"J{n:04d}"
            run_id, aid, row = pool[i]
            w.writerow({"id": jid, **row})
            key_rows.append({"id": jid, "run_id": run_id, "answer_id": aid, "repeat": is_repeat})
        name = f"part_{len(parts) + 1:02d}.csv"
        (out_dir / name).write_text(buf.getvalue(), encoding="utf-8")
        parts.append(name)

    with (out_dir / "key.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=("id", "run_id", "answer_id", "repeat"))
        w.writeheader()
        w.writerows(key_rows)
    manifest = {"created": datetime.now(timezone.utc).isoformat(timespec="seconds"), "runs": run_ids,
                "answers": len(pool), "repeats": len(repeats), "parts": parts,
                "prompt_version": judge.prompt()[1],
                "prompt_sha": hashlib.sha256((prompt + reference).encode()).hexdigest()[:12]}
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return {**manifest, "dir": str(out_dir)}


def _csv_text(raw: str) -> str:
    """The CSV in a chat reply, normalised to one header + rows.

    Takes every ```csv block (a "continue" adds another), or the whole text when
    there is none; drops prose and repeated headers; puts one header on top, since
    a continuation piece usually arrives without it.
    """
    blocks = re.findall(r"```(?:csv)?[^\n]*\n(.*?)```", raw, re.S) or [raw]
    header = ",".join(OUT_COLUMNS)
    rows = [ln for b in blocks for ln in b.splitlines()
            if ln.strip() and ln.replace(" ", "").lower() != header]
    # A row starts with an id (J0001); anything else is a wrapped continuation of the
    # previous row's quoted text, or prose around the table.
    kept: list[str] = []
    for ln in rows:
        if re.match(r'^\s*"?J\d{4}', ln) or (kept and kept[-1].count('"') % 2):
            kept.append(ln)
    return header + "\n" + "\n".join(kept)


def _to_bool(value: str) -> Any:
    v = (value or "").strip().lower()
    return True if v in ("true", "yes", "1") else False if v in ("false", "no", "0") else value


def import_(files: list[Path], model: str, export_dir: Path | None = None) -> dict[str, Any]:
    export_dir = export_dir or EXPORT_DIR
    if not model.strip():
        raise OfflineJudgeError("name the judge: --model \"<model name> via <app>, temp <t>, <date>\"")
    try:
        manifest = json.loads((export_dir / "manifest.json").read_text())
        with (export_dir / "key.csv").open(newline="", encoding="utf-8") as f:
            key = {r["id"]: r for r in csv.DictReader(f)}
    except OSError as exc:
        raise OfflineJudgeError(f"no export in {export_dir} — run judge-export first") from exc

    got: dict[str, dict[str, Any]] = {}
    problems: list[str] = []
    for path in files:
        reader = csv.DictReader(io.StringIO(_csv_text(path.read_text(encoding="utf-8-sig"))))
        for line in reader:
            line = {(k or "").strip().lower(): (v or "").strip() for k, v in line.items()}
            jid = line.get("id", "")
            if jid not in key:
                problems.append(f"{path.name}: unknown id {jid!r}")
                continue
            try:
                scores = judge.parse(json.dumps({
                    **{c: int(line[c]) if line.get(c, "").isdigit() else line.get(c) for c in panel.CRITERIA},
                    "acceptable": _to_bool(line.get("acceptable", "")),
                    "analysis": line.get("analysis", ""), "summary": line.get("summary", ""),
                }))
            except ValueError as exc:
                problems.append(f"{path.name} {jid}: {exc}")
                continue
            got[jid] = scores

    by_run: dict[str, dict[str, dict[str, Any]]] = {}
    for jid, scores in got.items():
        k = key[jid]
        where = "repeats" if k["repeat"] == "True" else "items"
        by_run.setdefault(k["run_id"], {"items": {}, "repeats": {}})[where][k["answer_id"]] = scores

    for run_id, new in by_run.items():
        path = evaluation.RUNS_DIR / run_id / "judgments.json"
        old = json.loads(path.read_text()) if path.exists() else {}
        same = old.get("model") == model and old.get("prompt_sha") == manifest["prompt_sha"]
        out = {"run_id": run_id, "model": model, "mode": "offline chat batches (judge_offline.py)",
               "prompt_version": manifest["prompt_version"], "prompt_sha": manifest["prompt_sha"],
               "judged_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
               "items": {**(old.get("items", {}) if same else {}), **new["items"]},
               "repeats": {**(old.get("repeats", {}) if same else {}), **new["repeats"]}}
        out["items"] = {a: s for a, s in out["items"].items() if "judge_failed" not in s}
        path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    done = set()
    for run_id in manifest["runs"]:
        path = evaluation.RUNS_DIR / run_id / "judgments.json"
        j = json.loads(path.read_text()) if path.exists() else {}
        if j.get("prompt_sha") == manifest["prompt_sha"]:
            done |= {(run_id, a, False) for a in j.get("items", {})} | {(run_id, a, True) for a in j.get("repeats", {})}
    missing = sorted(jid for jid, k in key.items() if (k["run_id"], k["answer_id"], k["repeat"] == "True") not in done)
    return {"imported": len(got), "problems": problems, "missing": missing, "total": len(key)}
