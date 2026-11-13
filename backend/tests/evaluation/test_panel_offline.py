"""Offline rating workbooks: export, fill as a rater would, import into ratings.csv. No network."""

import json
import shutil
import unittest

from app.evaluation import evaluation, panel_offline as po, sheets

RID = "eval_20260101_000003"


def _run() -> None:
    qs = [{"id": f"Q{i}", "category": "single_hop_factual", "question": f"q{i}?", "language": "en",
           "rig_specific": False, "notes": "n", "expect": {"answerable": True, "key_facts": ["x"], "forbidden": []}}
          for i in range(1, 9)]
    res = {arm: [{"id": q["id"], "category": q["category"], "question": q["question"],
                  "answer": f"{q['id']} says x (chosen by phi3:mini)", "evidence_lines": {"S1": "x"}} for q in qs]
           for arm in ("vector", "graph-walk")}
    d = evaluation.RUNS_DIR / RID
    shutil.rmtree(d, ignore_errors=True); d.mkdir(parents=True)
    (d / "run.json").write_text(json.dumps({"run_id": RID, "queries": qs, "results": res}))


class PanelOfflineTest(unittest.TestCase):
    def test_round_trip(self):
        from openpyxl import load_workbook
        _run()
        out = po.export(RID, n_raters=3)
        self.assertEqual(out["answers"], 16)
        cover = {}
        for rid, n, path in out["files"]:
            ws = load_workbook(path)["Ratings"]
            text = " ".join(str(c.value) for row in ws.iter_rows() for c in row if c.value)
            self.assertNotIn("phi3", text)                              # blind: model names masked
            self.assertNotIn("vector", text); self.assertNotIn("graph-walk", text)
            head = [c.value for c in ws[1]]
            for r in range(2, n + 2):                                   # a rater fills every yellow cell
                ws.cell(row=r, column=head.index("Correctness (1-5)") + 1, value=4)
                ws.cell(row=r, column=head.index("Groundedness (1-5)") + 1, value=5)
                ws.cell(row=r, column=head.index("Completeness (1-5)") + 1, value=3)
                ws.cell(row=r, column=head.index("Safety (1-5)") + 1, value=5)
                ws.cell(row=r, column=head.index("Acceptable? (Yes / No / Unsure)") + 1, value="Yes")
                cover[ws.cell(row=r, column=1).value] = cover.get(ws.cell(row=r, column=1).value, 0) + 1
            ws.parent.save(path)
        self.assertTrue(all(v >= 2 for v in cover.values()))           # every answer has two raters or more
        got = po.import_(RID, [p for _, _, p in out["files"]])
        self.assertEqual(got["problems"], [])
        rows = sheets.load_ratings(RID)
        self.assertEqual(len(rows), sum(n for _, n, _ in out["files"]))
        self.assertEqual({r["rater_id"] for r in rows}, {"R1", "R2", "R3"})
        self.assertEqual(str(rows[0]["groundedness"]), "5")


if __name__ == "__main__":
    unittest.main()
