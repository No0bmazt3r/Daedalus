"""The Forge's benchmark table, exported for the report."""

from __future__ import annotations

import unittest
from unittest import mock

from app.db import audit_store
from app.services import benchmark, forge


class BenchmarkExportTest(unittest.TestCase):
    def test_rates_come_from_engine_counters_beside_the_estimate(self) -> None:
        audit_store.log(
            "model_logs", query_id="bench_export_test", model_name="m-export:1b", source="benchmark",
            status="ok", prompt_token_count=2000, completion_token_count=100,
            time_to_first_token_ms=900, total_inference_ms=3000, prefill_ms=800, generation_ms=2000,
        )
        estimate = {"rows": [{"tag": "m-export:1b", "speed": {"tokens_per_sec": 60.0},
                              "estimate": {"total_bytes": 2 * 1024**3}}]}
        with mock.patch.object(forge, "models", return_value=estimate):
            row = next(r for r in benchmark.history() if r["model"] == "m-export:1b")
            csv_text = benchmark.export("csv")
            md_text = benchmark.export("md")
        self.assertEqual((row["prefill_tok_s"], row["generation_tok_s"]), (2500.0, 50.0))
        self.assertEqual((row["estimated_tok_s"], row["estimated_memory_gb"]), (60.0, 2.0))
        self.assertTrue(csv_text.startswith(",".join(benchmark.EXPORT_COLUMNS)))
        self.assertIn("| m-export:1b | local |", md_text)


if __name__ == "__main__":
    unittest.main()
