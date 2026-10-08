"""Test doubles shared across folders: a fake Ollama that streams a scripted answer."""

from __future__ import annotations

import contextlib
import json


class FakeResponse:
    status_code = 200

    def __init__(self, text: str) -> None:
        self.text = text

    def read(self) -> bytes:
        return b""

    def iter_lines(self):  # noqa: ANN201
        for word in self.text.split(" "):
            yield json.dumps({"message": {"content": word + " "}})
        yield json.dumps({"done": True, "prompt_eval_count": 100, "eval_count": 10})


class FakeHttpx:
    # `ollama_client._timeout` builds one of these before every call.
    Timeout = staticmethod(lambda **_: None)

    def __init__(self, text: str) -> None:
        self.text = text
        self.payloads: list[dict] = []

    @contextlib.contextmanager
    def stream(self, method, url, json=None, timeout=None):  # noqa: ANN001, ANN201, A002
        self.payloads.append(json)
        yield FakeResponse(self.text)
