"""Background jobs: model-written chat titles, their settings, and the token ratio."""

from __future__ import annotations

import json
import unittest
from unittest import mock

from app.db import audit_store, chat_store
from app.services import background_models, chat_service, session_titles, token_calibration
from app.services.query_pipeline import local_model

LOCAL = [{"name": "small:1b"}, {"name": "big:8b"}]


def _chat(turns: int = 1, *, ephemeral: bool = False) -> str:
    sid = chat_service.create_session(ephemeral=ephemeral)["session_id"]
    for i in range(turns):
        chat_service.add_user_message(sid, f"hi {i}")
        chat_service.add_assistant_message(sid, f"Pressure is normal {i} [S1].")
    return sid


class TitleJobTest(unittest.TestCase):
    def setUp(self) -> None:
        background_models.CONFIG_PATH.unlink(missing_ok=True)

    def ask(self, title: str):  # noqa: ANN201
        return mock.patch.object(local_model, "ask_json", return_value=({"title": title}, "small:1b"))

    def test_first_message_is_the_placeholder(self) -> None:
        sid = chat_service.create_session()["session_id"]
        chat_service.add_user_message(sid, "hi")
        session = chat_store.get_session(sid)
        self.assertEqual((session["title"], session["title_source"]), ("Hi", "first_message"))

    def test_model_title_replaces_the_placeholder(self) -> None:
        sid = _chat()
        with self.ask("Reactor pressure check"):
            self.assertEqual(session_titles.retitle(sid)["title"], "Reactor pressure check")
        session = chat_store.get_session(sid)
        self.assertEqual((session["title"], session["title_source"], session["title_turns"]),
                         ("Reactor pressure check", "model", 1))

    def test_values_are_stripped_from_titles(self) -> None:
        sid = _chat()
        with self.ask("CO2 spike at 10:30 reaching 1020 ppm."):
            self.assertEqual(session_titles.retitle(sid)["title"], "CO2 spike at 10:30")

    def test_operator_title_is_never_overwritten(self) -> None:
        sid = _chat()
        chat_service.update_session(sid, title="Mine")
        with self.ask("Something else"):
            self.assertIsNone(session_titles.retitle(sid))
        self.assertEqual(chat_store.get_session(sid)["title_source"], "user")
        # …unless the operator asks for a new one.
        with self.ask("Something else"):
            self.assertEqual(session_titles.retitle(sid, force=True)["title"], "Something else")

    def test_rename_during_the_model_call_wins(self) -> None:
        sid = _chat()

        def rename_meanwhile(*_a, **_k):  # noqa: ANN002, ANN003, ANN202
            chat_service.update_session(sid, title="Typed while waiting")
            return {"title": "Model title"}, "small:1b"

        with mock.patch.object(local_model, "ask_json", side_effect=rename_meanwhile):
            self.assertIsNone(session_titles.retitle(sid))
        self.assertEqual(chat_store.get_session(sid)["title"], "Typed while waiting")

    def test_refreshes_after_n_more_turns(self) -> None:
        background_models.CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        background_models.CONFIG_PATH.write_text(json.dumps({"title": {"refresh_every": 2}}))
        sid = _chat()
        with self.ask("First"):
            session_titles.retitle(sid)
        chat_service.add_user_message(sid, "more")
        chat_service.add_assistant_message(sid, "ok")
        with self.ask("Second"):
            self.assertIsNone(session_titles.retitle(sid))  # one turn on, not two
        chat_service.add_user_message(sid, "more again")
        chat_service.add_assistant_message(sid, "ok")
        with self.ask("Second"):
            self.assertEqual(session_titles.retitle(sid)["title"], "Second")

    def test_no_title_before_an_answer_in_incognito_or_in_first_message_mode(self) -> None:
        with self.ask("Nope") as asked:
            unanswered = chat_service.create_session()["session_id"]
            chat_service.add_user_message(unanswered, "hi")
            self.assertIsNone(session_titles.retitle(unanswered))
            self.assertIsNone(session_titles.retitle(_chat(ephemeral=True)))
            background_models.CONFIG_PATH.write_text(json.dumps({"title": {"mode": "first_message"}}))
            self.assertIsNone(session_titles.retitle(_chat()))
            asked.assert_not_called()

    def test_configured_model_is_the_one_asked(self) -> None:
        background_models.CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        background_models.CONFIG_PATH.write_text(json.dumps({"title": {"model": "big:8b"}}))
        with mock.patch.object(background_models, "local_models", return_value=LOCAL), \
             self.ask("Named") as asked:
            session_titles.retitle(_chat())
        self.assertEqual(asked.call_args.kwargs["tag"], "big:8b")


class BackgroundModelsConfigTest(unittest.TestCase):
    def setUp(self) -> None:
        background_models.CONFIG_PATH.unlink(missing_ok=True)

    def test_defaults(self) -> None:
        config = background_models.read()
        self.assertEqual(config["title"], {"mode": "model", "model": "auto", "refresh_every": 4})
        self.assertEqual(config["summary"], {"model": "auto"})

    def test_write_merges_and_validates(self) -> None:
        with mock.patch.object(background_models, "local_models", return_value=LOCAL):
            written = background_models.write({"title": {"model": "big:8b"}})
            self.assertEqual(written["title"]["model"], "big:8b")
            self.assertEqual(written["title"]["refresh_every"], 4)
            with self.assertRaises(ValueError):
                background_models.write({"summary": {"model": "gpt-oss:120b-cloud"}})
            with self.assertRaises(ValueError):
                background_models.write({"title": {"refresh_every": -1}})
            with self.assertRaises(ValueError):
                background_models.write({"title": {"mode": "poem"}})

    def test_uninstalled_model_falls_back_to_the_chat_model(self) -> None:
        background_models.CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        background_models.CONFIG_PATH.write_text(json.dumps({"summary": {"model": "gone:3b"}}))
        with mock.patch.object(background_models, "local_models", return_value=LOCAL):
            self.assertIsNone(background_models.configured_tag("summary"))


class TokenCalibrationTest(unittest.TestCase):
    def setUp(self) -> None:
        token_calibration.reset_cache()

    def test_median_of_measured_rows_for_the_model(self) -> None:
        for chars, tokens in ((3500, 1000), (3600, 1000), (3400, 1000), (3550, 1000), (3450, 1000),
                              (40000, 1000)):  # the last is implausible and ignored
            audit_store.log("model_logs", query_id="q_cal", model_name="cal:1b", source="chat",
                            status="ok", prompt_chars=chars, prompt_token_count=tokens)
        got = token_calibration.calibration("cal:1b")
        self.assertEqual((got["source"], got["samples"], got["chars_per_token"]), ("model", 5, 3.5))

    def test_default_until_there_is_data(self) -> None:
        got = token_calibration.calibration("never-seen:1b")
        self.assertIn(got["source"], ("pooled", "default"))
        if got["source"] == "default":
            self.assertEqual(got["chars_per_token"], token_calibration.DEFAULT)

    def test_budget_is_counted_in_the_calibrated_ratio(self) -> None:
        sid = _chat(3)
        with mock.patch.object(token_calibration, "calibration",
                               return_value={"chars_per_token": 2.0, "source": "model", "samples": 9}):
            window = chat_service.build_context(sid)
        self.assertEqual(window.chars_per_token, 2.0)
        self.assertEqual(window.estimated_tokens,
                         sum(max(1, int(len(m["content"]) / 2.0)) for m in window.messages))


if __name__ == "__main__":
    unittest.main()
