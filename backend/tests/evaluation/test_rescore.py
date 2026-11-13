"""Rescoring a finished run against corrected labels: the stored answers, the new yardstick."""

import unittest

from app.evaluation import evaluation


def _q(qid, answerable, facts, docs):
    return {"id": qid, "category": "single_hop_factual", "question": "?", "language": "en", "rig_specific": True,
            "expect": {"answerable": answerable, "key_facts": facts, "relevant_documents": docs,
                       "relevant_nodes": [], "forbidden": []}, "notes": None}


class RescoreTest(unittest.TestCase):
    def test_relabelled_question_is_rescored_and_its_retrieval_blanked(self):
        old = [_q("Q01", True, ["600"], ["Old.md"]), _q("Q02", True, ["5 ?bar"], ["SOP.md"])]
        rows = [{"id": "Q01", "category": "single_hop_factual", "answer": "The documents do not specify a CO2 limit.",
                 "declined": True, "correct": False, "precision_at_5": 0.4},
                {"id": "Q02", "category": "single_hop_factual", "answer": "Trip at 5 bar.", "declined": False,
                 "correct": True, "precision_at_5": 1.0}]
        record = {"run_id": "eval_20260101_000001", "query_sha": "old", "queries": old,
                  "results": {"vector": [dict(r) for r in rows]}}
        new = [_q("Q01", False, [], ["SOP.md"]), old[1]]
        out = evaluation.rescore(record, new)
        q1, q2 = out["results"]["vector"]
        self.assertTrue(q1["correct"])                 # now a correct "not specified"
        self.assertIsNone(q1["precision_at_5"])        # its relevant documents changed
        self.assertEqual(q2["precision_at_5"], 1.0)    # untouched question keeps everything
        self.assertEqual(out["rescored"]["changed"], ["Q01"])
        self.assertFalse(record["results"]["vector"][0]["correct"])   # the original run is not modified
        self.assertEqual(out["summary"]["vector"]["overall"]["correct"], 1.0)


if __name__ == "__main__":
    unittest.main()
