"""The evaluation harness — query-set validation, scoring, arms, timeouts, aborts.

No model runs here: `inference.answer_stream` and `_ask` are replaced, so what
is tested is the harness's own logic (docs/EVALUATION.md).
"""

from __future__ import annotations

import contextvars
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from app.services import evaluation, inference, rag_config

QUERY_SET = """
- id: Q01
  category: single_hop_factual
  question: What is the absorber setpoint?
  expect:
    answerable: true
    key_facts: ["40 ?°C", "absorber"]
    relevant_documents: ["sop_a.pdf"]
- id: Q02
  category: out_of_corpus
  question: Who won the 1998 World Cup?
  expect:
    answerable: false
"""


def query(answerable: bool = True, facts: list[str] | None = None, **expect: list[str]) -> dict:
    return {
        "id": "Q", "category": "single_hop_factual" if answerable else "out_of_corpus",
        "question": "q",
        "expect": {"answerable": answerable, "key_facts": facts or [], "relevant_documents": [],
                   "relevant_nodes": [], **expect},
    }


def asked(answer: str) -> dict:
    return {"result": {"answer": answer, "query_id": "q_1"}, "error": None, "wall_ms": 10}


class QuerySetTest(unittest.TestCase):
    def _write(self, text: str) -> Path:
        path = Path(tempfile.mkdtemp()) / "queries.yaml"
        path.write_text(text, encoding="utf-8")
        return path

    def test_a_valid_set_loads(self) -> None:
        queries = evaluation.load_queries(self._write(QUERY_SET))
        self.assertEqual([q["id"] for q in queries], ["Q01", "Q02"])
        self.assertEqual(queries[0]["language"], "en")

    def test_every_problem_is_listed_at_once(self) -> None:
        bad = """
- id: Q01
  category: nonsense
  question: a
  expect: {answerable: true, key_facts: ["(unclosed"]}
- id: Q01
  category: out_of_corpus
  question: b
  expect: {answerable: true}
"""
        with self.assertRaises(evaluation.EvalError) as caught:
            evaluation.load_queries(self._write(bad))
        message = str(caught.exception)
        self.assertIn("category must be one of", message)
        self.assertIn("not a valid pattern", message)
        self.assertIn("duplicate id", message)
        self.assertIn("out_of_corpus question must have answerable: false", message)


class ScoreTest(unittest.TestCase):
    def test_answerable_needs_every_fact(self) -> None:
        q = query(facts=["40 ?°C", "absorber"])
        full = evaluation.score(q, asked("The absorber runs at 40 °C."), {})
        self.assertTrue(full["correct"])
        self.assertEqual(full["fact_recall"], 1.0)
        half = evaluation.score(q, asked("It runs at 40°C."), {})
        self.assertFalse(half["correct"])
        self.assertEqual(half["fact_recall"], 0.5)
        self.assertEqual(half["facts_missing"], ["absorber"])

    def test_declining_an_answerable_question_is_a_false_refusal(self) -> None:
        out = evaluation.score(query(facts=["x"]), asked("That information is not available."), {})
        self.assertTrue(out["declined"])
        self.assertTrue(out["false_refusal"])
        self.assertFalse(out["correct"])

    def test_out_of_corpus_is_correct_only_when_declined(self) -> None:
        q = query(answerable=False)
        self.assertTrue(evaluation.score(q, asked("I don't have any information on that."), {})["correct"])
        self.assertFalse(evaluation.score(q, asked("France won it."), {})["correct"])

    def test_the_validator_fallback_counts_as_declining(self) -> None:
        out = evaluation.score(query(answerable=False), asked(evaluation._fallback()), {})
        self.assertTrue(out["declined"])
        self.assertTrue(out["fallback"])

    def test_an_error_without_an_answer_is_wrong(self) -> None:
        out = evaluation.score(query(), {"result": None, "error": "timed out", "wall_ms": 1}, {})
        self.assertFalse(out["correct"])
        self.assertEqual(out["error"], "timed out")

    def test_vector_retrieval_metrics(self) -> None:
        files = {"c1": "other.pdf", "c2": "SOP_A.pdf", "c3": "sop_b.pdf", "c4": "other.pdf"}
        rag = {"track": "vector", "retrieved_chunk_ids": json.dumps(list(files)),
               "retrieved_origins": json.dumps(["rig", "reference", "reference", "reference"])}
        expect = query(relevant_documents=["sop_a.pdf", "sop_b.pdf"])["expect"]
        with mock.patch.object(evaluation, "_chunk_files", return_value=files):
            out = evaluation._retrieval(rag, expect)
        self.assertAlmostEqual(out["precision_at_3"], 2 / 3)
        self.assertAlmostEqual(out["precision_at_5"], 2 / 4)  # only four retrieved
        self.assertEqual(out["recall_at_5"], 1.0)
        self.assertEqual(out["mrr"], 0.5)  # first relevant at rank 2
        self.assertEqual(out["rig_share"], 0.25)

    def test_graph_retrieval_is_a_set(self) -> None:
        rag = {"track": "graph", "retrieved_chunk_ids": json.dumps(["A", "B", "C"]),
               "traversal_path": json.dumps({"hop_count": 2, "mode": "agent", "stop_reason": "answered"})}
        out = evaluation._retrieval(rag, query(relevant_nodes=["A", "D"])["expect"])
        self.assertAlmostEqual(out["node_precision"], 1 / 3)
        self.assertEqual(out["node_recall"], 0.5)
        self.assertEqual(out["hops"], 2)
        self.assertNotIn("mrr", out)


