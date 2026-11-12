"""Sheets export and pull with Google stubbed out, and the Google link's gate. No network."""

import csv
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app.db import paths
from app.evaluation import evaluation, sheets
from app.system import google_link

RUN = "eval_20261112_120000"
ARMS = ("vector", "graph-walk", "graph-agent")


def _record(n_questions=12):
    queries = [{"id": f"Q{i:02d}", "category": ["single_hop_factual", "multi_hop_causal"][i % 2],
                "question": f"question {i}?", "language": "ms" if i == 3 else "en", "notes": f"SOP p.{i}",
                "expect": {"answerable": True, "key_facts": ["NDIR"], "relevant_documents": [], "relevant_nodes": []}}
               for i in range(n_questions)]
    results = {arm: [{"id": q["id"], "category": q["category"], "question": q["question"],
                      "answer": f"answer to {q['id']} [D1]", "correct": i % 3 != 0,
                      "evidence_lines": {"D1": "calibrate the NDIR"}, "citations": [{"label": "D1", "source_file": "sop.pdf"}]}
                     for i, q in enumerate(queries)] for arm in ARMS}
    rec = {"run_id": RUN, "arms": list(ARMS), "queries": queries, "results": results, "official": True,
           "status": "complete", "snapshot": {"chat_model": {"tag": "qwen3:1.7b"}}}
    rec["summary"] = evaluation.summary_of(rec)
    rec["significance"] = evaluation.significance(rec)
    return rec


class FakeGoogle:
    """Records what would be sent; each workbook is a dict of tab -> rows."""

    def __init__(self):
        self.books, self.shared, self.requests = {}, [], {}

    def create(self, title, tabs):
        sid = f"S{len(self.books)}"
        self.books[sid] = {"title": title, "tabs": {t: [] for t in tabs}}
        self.requests[sid] = []
        return sid, {t: i for i, t in enumerate(tabs)}

    def write(self, sid, data):
        for rng, rows in data:
            tab, cell = rng.rsplit("!", 1)
            tab = tab.strip("'")
            start = int(cell[1:]) - 1
            grid = self.books[sid]["tabs"][tab]
            while len(grid) < start + len(rows):
                grid.append([])
            for i, row in enumerate(rows):
                old = grid[start + i]
                grid[start + i] = list(row) + old[len(row):]

    def clear(self, sid, ranges):
        for r in ranges:
            self.books[sid]["tabs"][r.strip("'")] = []

    def read(self, sid, rng):
        tab = rng.split("!")[0].strip("'")
        return [[str(c) for c in row] for row in self.books[sid]["tabs"][tab][1:]]

    def batch(self, sid, reqs):
        self.requests[sid].extend(reqs)

    def share(self, fid, email, note):
        self.shared.append((fid, email))


class ExportTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.runs = root / "eval"
        (self.runs / RUN).mkdir(parents=True)
        (self.runs / RUN / "run.json").write_text(json.dumps(_record()))
        self.raters = root / "raters.yaml"
        self.raters.write_text("raters:\n"
                               "  - {id: R1, email: a@x.org, reads_malay: true}\n"
                               "  - {id: R2, email: b@x.org}\n"
                               "  - {id: R3, email: c@x.org}\n")
        self.g = FakeGoogle()
        patches = [mock.patch.object(evaluation, "RUNS_DIR", self.runs),
                   mock.patch.object(sheets, "_create", self.g.create), mock.patch.object(sheets, "_write", self.g.write),
                   mock.patch.object(sheets, "_clear", self.g.clear), mock.patch.object(sheets, "_read", self.g.read),
                   mock.patch.object(sheets, "_batch", self.g.batch), mock.patch.object(sheets, "_share", self.g.share)]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def tearDown(self):
        self.tmp.cleanup()

    def test_export_blind_and_rerun_safe(self):
        out = sheets.export(RUN, self.raters)
        self.assertEqual(len(out["raters"]), 3)
        self.assertEqual(len(self.g.shared), 3)
        master = self.g.books["S3"]  # raters first, master last
        self.assertIn("(master)", master["title"])
        for sid in ("S0", "S1", "S2"):
            text = json.dumps(self.g.books[sid])
            for leak in (*ARMS, "Judge"):  # no arm, no judge in a respondent's workbook
                self.assertNotIn(leak, text)
        self.assertTrue(any("addProtectedRange" in r for r in self.g.requests["S0"]))

        # A rating typed into R1's sheet survives a re-run, and pull reads it back.
        grid = self.g.books["S0"]["tabs"]["Ratings"]
        ncols = len(sheets._rater_columns())
        grid[1] = (grid[1] + [""] * ncols)[:ncols - 6] + ["5", "4", "4", "5", "Yes", "clear"]
        sheets.export(RUN, self.raters)
        self.assertEqual(self.g.books["S0"]["tabs"]["Ratings"][1][-2], "Yes")
        self.assertEqual(len(self.g.shared), 3)  # not shared twice
        res = sheets.pull(RUN, self.raters)
        self.assertEqual(res["ratings"], 1)
        rows = list(csv.DictReader((self.runs / RUN / "ratings.csv").open()))
        self.assertEqual((rows[0]["rater_id"], rows[0]["correctness"], rows[0]["acceptable"]), ("R1", "5", "Yes"))
        by_arm = self.g.books["S3"]["tabs"]["By arm"]
        self.assertEqual(by_arm[0][0], "Arm")
        self.assertEqual(len(by_arm), 1 + len(ARMS))


class GoogleLinkTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        p = mock.patch.object(paths, "DATA_DIR", Path(self.tmp.name))
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self.tmp.cleanup)

    def test_gate_fails_closed_in_simple_mode(self):
        with mock.patch("app.db.tool_policy_store.is_simple", return_value=True):
            ok, why = google_link.allowed()
        self.assertFalse(ok)
        self.assertIn("Simple", why)
        with mock.patch("app.db.tool_policy_store.is_simple", side_effect=RuntimeError):
            self.assertFalse(google_link.allowed()[0])

    def test_grant_file_is_private_and_never_returned(self):
        google_link._write({"email": "me@x.org", "refresh_token": "SECRET", "connected_at": "2026-11-12T00:00:00+00:00"})
        mode = stat.S_IMODE(os.stat(google_link._path()).st_mode)
        self.assertEqual(mode, 0o600)
        with mock.patch.object(google_link, "allowed", return_value=(True, None)):
            out = google_link.status()
        self.assertTrue(out["connected"])
        self.assertNotIn("SECRET", json.dumps(out))

    def test_unknown_state_is_refused(self):
        env = {"DAEDALUS_GOOGLE_CLIENT_ID": "id", "DAEDALUS_GOOGLE_CLIENT_SECRET": "s"}
        with mock.patch.dict(os.environ, env), mock.patch.object(google_link, "allowed", return_value=(True, None)):
            link = google_link.start("http://127.0.0.1:8000/api/google/callback")
            self.assertIn("drive.file", link)
            self.assertIn("code_challenge_method=S256", link)
            with self.assertRaises(google_link.GoogleError):
                google_link.finish("not-the-state", "code")


if __name__ == "__main__":
    unittest.main()
