"""The fit contract (`docs/MODEL_FIT.md`) — for embedders, and the shared rule.

The catalogue tests are the guard for models added later: an entry missing a
field the verdict needs fails here, so nothing reaches the Forge unjudged.
"""

from __future__ import annotations

import unittest
from unittest import mock

from app.services import embedding_models as em
from app.services import fit_verdict, reranker

GB = 1_000_000_000
ROOMY = {"available_bytes": 64 * GB, "total_bytes": 64 * GB, "cpu": "test"}


def row(tag: str, **kw: object) -> dict:
    base = {
        "tag": tag, "installed": False, "size_bytes": 300_000_000, "max_tokens": 2048,
        "compute_m": 110, "quality": 5, "languages": "English",
    }
    base.update(kw)
    return base


class CatalogueContractTest(unittest.TestCase):
    """Every model must carry what its verdict is computed from."""

    def test_every_embedding_entry_is_complete(self) -> None:
        entries = em.catalogue()
        self.assertGreater(len(entries), 0)
        for entry in entries:
            with self.subTest(model=entry.get("tag")):
                for key, kind in (("tag", str), ("label", str), ("dimensions", int), ("max_tokens", int),
                                  ("approx_bytes", int), ("params_m", (int, float)),
                                  ("compute_m", (int, float)), ("quality", int), ("languages", str),
                                  ("query_prefix", str), ("document_prefix", str), ("note", str)):
                    self.assertIsInstance(entry.get(key), kind, f"{key} missing or wrong type")
                self.assertTrue(entry["languages"].startswith(("English", "Multilingual")))
                self.assertLessEqual(entry["compute_m"], entry["params_m"])
                self.assertNotIn("recommended", entry, "recommendation is computed, never declared")

    def test_every_reranker_entry_is_complete(self) -> None:
        for model_id, entry in reranker.CATALOGUE.items():
            with self.subTest(model=model_id):
                for key in ("revision", "onnx", "size_bytes", "compute_m", "quantized", "quality",
                            "multilingual", "languages", "licence"):
                    self.assertIn(key, entry)


class SharedRuleTest(unittest.TestCase):
    def test_verdict_levels(self) -> None:
        v = fit_verdict.verdict
        self.assertEqual(v(memory_bytes=GB, available_bytes=8 * GB, latency_ms=10, budget_ms=100)[0], "safe")
        self.assertEqual(v(memory_bytes=5 * GB, available_bytes=8 * GB, latency_ms=10, budget_ms=100)[0], "marginal")
        self.assertEqual(v(memory_bytes=9 * GB, available_bytes=8 * GB, latency_ms=10, budget_ms=100)[0], "will_not_fit")
        self.assertEqual(v(memory_bytes=GB, available_bytes=8 * GB, latency_ms=150, budget_ms=100)[0], "marginal")
        self.assertEqual(v(memory_bytes=GB, available_bytes=8 * GB, latency_ms=400, budget_ms=100)[0], "will_not_fit")
        self.assertEqual(v(memory_bytes=GB, available_bytes=None, latency_ms=10, budget_ms=100)[0], "safe")

    def test_a_hard_failure_cannot_be_safe_anywhere(self) -> None:
        verdict, reasons = fit_verdict.verdict(memory_bytes=1, available_bytes=64 * GB, latency_ms=1,
                                               budget_ms=100, hard_failures=["window too short"])
        self.assertEqual(verdict, "will_not_fit")
        self.assertIn("window too short", reasons)

    def test_recommend_prefers_strongest_safe_then_least_over(self) -> None:
        judged = {"a": {"verdict": "safe", "latency_ms": 50}, "b": {"verdict": "safe", "latency_ms": 90},
                  "c": {"verdict": "marginal", "latency_ms": 200}}
        quality = {"a": 1, "b": 2, "c": 9}.__getitem__
        self.assertEqual(fit_verdict.recommend(["a", "b", "c"], judged, quality), "b")
        self.assertEqual(fit_verdict.recommend(["c"], judged, quality), "c")
        self.assertIsNone(fit_verdict.recommend([], judged, quality))


class EmbeddingFitTest(unittest.TestCase):
    def fit(self, rows: list[dict]) -> dict:
        with mock.patch.object(fit_verdict, "machine", return_value=ROOMY), \
             mock.patch.object(em, "_benchmarks", return_value={}):
            return em.fit(rows)

    def test_a_window_shorter_than_a_chunk_never_fits(self) -> None:
        judged = self.fit([row("short", max_tokens=256), row("long", max_tokens=2048)])
        self.assertEqual(judged["models"]["short"]["verdict"], "will_not_fit")
        self.assertIn("cut short", judged["models"]["short"]["reasons"][0])
        self.assertEqual(judged["models"]["long"]["verdict"], "safe")

    def test_recommends_strongest_safe_and_a_multilingual_one_for_malay(self) -> None:
        judged = self.fit([
            row("weak", quality=2),
            row("strong", quality=8),
            row("huge", quality=10, compute_m=50_000),  # far over the time budget
            row("multi", quality=4, languages="Multilingual (100+)"),
        ])
        self.assertEqual(judged["recommended"], {"english": "strong", "malay": "multi"})
        self.assertEqual(judged["models"]["huge"]["verdict"], "will_not_fit")

    def test_a_benchmark_replaces_the_estimate(self) -> None:
        bench = {"fast": {"ms": 12, "runs_ms": [12], "at": "now"}}
        with mock.patch.object(fit_verdict, "machine", return_value=ROOMY), \
             mock.patch.object(em, "_benchmarks", return_value=bench):
            judged = em.fit([row("fast", installed=True), row("other")])
        self.assertEqual((judged["models"]["fast"]["latency_ms"], judged["models"]["fast"]["latency_source"]),
                         (12, "measured"))
        self.assertEqual(judged["models"]["other"]["latency_source"], "estimated")

    def test_a_model_outside_the_catalogue_is_still_judged(self) -> None:
        judged = self.fit([row("pulled-by-hand", compute_m=None, quality=0, size_bytes=600_000_000)])
        self.assertGreater(judged["models"]["pulled-by-hand"]["latency_ms"], 0)

    def test_estimates_grow_with_model_size(self) -> None:
        self.assertLess(em.estimate_ms(21), em.estimate_ms(110))
        self.assertLess(em.estimate_ms(110), em.estimate_ms(6950))


if __name__ == "__main__":
    unittest.main()
