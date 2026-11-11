"""Settings → Search "Add to corpus": a link becomes a document, its URL kept."""

from __future__ import annotations

import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from app.blueprints import extraction, ingestion

PAGE = b"""<html><head><style>.x{}</style><script>track()</script></head><body>
<nav>Home | About</nav><h1>Amine foaming</h1><p>Antifoam is dosed when the
differential pressure across the absorber rises.</p><footer>(c) site</footer></body></html>"""


def setUpModule() -> None:
    from app.db import migrations  # noqa: PLC0415

    migrations.migrate("corpus")


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/paper":
            body, kind = PAGE, "text/html; charset=utf-8"
        elif self.path == "/image":
            body, kind = b"\x89PNG", "image/png"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_: object) -> None:
        pass


class AddFromUrlTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()

    def test_a_web_page_is_stored_as_its_readable_text_with_its_url(self) -> None:
        doc = ingestion.store_url(f"{self.base}/paper", max_bytes=1 << 20, title="Foaming")
        self.assertEqual(doc["source_url"], f"{self.base}/paper")
        self.assertEqual(doc["filename"], "paper.html")
        text = ingestion.read_text(doc).text
        self.assertIn("Antifoam is dosed", text)
        for noise in ("track()", "Home | About", "(c) site"):
            self.assertNotIn(noise, text)
        with self.assertRaises(ingestion.IngestionError):  # same bytes twice
            ingestion.store_url(f"{self.base}/paper", max_bytes=1 << 20)

    def test_unreadable_types_too_large_and_non_http_are_refused(self) -> None:
        for url, why in ((f"{self.base}/image", "image/png"), ("file:///etc/passwd", "http(s)"),
                         (f"{self.base}/missing", "404")):
            with self.assertRaises(ingestion.IngestionError) as caught:
                ingestion.store_url(url, max_bytes=1 << 20)
            self.assertIn(why, str(caught.exception))
        with self.assertRaises(ingestion.IngestionError):
            ingestion.store_url(f"{self.base}/paper", max_bytes=10)

    def test_html_text_keeps_paragraphs_apart(self) -> None:
        self.assertEqual(extraction.html_text("<p>a</p><p>b</p>").split(), ["a", "b"])


if __name__ == "__main__":
    unittest.main()
