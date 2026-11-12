"""Panel maths and the judge's reply check (docs/EVAL_SHEETS.md). No network."""

import json
import unittest

from app.evaluation import judge, panel

N = None
# Krippendorff (2011), "Computing Krippendorff's Alpha-Reliability", worked example:
# 4 observers x 12 units. Published: nominal 0.743, interval 0.849, ordinal 0.815.
_UNITS = list(zip(
    [1, 2, 3, 3, 2, 1, 4, 1, 2, N, N, N],
    [1, 2, 3, 3, 2, 2, 4, 1, 2, 5, N, 3],
    [N, 3, 3, 3, 2, 3, 4, 2, 2, 5, 1, N],
    [1, 2, 3, 3, 2, 4, 4, 1, 2, 5, 1, N],
))


class AgreementTest(unittest.TestCase):
    def test_alpha_matches_published_values(self):
        self.assertAlmostEqual(panel.krippendorff_alpha(_UNITS, "nominal"), 0.743, places=3)
        self.assertAlmostEqual(panel.krippendorff_alpha(_UNITS, "interval"), 0.849, places=3)
        self.assertAlmostEqual(panel.krippendorff_alpha(_UNITS, "ordinal"), 0.815, places=3)

    def test_alpha_perfect_and_missing(self):
        self.assertEqual(panel.krippendorff_alpha([[3, 3], [5, 5], [1, 1]]), 1.0)
        self.assertIsNone(panel.krippendorff_alpha([[3, None], [None, None]]))

    def test_spearman_and_kappa(self):
        self.assertAlmostEqual(panel.spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1.0)
        self.assertAlmostEqual(panel.spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1.0)
        self.assertEqual(panel.weighted_kappa([1, 3, 5], [1, 3, 5]), 1.0)
        self.assertLess(panel.weighted_kappa([1, 1, 5, 5], [5, 5, 1, 1]), 0)


class AssignmentTest(unittest.TestCase):
    def setUp(self):
        self.answers = [{"answer_id": f"A{i:03d}", "category": ["f", "p", "m"][i % 3], "arm": ["v", "g"][i % 2],
                         "language": "ms" if i % 10 == 0 else "en"} for i in range(1, 61)]
        self.raters = [{"id": "R1", "reads_malay": True}, {"id": "R2"}, {"id": "R3", "reads_malay": True}, {"id": "R4"}]

    def test_rules(self):
        out = panel.assign(self.answers, self.raters, seed="x")
        self.assertEqual(out, panel.assign(self.answers, self.raters, seed="x"))  # seeded
        common = set.intersection(*(set(v) for v in out.values()))
        self.assertEqual(len(common), panel.CALIBRATION)
        counts = {a["answer_id"]: sum(a["answer_id"] in v for v in out.values()) for a in self.answers}
        self.assertTrue(all(n >= panel.PER_ANSWER for n in counts.values()))
        malay = {a["answer_id"] for a in self.answers if a["language"] == "ms"}
        self.assertFalse(malay & (set(out["R2"]) | set(out["R4"])))
        loads = [len(v) for v in out.values()]
        self.assertLessEqual(max(loads) - min(loads), 3)

    def test_review_reasons(self):
        j = {c: 5 for c in panel.CRITERIA} | {"acceptable": True}
        h = {"means": {c: 2.0 for c in panel.CRITERIA}, "acceptable_split": False}
        self.assertTrue(any("differ" in r for r in panel.review_reasons(j, h, True)))
        self.assertIn("judge and lexical scoring disagree", panel.review_reasons(j, None, False))
        self.assertEqual(panel.review_reasons(j, None, True), [])


class JudgeReplyTest(unittest.TestCase):
    good = {"correctness": 4, "groundedness": 5, "completeness": 3.0, "safety": 5,
            "acceptable": True, "analysis": " Right  facts. ", "summary": "fine"}

    def test_valid(self):
        out = judge.parse(json.dumps(self.good))
        self.assertEqual(out["completeness"], 3)
        self.assertEqual(out["analysis"], "Right facts.")

    def test_invalid(self):
        for bad in ({**self.good, "safety": 6}, {**self.good, "acceptable": "yes"},
                    {**self.good, "summary": ""}, {k: v for k, v in self.good.items() if k != "correctness"}):
            with self.assertRaises(ValueError):
                judge.parse(json.dumps(bad))

    def test_item_hides_the_arm(self):
        q = {"expect": {"answerable": True, "key_facts": ["NDIR"]}, "notes": "SOP p.4"}
        row = {"question": "q?", "answer": "a [D1]", "evidence_lines": {"D1": "text"}}
        text = judge.item(q, row)
        self.assertNotIn("vector", text)
        self.assertIn("[D1] text", text)


if __name__ == "__main__":
    unittest.main()
