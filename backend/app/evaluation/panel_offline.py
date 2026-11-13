"""The human panel without a Google connection: rating workbooks out, ratings back.

    python -m app.cli_eval panel-export eval_… [--raters 6]     # one .xlsx per rater
    python -m app.cli_eval panel-import eval_… filled/*.xlsx    # their ratings into ratings.csv

Same assignment (`sheets._assignment`, stored in panel.json), the same Read me
text and the same rater columns as the Google export, so `ratings.csv` and every
agreement figure come out identical whichever way the sheets travelled. A rater
can fill the .xlsx in Excel, or upload it to Google Sheets and download it again
as .xlsx: the dropdowns and the yellow cells survive the round trip.

Blind: the arm, the model and the judge never appear; model and retrieval-tool
names a small model echoed into its answer are masked (`judge.blind`).
"""

from __future__ import annotations

import csv
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import evaluation, judge, panel, sheets

FILL = {"id": "D9EAD3", "question": "F4CCCC", "output": "C9DAF8", "human": "FFF2CC"}
HEAD = {"id": "93C47D", "question": "E06666", "output": "6D9EEB", "human": "FFD966"}


class PanelError(RuntimeError):
    pass


def _raters(n: int) -> list[dict[str, Any]]:
    # Anonymous by design: names and emails never enter these files or the report.
    return [{"id": f"R{i}", "email": f"r{i}@anonymous", "reads_malay": True} for i in range(1, n + 1)]


def export(run_id: str, n_raters: int = 6, out_dir: Path | None = None) -> dict[str, Any]:
    from openpyxl import Workbook  # noqa: PLC0415
    from openpyxl.styles import Alignment, Font, PatternFill  # noqa: PLC0415
    from openpyxl.worksheet.datavalidation import DataValidation  # noqa: PLC0415

    record = evaluation.get_run(run_id)
    ctx = sheets._context(record)  # noqa: SLF001
    answers = sheets._answers(ctx)  # noqa: SLF001
    assignment = sheets._assignment(run_id, answers, _raters(n_raters))  # noqa: SLF001 — writes panel.json
    by_id = {a["answer_id"]: a for a in answers}
    cols = sheets._rater_columns()  # noqa: SLF001
    yellow0 = len(cols) - sheets.RATER_YELLOW
    out_dir = out_dir or (evaluation.RUNS_DIR / run_id / "panel_offline")
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for rid, ids in assignment.items():
        wb = Workbook()
        readme = wb.active; readme.title = "Read me"
        text = sheets.README.format(n=len(ids), minutes=round(len(ids) * 1.1), rater_id=rid)
        for i, line in enumerate(text.split("\n"), 1):
            readme.cell(row=i, column=1, value=line).alignment = Alignment(wrap_text=True, vertical="top")
            if line.isupper():
                readme.cell(row=i, column=1).font = Font(bold=True)
        readme.column_dimensions["A"].width = 120
        ws = wb.create_sheet("Ratings")
        for c, (band, head, width, _) in enumerate(cols, 1):
            cell = ws.cell(row=1, column=c, value=head)
            cell.font = Font(bold=True); cell.alignment = Alignment(wrap_text=True, vertical="center")
            cell.fill = PatternFill("solid", fgColor=HEAD[band])
            ws.column_dimensions[cell.column_letter].width = max(10, width / 7)
        for r, aid in enumerate(ids, 2):
            a = by_id[aid]
            for c, (band, _, _, f) in enumerate(cols, 1):
                value = "" if c > yellow0 else f(a)
                if band in ("question", "output") and isinstance(value, str):
                    value = judge.blind(value)
                cell = ws.cell(row=r, column=c, value=sheets._cell(value) if value != "" else None)  # noqa: SLF001
                cell.alignment = Alignment(wrap_text=True, vertical="top")
                cell.fill = PatternFill("solid", fgColor=FILL[band])
        last = len(ids) + 1
        scores = DataValidation(type="list", formula1='"1,2,3,4,5"', allow_blank=True)
        accept = DataValidation(type="list", formula1='"' + ",".join(sheets.YES_NO) + '"', allow_blank=True)
        ws.add_data_validation(scores); ws.add_data_validation(accept)
        for k in range(len(panel.CRITERIA)):
            letter = ws.cell(row=1, column=yellow0 + 1 + k).column_letter
            scores.add(f"{letter}2:{letter}{last}")
        letter = ws.cell(row=1, column=yellow0 + 1 + len(panel.CRITERIA)).column_letter
        accept.add(f"{letter}2:{letter}{last}")
        ws.freeze_panes = "B2"
        path = out_dir / f"Daedalus_rating_{rid}.xlsx"
        wb.save(path)
        written.append((rid, len(ids), path))
    calib = set.intersection(*(set(v) for v in assignment.values()))
    return {"files": written, "calibration": len(calib), "answers": len(answers)}


def import_(run_id: str, files: list[Path]) -> dict[str, Any]:
    from openpyxl import load_workbook  # noqa: PLC0415

    record = evaluation.get_run(run_id)
    known = set(panel.answer_keys(record))
    head = [h for _, h, _, _ in sheets._rater_columns()]  # noqa: SLF001
    crit = {f"{sheets.CRITERIA_LABELS[c]} (1-5)": c for c in panel.CRITERIA}
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows, problems = [], []
    for path in files:
        rid = path.stem.rsplit("_", 1)[-1]
        if not rid.startswith("R"):
            raise PanelError(f"{path.name}: the file name must end in the rater code, e.g. Daedalus_rating_R3.xlsx")
        ws = load_workbook(path, data_only=True)["Ratings"]
        index = {str(c.value).strip(): i for i, c in enumerate(ws[1]) if c.value}
        if head[0] not in index:
            raise PanelError(f"{path.name}: no 'Answer ID' column; was the Ratings tab renamed?")
        for line in ws.iter_rows(min_row=2, values_only=True):
            aid = line[index[head[0]]]
            if not aid:
                continue
            if aid not in known:
                problems.append(f"{path.name}: unknown answer {aid}"); continue
            r = {"rater_id": rid, "answer_id": aid, "pulled_at": now,
                 "acceptable": str(line[index["Acceptable? (Yes / No / Unsure)"]] or "").strip(),
                 "comment": str(line[index["Comment (optional)"]] or "").strip()}
            filled = False
            for label, c in crit.items():
                v = line[index[label]]
                try:
                    v = int(float(v)) if v not in (None, "") else None
                except ValueError:
                    v = None
                if v is not None and v not in panel.SCALE:
                    problems.append(f"{path.name} {aid}: {label} must be 1-5"); v = None
                r[c] = v if v is not None else ""
                filled = filled or v is not None
            if filled or r["acceptable"]:
                rows.append(r)
    old = [r for r in sheets.load_ratings(run_id) if r.get("rater_id") not in {x["rater_id"] for x in rows}]
    path = evaluation.RUNS_DIR / run_id / "ratings.csv"
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(sheets.RATING_FIELDS)); w.writeheader()
        for r in old + rows:
            w.writerow({k: r.get(k, "") for k in sheets.RATING_FIELDS})
    return {"ratings": len(rows), "raters": sorted({r["rater_id"] for r in rows}), "problems": problems, "file": str(path)}