class SummariseTest(unittest.TestCase):
    def test_rates_skip_unknowns_and_latency_uses_nearest_rank(self) -> None:
        rows = [{"correct": True, "total_ms": t} for t in (100, 200, 300, 400)] + [
            {"correct": False, "total_ms": 1000, "hallucination": None},
        ]
        s = evaluation.summarise(rows)
        self.assertEqual(s["correct"], 0.8)
        self.assertIsNone(s["hallucination"])
        self.assertEqual(s["latency_total"]["p50"], 300)
        self.assertEqual(s["latency_total"]["p95"], 1000)


class ArmTest(unittest.TestCase):
    def test_the_override_is_scoped_to_its_context(self) -> None:
        configured = rag_config.resolve()
        seen: dict[str, str] = {}
        with rag_config.arm("graph", "walk"):
            self.assertEqual(rag_config.resolve(), "graph")
            self.assertEqual(rag_config.graph_settings()["mode"], "walk")
            # A thread that copies the context (as the chat worker does) sees it…
            copied = threading.Thread(target=contextvars.copy_context().run,
                                      args=(lambda: seen.update(copied=rag_config.resolve()),))
            # …and one that does not — someone using the app meanwhile — does not.
            plain = threading.Thread(target=lambda: seen.update(plain=rag_config.resolve()))
            for t in (copied, plain):
                t.start()
                t.join()
        self.assertEqual(seen, {"copied": "graph", "plain": configured})
        self.assertEqual(rag_config.resolve(), configured)

    def test_an_unknown_arm_is_refused(self) -> None:
        with self.assertRaises(ValueError), rag_config.arm("keyword"):  # type: ignore[arg-type]
            pass


class AskTest(unittest.TestCase):
    """`_ask` against a fake stream — the deadline, the drain, the arm."""

    def _stream(self, *, delay: float, seen: dict | None = None):
        def fake(session_id: str, question: str, *, evaluation: bool = False):
            if seen is not None:
                seen["track"] = rag_config.resolve()
                seen["evaluation"] = evaluation
            time.sleep(delay)  # silent — no event before the deadline
            yield {"phase": "done", "result": {"answer": "late", "query_id": "q_1"}}
        return fake

    def test_the_arm_reaches_the_stream(self) -> None:
        seen: dict = {}
        with mock.patch.object(inference, "answer_stream", self._stream(delay=0, seen=seen)), \
                rag_config.arm("graph", "agent"):
            out = evaluation._ask("q")
        self.assertEqual(out["result"]["answer"], "late")
        self.assertEqual(seen, {"track": "graph", "evaluation": True})

    def test_a_silent_model_times_out_and_is_waited_for(self) -> None:
        with mock.patch.object(inference, "answer_stream", self._stream(delay=0.4)), \
                mock.patch.object(evaluation, "QUESTION_TIMEOUT_S", 0.1), \
                mock.patch.object(evaluation, "DRAIN_TIMEOUT_S", 2):
            started = time.perf_counter()
            out = evaluation._ask("q")
            elapsed = time.perf_counter() - started
        self.assertIn("timed out", out["error"])
        self.assertIsNone(out["result"])  # a late answer is not credited
        self.assertLess(out["wall_ms"], 300)
        self.assertGreaterEqual(elapsed, 0.35)  # but the turn was let finish
        self.assertFalse(out["still_running"])

    def test_a_turn_that_never_ends_is_reported(self) -> None:
        with mock.patch.object(inference, "answer_stream", self._stream(delay=1)), \
                mock.patch.object(evaluation, "QUESTION_TIMEOUT_S", 0.05), \
                mock.patch.object(evaluation, "DRAIN_TIMEOUT_S", 0.05):
            out = evaluation._ask("q")
        self.assertTrue(out["still_running"])


