"""MainUI's chat: behind the rig token, the same chats as the web UI, never an incognito one."""

from __future__ import annotations

import json
import unittest
from unittest import mock

from fastapi.testclient import TestClient

from app.chat import chat_service, inference
from app.main import app
from app.db import paths
from app.system import rig_link


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class RigChatTest(unittest.TestCase):
    def setUp(self) -> None:
        (paths.DATA_DIR / rig_link.FILE).unlink(missing_ok=True)
        rig_link._last_seen = 0.0  # "MainUI seen lately" must not leak between tests
        self.client = TestClient(app)

    def pair(self) -> str:
        return self.client.post("/api/ingest/tokens", json={"name": "MainUI"}).json()["token"]

    def test_every_route_needs_the_token(self) -> None:
        routes = [("get", "/api/rig-chat/status"), ("get", "/api/rig-chat/sessions"),
                  ("post", "/api/rig-chat/sessions"), ("get", "/api/rig-chat/sessions/s_x/messages")]
        for method, path in routes:
            self.assertEqual(getattr(self.client, method)(path).status_code, 403, path)  # unpaired
        token = self.pair()
        for method, path in routes:
            self.assertEqual(getattr(self.client, method)(path, headers=auth("wrong")).status_code, 401, path)
        ask = {"session_id": "s_x", "message": "hi"}
        self.assertEqual(self.client.post("/api/rig-chat", json=ask, headers=auth("wrong")).status_code, 401)
        # Revoking the token cuts the chat off with the data stream.
        [row] = self.client.get("/api/ingest/tokens").json()["tokens"]
        self.client.delete(f"/api/ingest/tokens/{row['id']}")
        self.assertEqual(self.client.get("/api/rig-chat/sessions", headers=auth(token)).status_code, 403)

    def test_status_says_which_rig_and_model(self) -> None:
        token = self.pair()
        from app.forge import model_config  # noqa: PLC0415

        with mock.patch.object(model_config, "resolve", return_value={"tag": "qwen3:1.7b", "reason": "best fit"}):
            body = self.client.get("/api/rig-chat/status", headers=auth(token)).json()
        self.assertEqual((body["ok"], body["model"]), (True, "qwen3:1.7b"))
        self.assertIn("device_id", body)

    def test_shared_chats_but_never_incognito(self) -> None:
        token = self.pair()
        made = self.client.post("/api/rig-chat/sessions", headers=auth(token))
        self.assertEqual(made.status_code, 201)
        sid = made.json()["session_id"]
        hidden = chat_service.create_session(ephemeral=True)["session_id"]
        listed = [s["session_id"] for s in self.client.get("/api/rig-chat/sessions", headers=auth(token)).json()["sessions"]]
        self.assertIn(sid, listed)
        self.assertNotIn(hidden, listed)
        # The web UI sees MainUI's chat too: one shared history.
        self.assertIn(sid, [s["session_id"] for s in self.client.get("/api/sessions").json()["sessions"]])
        self.assertEqual(self.client.get(f"/api/rig-chat/sessions/{sid}/messages", headers=auth(token)).status_code, 200)
        # Not readable or writable by id either.
        self.assertEqual(self.client.get(f"/api/rig-chat/sessions/{hidden}/messages", headers=auth(token)).status_code, 404)
        self.assertEqual(self.client.post("/api/rig-chat", headers=auth(token),
                                          json={"session_id": hidden, "message": "hi"}).status_code, 404)

    def test_ask_streams_the_web_uis_own_answer(self) -> None:
        token = self.pair()
        sid = self.client.post("/api/rig-chat/sessions", headers=auth(token)).json()["session_id"]
        events = [{"phase": "generating", "piece": "CO2 is "},
                  {"phase": "done", "result": {"answer": "CO2 is 452.1 ppm [S1].", "query_id": "q1"}}]
        with mock.patch.object(inference, "answer_stream", return_value=iter(events)) as stream:
            res = self.client.post("/api/rig-chat", headers=auth(token),
                                   json={"session_id": sid, "message": "  What is the CO2 now?  "})
        self.assertEqual(res.headers["content-type"].split(";")[0], "text/event-stream")
        got = [json.loads(line[6:]) for line in res.text.splitlines() if line.startswith("data: ")]
        self.assertEqual(got, events)
        self.assertEqual(stream.call_args.args[:2], (sid, "What is the CO2 now?"))


if __name__ == "__main__":
    unittest.main()
