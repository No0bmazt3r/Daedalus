"""Judge in a chat app: export blind parts, import the replies back into each run. No network."""

import csv
import json
import shutil
import unittest

from app.evaluation import evaluation, judge, judge_offline as jo

A, B = "eval_20260101_000001", "eval_20260101_000002"


def _run(run_id: str, model: str) -> None:
    queries = [{"id": f"Q{i}", "category": "single_hop_factual", "question": f"q{i}?", "notes": "n",
                "expect": {"answerable": True, "key_facts": ["x"], "forbidden": []}} for i in (1, 2)]
    results = {arm: [{"id": q["id"], "question": q["question"], "answer": f"{q['id']} says x. tool: graph_agent · chosen by phi3:mini",
                      "evidence_lines": {"S1": "x is true"}} for q in queries] for arm in ("vector", "graph-walk")}
    d = evaluation.RUNS_DIR / run_id
    d.mkdir(parents=True, exist_ok=True)
    (d / "run.json").write_text(json.dumps({"run_id": run_id, "queries": queries, "results": results}))


class OfflineJudgeTest(unittest.TestCase):
    def setUp(self):
        judge.PROMPT_PATH.parent.mkdir(parents=True, exist_ok=True)
        judge.PROMPT_PATH.write_text("version: 2\nGrade it.\nReturn ONLY a JSON object {...}", encoding="utf-8")
        _run(A, "modelA")
        _run(B, "modelB")
        self.out = evaluation.RUNS_DIR / "judge_export_test"
        shutil.rmtree(self.out, ignore_errors=True)

    def test_round_trip(self):
        m = jo.export([A, B], self.out, chunk=3)
        self.assertEqual((m["answers"], m["repeats"]), (8, 1))
        self.assertEqual(len(m["parts"]), 3)                         # 9 rows in parts of 3
        parts = "".join((self.out / p).read_text() for p in m["parts"])
        for leak in ("modelA", "modelB", A, B, "graph-walk", "vector", "graph_agent", "phi3"):
            self.assertNotIn(leak, parts)                            # blind: no run or arm in what is uploaded
        self.assertIn("CSV", (self.out / "PROMPT.md").read_text())
        self.assertNotIn("JSON object", (self.out / "PROMPT.md").read_text())

        ids = [r["id"] for p in m["parts"] for r in csv.DictReader((self.out / p).open())]
        good = "\n".join(f'{i},5,4,4,5,true,"ok","fine, grounded"' for i in ids[1:])
        reply = self.out / "reply.csv"
        reply.write_text("Here you go:\n```csv\nid,correctness,groundedness,completeness,safety,acceptable,"
                         f"summary,analysis\n{ids[0]},9,4,4,5,true,\"x\",\"y\"\n{good}\n```\n")
        # a cut-off reply finished by "continue": second piece, no header, in its own block
        last = good.splitlines()
        reply.write_text("Here you go:\n```csv\nid,correctness,groundedness,completeness,safety,acceptable,"
                         f"summary,analysis\n{ids[0]},9,4,4,5,true,\"x\",\"y\"\n" + "\n".join(last[:4])
                         + "\n```\nContinuing:\n```csv\n" + "\n".join(last[4:]) + "\n```\n")
        out = jo.import_([reply], "test judge", self.out)

        self.assertEqual(out["imported"], 8)
        self.assertEqual(out["missing"], [ids[0]])                   # the out-of-range score is rejected, not stored
        self.assertTrue(any("correctness must be an integer 1-5" in p for p in out["problems"]))
        a = json.loads((evaluation.RUNS_DIR / A / "judgments.json").read_text())
        b = json.loads((evaluation.RUNS_DIR / B / "judgments.json").read_text())
        self.assertEqual(len(a["items"]) + len(b["items"]) + len(a["repeats"]) + len(b["repeats"]), 8)
        self.assertEqual(a["model"], "test judge")
        self.assertEqual(next(iter((a["items"] or b["items"]).values()))["groundedness"], 4)


if __name__ == "__main__":
    unittest.main()
