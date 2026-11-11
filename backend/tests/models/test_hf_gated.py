"""A gated Hugging Face GGUF: downloaded with HF_TOKEN, handed to Ollama as a blob, created under its tag."""

from __future__ import annotations

import hashlib
import json
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

from app.forge import hf_gated, ollama_client

GGUF = b"GGUF" + b"\0" * 4096
SEEN: dict[str, object] = {}


class _Fake(BaseHTTPRequestHandler):
    """Hugging Face and Ollama on one port."""

    def _send(self, code: int, body: bytes, kind: str = "application/json") -> None:
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.headers.get("Authorization") != "Bearer hf_good":
            return self._send(403, b"{}")
        if self.path.startswith("/api/models/meta/gated"):
            files = [{"rfilename": "m-Q8_0.gguf"}, {"rfilename": "m-Q4_K_M.gguf", "size": len(GGUF)},
                     {"rfilename": "README.md"}]
            return self._send(200, json.dumps({"siblings": files}).encode())
        if self.path == "/meta/gated/resolve/main/m-Q4_K_M.gguf":
            return self._send(200, GGUF, "application/octet-stream")
        self._send(404, b"{}")

    def do_POST(self) -> None:  # noqa: N802
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0)) if self.headers.get("Content-Length") \
            else _chunked(self.rfile)
        if self.path.startswith("/api/blobs/"):
            SEEN["blob"] = (self.path.rsplit("/", 1)[-1], body)
            return self._send(201, b"")
        if self.path == "/api/create":
            SEEN["create"] = json.loads(body)
            return self._send(200, b'{"status":"writing manifest"}\n{"status":"success"}\n', "application/x-ndjson")
        self._send(404, b"{}")

    def log_message(self, *_: object) -> None:
        pass


def _chunked(stream) -> bytes:  # type: ignore[no-untyped-def]
    out = b""
    while (size := int(stream.readline().strip() or b"0", 16)):
        out += stream.read(size)
        stream.readline()
    stream.readline()
    return out


class GatedPullTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), _Fake)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()

    def _patches(self, token: str):  # type: ignore[no-untyped-def]
        return (mock.patch.object(hf_gated, "HF", self.base),
                mock.patch.dict(os.environ, {"HF_TOKEN": token, "OLLAMA_BASE_URL": self.base}))

    def test_download_blob_and_create(self) -> None:
        a, b = self._patches("hf_good")
        with a, b:
            events = list(hf_gated.pull("hf.co/meta/gated:Q4_K_M"))
        self.assertTrue(events[-1]["done"])
        digest, body = SEEN["blob"]  # type: ignore[misc]
        self.assertEqual(body, GGUF)
        self.assertEqual(digest, "sha256:" + hashlib.sha256(GGUF).hexdigest())
        self.assertEqual(SEEN["create"], {"model": "hf.co/meta/gated:Q4_K_M",  # type: ignore[comparison-overlap]
                                          "files": {"m-Q4_K_M.gguf": digest}, "stream": True})

    def test_a_refused_token_says_to_accept_the_licence(self) -> None:
        a, b = self._patches("hf_bad")
        with a, b, self.assertRaises(hf_gated.GatedPullError) as caught:
            list(hf_gated.pull("hf.co/meta/gated:Q4_K_M"))
        self.assertIn("licence", str(caught.exception))

    def test_falls_back_only_for_hf_tags_with_a_token(self) -> None:
        failing = mock.patch.object(ollama_client, "pull", side_effect=ollama_client.OllamaError("401"))
        with failing, mock.patch.dict(os.environ, {"HF_TOKEN": ""}), self.assertRaises(ollama_client.OllamaError):
            list(hf_gated.pull_with_fallback("hf.co/meta/gated:Q4_K_M"))
        with failing, mock.patch.dict(os.environ, {"HF_TOKEN": "x"}), self.assertRaises(ollama_client.OllamaError):
            list(hf_gated.pull_with_fallback("llama3.2:1b"))

    def test_pick_file(self) -> None:
        files = [{"rfilename": "a-Q4_K_M-00001-of-00002.gguf"}, {"rfilename": "a-Q5_K_M.gguf"}]
        self.assertEqual(hf_gated.pick_file(files, "q5_k_m")["rfilename"], "a-Q5_K_M.gguf")
        with self.assertRaises(hf_gated.GatedPullError):
            hf_gated.pick_file(files, "Q4_K_M")


if __name__ == "__main__":
    unittest.main()