class RunTest(unittest.TestCase):
    def setUp(self) -> None:
        root = Path(tempfile.mkdtemp())
        (root / "queries.yaml").write_text(QUERY_SET, encoding="utf-8")
        self.runs = root / "runs"
        self.patches = [
            mock.patch.object(evaluation, "QUERY_PATH", root / "queries.yaml"),
            mock.patch.object(evaluation, "RUNS_DIR", self.runs),
            mock.patch.object(evaluation, "QUESTION_PAUSE_S", 0),
            mock.patch.object(evaluation, "snapshot", return_value={"fingerprint": "f"}),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self) -> None:
        for p in self.patches:
            p.stop()

    def _saved(self) -> dict:
        [folder] = list(self.runs.iterdir())
        return json.loads((folder / "run.json").read_text(encoding="utf-8"))

    def test_an_unfrozen_official_run_is_refused(self) -> None:
        with self.assertRaises(evaluation.EvalError):
            evaluation.run(arms=["vector"])

    def test_a_complete_practice_run(self) -> None:
        with mock.patch.object(evaluation, "_ask", return_value=asked("The absorber is at 40 °C.")):
            record = evaluation.run(arms=["vector", "graph-walk"], practice=True)
        self.assertEqual(record["status"], "complete")
        self.assertEqual(self._saved()["summary"]["vector"]["overall"]["n"], 2)
        report = evaluation.report_markdown(record)
        self.assertIn("PRACTICE RUN", report)
        self.assertNotIn("Incomplete", report)

    def test_a_crash_keeps_what_was_answered(self) -> None:
        calls = iter([asked("The absorber is at 40 °C."), RuntimeError("ollama went away")])

        def flaky(_question: str) -> dict:
            step = next(calls)
            if isinstance(step, Exception):
                raise step
            return step

        with mock.patch.object(evaluation, "_ask", side_effect=flaky), \
                self.assertRaises(evaluation.EvalError) as caught:
            evaluation.run(arms=["vector"], practice=True)
        self.assertIn("aborted after 1 of 2", str(caught.exception))
        saved = self._saved()
        self.assertEqual(saved["status"], "aborted")
        self.assertIn("ollama went away", saved["abort_reason"])
        self.assertEqual(len(saved["results"]["vector"]), 1)
        self.assertIn("Incomplete — aborted", evaluation.report_markdown(saved))
        self.assertEqual(evaluation.list_runs()[0]["abort_reason"], saved["abort_reason"])

    def test_a_stuck_turn_stops_the_run(self) -> None:
        stuck = {**asked(""), "result": None, "error": "timed out after 180s", "still_running": True}
        with mock.patch.object(evaluation, "_ask", return_value=stuck), \
                self.assertRaises(evaluation.EvalError):
            evaluation.run(arms=["vector"], practice=True)
        saved = self._saved()
        self.assertEqual(saved["status"], "aborted")
        self.assertIn("still running", saved["abort_reason"])

    def test_retrieval_only_calls_the_arms_tool_and_never_the_model(self) -> None:
        from app.db import audit_store  # noqa: PLC0415
        from app.services import agent_tools  # noqa: PLC0415

        called: list[tuple[str, dict]] = []

        def fake_call(name: str, arguments: dict, query_id: str | None = None, **_: object) -> dict:
            called.append((name, arguments))
            audit_store.log("rag_logs", query_id=query_id, track="vector",
                            retrieved_chunk_ids=json.dumps([]), retrieval_latency_ms=7)
            return {"ok": True}

        with mock.patch.object(agent_tools, "call", side_effect=fake_call), \
                mock.patch.object(evaluation, "_ask", side_effect=AssertionError("the model was asked")):
            record = evaluation.run(arms=["vector"], retrieval_only=True)
        self.assertTrue(record["practice"])  # never official, even unasked
        self.assertEqual(called[0][0], "search_corpus")
        self.assertIn("top_k", called[0][1])
        row = record["results"]["vector"][0]
        self.assertEqual(row["retrieval_ms"], 7)
        self.assertNotIn("correct", row)
        self.assertIn("Retrieval only", evaluation.report_markdown(record))

    def test_ctrl_c_saves_and_still_interrupts(self) -> None:
        with mock.patch.object(evaluation, "_ask", side_effect=KeyboardInterrupt), \
                self.assertRaises(KeyboardInterrupt):
            evaluation.run(arms=["vector"], practice=True)
        self.assertEqual(self._saved()["abort_reason"], "interrupted")

    def test_a_killed_runs_checkpoint_still_reports(self) -> None:
        record = {"run_id": "eval_20261001_120000", "arms": ["vector"], "status": "running",
                  "queries": [query()], "results": {"vector": [{"id": "Q", "category": "single_hop_factual",
                                                                "correct": True}]}}
        report = evaluation.report_markdown(record)
        self.assertIn("Incomplete — running", report)
        self.assertIn("100%", report)

    def test_compare_is_an_ablation_table_and_flags_other_differences(self) -> None:
        def record(run_id: str, size: int, correct: bool, model: str = "m") -> dict:
            return {"run_id": run_id, "arms": ["vector"], "query_sha": "q", "practice": True,
                    "snapshot": {"chat_model": {"tag": model},
                                 "chunking": [{"strategy": "recursive", "chunk_size": size,
                                               "chunk_overlap": 200, "chunks": 10}]},
                    "results": {"vector": [{"id": "Q", "category": "single_hop_factual", "correct": correct}]}}

        table = evaluation.compare_markdown([record("A", 1500, True), record("B", 800, False)])
        self.assertIn("recursive 1500/200", table)
        self.assertIn("| Correct | 100% | 0% |", table)
        self.assertNotIn("Not a clean ablation", table)
        dirty = evaluation.compare_markdown([record("A", 1500, True), record("B", 800, False, model="other")])
        self.assertIn("these also differ: chat_model", dirty)


if __name__ == "__main__":
    unittest.main()
