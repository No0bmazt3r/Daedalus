"""The rig link: off until paired, a revoked or wrong token is refused, rows stored once, zero rows skipped."""

from __future__ import annotations

import os
import unittest
from unittest import mock

from fastapi.testclient import TestClient

from app.db import paths, sensor_store
from app.main import app
from app.system import rig_link

ROW = {"timestamp": "2026-11-11T00:05:49Z", "temp_c": 31.5, "pressure_barg": 1.78, "ph": 6.7,
       "co2_ppm": 480.2, "mode": "Manual"}
ZERO = {"timestamp": "2026-11-11T00:05:50Z", "temp_c": 0, "pressure_barg": 0, "ph": 0, "co2_ppm": 0, "mode": "Manual"}


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class IngestTest(unittest.TestCase):
    def setUp(self) -> None:
        if paths.SENSOR_DB.exists():
            paths.SENSOR_DB.unlink()
        (paths.DATA_DIR / rig_link.FILE).unlink(missing_ok=True)
        rig_link._last_seen = 0.0  # "MainUI seen lately" must not leak between tests
        self.client = TestClient(app)

    def pair(self, name: str = "MainUI", days: int | None = 90) -> str:
        return self.client.post("/api/ingest/tokens", json={"name": name, "expires_days": days}).json()["token"]

    def test_off_until_a_token_and_each_revoked_on_its_own(self) -> None:
        self.assertEqual(self.client.get("/api/ingest/status").json()["state"], "off")
        self.assertEqual(self.client.get("/api/ingest/ping", headers=auth("x")).status_code, 403)
        lab = self.pair("Lab PC")
        laptop = self.pair("Laptop", None)
        self.assertEqual(self.client.get("/api/ingest/ping", headers=auth(lab)).status_code, 200)
        self.assertEqual(self.client.get("/api/ingest/ping", headers=auth("x")).status_code, 401)
        rows = {t["name"]: t for t in self.client.get("/api/ingest/tokens").json()["tokens"]}
        self.assertEqual(rows["Lab PC"]["prefix"], lab[:4])
        self.assertIsNone(rows["Laptop"]["expires_at"])
        self.assertIsNotNone(rows["Lab PC"]["last_used_at"])  # just used for the ping
        self.assertNotIn("token_sha256", rows["Lab PC"])
        # Revoking one leaves the other working.
        self.assertEqual(self.client.delete(f"/api/ingest/tokens/{rows['Lab PC']['id']}").status_code, 200)
        self.assertEqual(self.client.get("/api/ingest/ping", headers=auth(lab)).status_code, 401)
        self.assertEqual(self.client.get("/api/ingest/ping", headers=auth(laptop)).status_code, 200)
        self.client.delete(f"/api/ingest/tokens/{rows['Laptop']['id']}")
        self.assertEqual(self.client.get("/api/ingest/ping", headers=auth(laptop)).status_code, 403)
        # Only the hash is kept.
        self.pair()
        self.assertNotIn(laptop, (paths.DATA_DIR / rig_link.FILE).read_text())

    def test_expired_token_is_refused_and_says_so(self) -> None:
        token = self.pair("Old")
        later = rig_link._now() + rig_link.timedelta(days=91)
        with mock.patch.object(rig_link, "_now", return_value=later):
            res = self.client.get("/api/ingest/ping", headers=auth(token))
        self.assertEqual(res.status_code, 403)  # its only token expired: nothing is active
        self.pair("New", None)
        with mock.patch.object(rig_link, "_now", return_value=later):
            res = self.client.get("/api/ingest/ping", headers=auth(token))
        self.assertEqual(res.status_code, 401)
        self.assertIn("expired", res.json()["detail"])

    def test_bad_names_and_expiries_are_refused(self) -> None:
        self.assertEqual(self.client.post("/api/ingest/tokens", json={"name": "  "}).status_code, 400)
        self.assertEqual(self.client.post("/api/ingest/tokens", json={"name": "x", "expires_days": 7}).status_code, 400)
        self.assertEqual(self.client.post("/api/ingest/tokens").status_code, 422)  # needs a JSON body

    def test_old_single_token_carries_over_as_mainui(self) -> None:
        import hashlib  # noqa: PLC0415
        import json  # noqa: PLC0415

        (paths.DATA_DIR / rig_link.FILE).write_text(json.dumps(
            {"token_sha256": hashlib.sha256(b"old-token").hexdigest(), "paired_at": "2026-11-11T05:00:00+00:00"}))
        self.assertEqual(self.client.get("/api/ingest/ping", headers=auth("old-token")).status_code, 200)
        [row] = self.client.get("/api/ingest/tokens").json()["tokens"]
        self.assertEqual((row["name"], row["expires_at"]), ("MainUI", None))

    def test_chip_says_connected_when_mainui_calls_but_no_rows(self) -> None:
        token = self.pair()
        self.assertEqual(self.client.get("/api/ingest/status").json()["state"], "waiting")
        self.client.get("/api/ingest/ping", headers=auth(token))
        self.assertEqual(self.client.get("/api/ingest/status").json()["state"], "connected")

    def test_rows_stored_once_in_utc_and_zero_rows_skipped(self) -> None:
        token = self.pair()
        with mock.patch.dict(os.environ, {"DAEDALUS_DEVICE_ID": "rig-a"}):
            self.assertEqual(self.client.get("/api/ingest/ping", headers=auth(token)).json()["device_id"], "rig-a")
            first = self.client.post("/api/ingest/readings", json={"rows": [ROW, ZERO]}, headers=auth(token)).json()
            again = self.client.post("/api/ingest/readings", json={"rows": [ROW]}, headers=auth(token)).json()
            naive = self.client.post("/api/ingest/readings", headers=auth(token),
                                     json={"rows": [{**ROW, "timestamp": "2026-11-11T00:05:49"}]})
        self.assertEqual((first["inserted"], first["skipped_zero"]), (1, 1))
        self.assertEqual((again["inserted"], again["duplicates"]), (0, 1))
        self.assertEqual(naive.status_code, 422)
        with sensor_store.connect_ro() as conn:
            row = dict(conn.execute("SELECT timestamp, device_id FROM sensor_readings").fetchone())
        self.assertEqual(row, {"timestamp": "2026-11-11T00:05:49+00:00", "device_id": "rig-a"})
        # MainUI just called, but the only row is old: connected, not live.
        self.assertEqual(self.client.get("/api/ingest/status").json()["state"], "connected")


if __name__ == "__main__":
    unittest.main()
