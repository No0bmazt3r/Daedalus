"""M5 steps 5–10: time resolution, planning, evidence and validation."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from app.services import orchestration, query_pipeline
from app.services.orchestration import numbers, timeparse, validator

from . import fixtures

NOW = datetime(2026, 9, 12, 12, 0, 30, tzinfo=timezone.utc)
LATEST = datetime(2026, 9, 12, 11, 59, tzinfo=timezone.utc)


def iso(value: datetime | None) -> str | None:
    return value.astimezone(timezone.utc).isoformat() if value else None


class TimeparseTest(unittest.TestCase):
    def resolve(self, text: str, **kw):  # noqa: ANN003, ANN201
        return timeparse.resolve(text, now=kw.get("now", NOW), latest=kw.get("latest", LATEST))

    def test_last_hour(self) -> None:
        s = self.resolve("average co2 over the last hour")
        self.assertEqual((s.kind, iso(s.start), iso(s.end)),
                         ("window", "2026-09-12T11:00:30+00:00", "2026-09-12T12:00:30+00:00"))

    def test_last_n_minutes(self) -> None:
        s = self.resolve("max temperature in the past 15 minutes")
        self.assertEqual(iso(s.start), "2026-09-12T11:45:30+00:00")

    def test_point(self) -> None:
        s = self.resolve("what was co2 at 10:30?")
        self.assertEqual((s.kind, iso(s.point)), ("point", "2026-09-12T10:30:00+00:00"))

    def test_point_later_than_now_is_yesterday(self) -> None:
        s = self.resolve("co2 at 23:00")
        self.assertEqual(iso(s.point), "2026-09-11T23:00:00+00:00")

    def test_between(self) -> None:
        s = self.resolve("between 10:00 and 10:45")
        self.assertEqual((iso(s.start), iso(s.end)),
                         ("2026-09-12T10:00:00+00:00", "2026-09-12T10:45:00+00:00"))

    def test_between_rolls_back_as_a_pair(self) -> None:
        s = self.resolve("between 23:00 and 23:30")
        self.assertEqual((iso(s.start), iso(s.end)),
                         ("2026-09-11T23:00:00+00:00", "2026-09-11T23:30:00+00:00"))

    def test_named_part_of_day_is_the_most_recent(self) -> None:
        s = self.resolve("this afternoon", now=datetime(2026, 9, 13, 1, 0, tzinfo=timezone.utc),
                         latest=datetime(2026, 9, 13, 1, 0, tzinfo=timezone.utc))
        self.assertEqual(iso(s.start), "2026-09-12T12:00:00+00:00")
        self.assertLess(s.start, s.end)

    def test_stopped_feed_anchors_to_the_last_reading(self) -> None:
        s = self.resolve("the last hour", now=datetime(2026, 9, 27, tzinfo=timezone.utc))
        self.assertTrue(s.anchored_to_data)
        self.assertEqual(iso(s.end), iso(LATEST))
        self.assertTrue(s.notes)

    def test_unplaceable_phrase_is_reported_not_guessed(self) -> None:
        s = self.resolve("max co2 during the last run")
        self.assertFalse(s.understood)
        self.assertEqual(s.phrase, "last run")


class PlannerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        fixtures.build()
        fixtures.set_track("vector")

    def plan(self, text: str):  # noqa: ANN201
        u = query_pipeline.understand(text, [], use_model=False)
        return orchestration.planner.plan(u, now=NOW)

    def tools(self, text: str) -> list[str]:
        return [c.tool for c in self.plan(text).calls]

    def test_intent_to_tools(self) -> None:
        self.assertEqual(self.tools("What is the CO2 level now?"), ["get_live_reading"])
        self.assertEqual(self.tools("What was the pressure at 10:30?"), ["get_live_reading"])
        self.assertEqual(self.tools("Average temperature over the last hour?"), ["get_trend"])
        self.assertEqual(self.tools("Was there an anomaly this morning?"), ["get_anomaly_summary"])
        self.assertEqual(self.tools("What should I do if the NDIR drifts?"), ["search_corpus"])
        self.assertEqual(self.tools("Why did CO2 spike at 10:30?"),
                         ["get_trend", "get_anomaly_summary", "search_corpus"])

    def test_retrieval_follows_the_track(self) -> None:
        fixtures.set_track("graph")
        try:
            self.assertEqual(self.tools("What should I do if the NDIR drifts?"), ["graph_walk"])
        finally:
            fixtures.set_track("vector")

    def test_live_reading_uses_the_named_sensor(self) -> None:
        call = self.plan("What is the CO2 level now?").calls[0]
        self.assertEqual(call.arguments, {"sensor": "co2_ppm"})

    def test_status_reads_every_sensor(self) -> None:
        self.assertEqual(self.plan("How is the reactor?").calls[0].arguments, {"sensor": "all"})

    def test_aggregation_from_the_question(self) -> None:
        call = self.plan("What was the highest CO2 in the last hour?").calls[0]
        self.assertEqual(call.arguments["aggregation"], "max")

    def test_why_at_a_point_reads_the_minutes_around_it(self) -> None:
        call = self.plan("Why did CO2 spike at 10:30?").calls[0]
        self.assertEqual((call.arguments["start_time"], call.arguments["end_time"]),
                         ("2026-09-12T10:15:00+00:00", "2026-09-12T10:45:00+00:00"))

    def test_unplaceable_time_asks(self) -> None:
        p = self.plan("What was the max CO2 during the last run?")
        self.assertTrue(p.clarify)
        self.assertEqual(p.calls, [])

    def test_missing_window_uses_a_stated_default(self) -> None:
        p = self.plan("Average temperature?")
        self.assertTrue(any("no time was given" in n for n in p.notes))


class EvidenceAndValidatorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        fixtures.build()
        u = query_pipeline.understand("Why did CO2 spike at 10:30?", [], use_model=False)
        fixtures.set_track("vector")
        plan = orchestration.planner.plan(u, now=NOW)
        # Retrieval is left out: no Chroma here, and the sensor side is what
        # the number checks are about.
        plan.calls = [c for c in plan.calls if c.tool != "search_corpus"]
        cls.pack = orchestration.evidence.build(orchestration.executor.execute(plan, None))
        cls.question = u.standalone

    def validate(self, answer: str, history=None):  # noqa: ANN001, ANN201
        return validator.validate(answer, self.pack, question=self.question, history=history)

    def test_empty_retrieval_is_announced(self) -> None:
        pack = orchestration.evidence.build([{
            "tool": "search_corpus", "ok": True, "status": "ok", "integrity": "corpus",
            "citable": True, "data": {"chunks": [], "track": "vector"}, "detail": "no passage matched",
        }])
        self.assertTrue(pack.no_documents)
        self.assertTrue(pack.render().startswith("NO DOCUMENTS FOUND"))
        self.assertFalse(self.pack.no_documents)  # no retrieval ran for that pack

    def test_pack_labels_and_numbers(self) -> None:
        self.assertIn("S1", self.pack.labels)
        self.assertIn("A1", self.pack.labels)
        self.assertIn(fixtures.co2(34), self.pack.numbers)

    def test_supported_answer_passes(self) -> None:
        v = self.validate(f"CO2 peaked at {fixtures.co2(34)} ppm [S1] during a recorded High CO2 anomaly [A2].")
        self.assertTrue(v.passed, v.reasons)
        self.assertTrue(validator.grounded(v, self.pack))

    def test_rounding_is_allowed(self) -> None:
        self.assertTrue(self.validate("CO2 peaked at about 984 ppm [S1].").passed)

    def test_invented_number_is_caught(self) -> None:
        v = self.validate("CO2 peaked at 1200 ppm [S1].")
        self.assertFalse(v.passed)
        self.assertEqual(v.unsupported, ["1200"])
        self.assertTrue(v.hallucination)

    def test_arithmetic_is_an_invented_number(self) -> None:
        # 984 − 450 = 534: true, and still not a number any tool reported.
        self.assertIn("534", self.validate("It rose by 534 ppm [S1].").unsupported)

    def test_stale_number_from_history_is_caught(self) -> None:
        history = [{"role": "assistant", "content": "[2026-09-12 09:00 UTC] CO2 was 612.4 ppm."}]
        v = self.validate("CO2 is 612.4 ppm [S1].", history=history)
        self.assertFalse(v.passed)
        self.assertEqual(v.stale, ["612.4"])
        self.assertIn("stale_history_number", v.reasons)

    def test_unknown_citation_is_caught(self) -> None:
        self.assertIn("unknown_citation", self.validate("See [S9].").reasons)

    def test_grouped_citations_are_each_checked(self) -> None:
        v = self.validate("See [S1, A1] and [A2; S9].")
        self.assertEqual(v.cited, ["A1", "A2", "S1", "S9"])
        self.assertEqual(v.unknown_citations, ["S9"])

    def test_loose_citation_shapes_are_normalised(self) -> None:
        cases = {
            "[EVIDENCE: S1] CO2 peaked.": "[S1] CO2 peaked.",
            "See [Source S1, A1].": "See [S1, A1].",
            "(S1) and (a2)": "[S1] and [A2]",
            "[S1 and A1]": "[S1, A1]",
            "Valve [ABV-1] and footnote [1]": "Valve [ABV-1] and footnote [1]",
        }
        for raw, want in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(validator.normalise_citations(raw), want)

    def test_normalised_citation_counts_as_grounded(self) -> None:
        text = validator.normalise_citations(f"[EVIDENCE: S1] CO2 peaked at {fixtures.co2(34)} ppm.")
        v = self.validate(text)
        self.assertTrue(v.passed, v.reasons)
        self.assertTrue(validator.grounded(v, self.pack))

    def test_reading_citation_must_support_its_sentence(self) -> None:
        # The shape seen live: a cited reading under an explanation nobody retrieved.
        v = self.validate("[S1] The CO2 sensor monitors capture efficiency at the outlet.")
        self.assertFalse(v.passed)
        self.assertIn("citation_mismatch", v.reasons)
        self.assertEqual(v.mismatched_citations, ["S1"])
        self.assertTrue(v.hallucination)

    def test_reading_citation_after_the_full_stop_is_attached_to_its_sentence(self) -> None:
        self.assertTrue(self.validate(f"CO2 peaked at {fixtures.co2(34)} ppm. [S1]").passed)

    def test_mode_word_counts_only_as_a_mode(self) -> None:
        live = orchestration.evidence.build(orchestration.executor.execute(
            orchestration.planner.plan(
                query_pipeline.understand("How is the reactor?", [], use_model=False), now=NOW),
            None))
        ok = validator.validate("The reactor is in Desorption mode [S1].", live)
        loose = validator.validate("Pressure matters for desorption processes [S2].", live)
        self.assertTrue(ok.passed, ok.reasons)
        self.assertIn("citation_mismatch", loose.reasons)

    def test_control_claim_is_caught(self) -> None:
        for text in ("I have opened ABV-1.", "I'll reduce the flow now.", "Done. The valve is now open."):
            with self.subTest(text=text):
                self.assertIn("control_claim", self.validate(text).reasons)

    def test_describing_a_procedure_is_not_a_control_claim(self) -> None:
        self.assertTrue(self.validate("The operator should close the isolation valve first [A2].").passed)

    def test_empty_answer_fails(self) -> None:
        self.assertEqual(self.validate("   ").reasons, ["empty"])

    def test_identifiers_and_times_are_not_quantities(self) -> None:
        found = [n.text for n in numbers.extract("ABV-1 and CO2 at 10:30 on 2026-09-12 [S1]; step 1.")]
        self.assertEqual(found, ["1"])  # "step 1." — a small integer, tolerated by the validator


if __name__ == "__main__":
    unittest.main()
