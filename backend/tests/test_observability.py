"""M7: the Observability page's figures — sources, ranges, percentiles and the empty case."""

from __future__ import annotations

import json
import sqlite3
import unittest
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.db import audit_store
from app.db.paths import AUDIT_DB
from app.main import app
from app.system import observability

NOW = datetime.now(timezone.utc)
PASSED = json.dumps({"passed": True, "cited": True})


def ago(**delta: float) -> str:
    return (NOW - timedelta(**delta)).replace(microsecond=0).isoformat()


def turn(qid: str, at: str, ms: int, **extra: object) -> None:
    audit_store.log("conversation_logs", query_id=qid, timestamp=at, total_latency_ms=ms,
                    user_query=f"question {qid}", **extra)


class ObservabilityTest(unittest.TestCase):
    def setUp(self) -> None:
        audit_store.init_db()
        with sqlite3.connect(AUDIT_DB) as conn:
            for table in audit_store.LOG_TABLES:
                conn.execute(f"DELETE FROM {table}")  # noqa: S608 — fixed names, throwaway test DB

    def seed(self) -> None:
        turn("grounded", ago(hours=1), 1000, validation_json=PASSED)
        audit_store.log("model_logs", query_id="grounded", timestamp=ago(hours=1), model_name="m",
                        source="chat", status="ok", completion_token_count=40, generation_ms=800, prefill_ms=100)
        audit_store.log("tool_logs", query_id="grounded", timestamp=ago(hours=1), tool_name="search_corpus",
                        status="ok", latency_ms=120)
        audit_store.log("rag_logs", query_id="grounded", timestamp=ago(hours=1), retrieval_latency_ms=200)
        turn("refused", ago(hours=2), 3000, guard_reason="control")
        turn("failed", ago(days=3), 5000, error_message="boom")
        audit_store.log("error_logs", error_id="e1", query_id="failed", timestamp=ago(days=3), message="boom")
        audit_store.log("error_logs", error_id="e2", timestamp=ago(days=3), message="startup")
        turn("evaluated", ago(hours=1), 9000, validation_json=PASSED)
        audit_store.log("model_logs", query_id="evaluated", timestamp=ago(hours=1), model_name="m", source="eval")
        audit_store.log("model_logs", query_id="bench", timestamp=ago(hours=1), model_name="b", source="benchmark")

    def test_chat_over_everything(self) -> None:
        self.seed()
        d = observability.report("all", "chat")
        h = d["headline"]
        self.assertEqual(h["turns"], 3)  # the eval turn is not chat
        self.assertEqual((h["p50_ms"], h["p95_ms"]), (3000, 5000))
        self.assertEqual((h["refused"], h["errors"], h["grounded"], h["checked"]), (1, 1, 1, 1))
        self.assertEqual(d["tools"][0]["name"], "search_corpus")
        self.assertEqual(d["models"], [{"name": "m", "calls": 1, "failed": 0, "ttft_p50_ms": None,
                                        "tokens_per_s_p50": 50, "total_p50_ms": None}])
        self.assertEqual(len(d["errors"]), 2)  # a turn's error, and one with no turn
        self.assertEqual(d["slowest"][0]["query_id"], "failed")
        # Averages per turn, so they sum back to the logged totals whichever days the turns fall on.
        total = lambda phase: sum(p[phase] * p["turns"] for p in d["series"] if p["turns"])  # noqa: E731
        self.assertEqual((total("retrieval"), total("generation"), total("prefill")), (200, 800, 100))

    def test_range_and_sources(self) -> None:
        self.seed()
        day = observability.report("24h", "chat")
        self.assertEqual((day["headline"]["turns"], day["unit"]), (2, "hour"))
        self.assertIn(len(day["series"]), (24, 25))  # every hour, empty ones too
        evals = observability.report("all", "eval")
        self.assertEqual((evals["headline"]["turns"], evals["errors"]), (1, []))
        bench = observability.report("all", "benchmark")
        self.assertEqual((bench["headline"]["turns"], bench["series"]), (0, []))
        self.assertEqual([m["name"] for m in bench["models"]], ["b"])

    def test_empty_log(self) -> None:
        d = observability.report("all", "chat")
        self.assertEqual((d["headline"]["turns"], d["headline"]["p50_ms"], d["series"]), (0, None, []))

    def test_endpoint_rejects_unknown_range(self) -> None:
        client = TestClient(app)
        self.assertEqual(client.get("/api/system/observability?range=1y").status_code, 422)
        self.assertEqual(client.get("/api/system/observability?range=7d&source=eval").status_code, 200)


if __name__ == "__main__":
    unittest.main()
