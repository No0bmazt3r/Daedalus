"""`cli_eval batch`: pulls what is missing, survives one model failing, always restores the pin. No model runs."""

import argparse
import unittest
from unittest import mock

from app import cli_eval
from app.evaluation import evaluation
from app.forge import model_config


class BatchTest(unittest.TestCase):
    def test_batch(self):
        model_config.write(mode="auto", updated_by="test")
        pinned_during: list[str] = []

        def fake_run(**kwargs):
            tag = model_config.read()["pinned"]["tag"]
            pinned_during.append(tag)
            if tag == "bad:1b":
                raise evaluation.EvalError("model crashed")
            return {"run_id": f"eval_{tag.replace(':', '_')}"}

        args = argparse.Namespace(models="a:1b,bad:1b,c:1b", official=False, rerun_reason=None, background=False)
        with mock.patch("app.forge.ollama_client.list_models", return_value=[{"name": "a:1b"}]), \
             mock.patch("app.forge.ollama_client.pull", return_value=iter([{"status": "success"}])) as pull, \
             mock.patch("app.forge.ollama_client.can_answer", return_value=True), \
             mock.patch.object(evaluation, "run", side_effect=fake_run), \
             mock.patch.object(evaluation, "get_run", side_effect=lambda r: {"run_id": r}), \
             mock.patch.object(evaluation, "compare_markdown", return_value="# cmp\n"):
            code = cli_eval._batch(args)

        self.assertEqual(code, 0)
        self.assertEqual(pinned_during, ["a:1b", "bad:1b", "c:1b"])          # each model pinned in turn
        self.assertEqual([c.args[0] for c in pull.call_args_list], ["bad:1b", "c:1b"])  # only missing ones pulled
        self.assertEqual(model_config.read()["mode"], "auto")                # the operator's choice is back
        summaries = list(evaluation.RUNS_DIR.glob("batch_*.md"))
        self.assertTrue(summaries and summaries[-1].read_text() == "# cmp\n")


if __name__ == "__main__":
    unittest.main()
