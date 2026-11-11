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
        rig_link.unpair()
        self.client = TestClient(app)

    def pair(self) -> str:
        return self.client.post("/api/ingest/pair", json={"confirm": True}).json()["token"]

    def test_off_until_paired_and_revoked_by_repairing_or_disconnect(self) -> None:
        self.assertEqual(self.client.get("/api/ingest/status").json()["state"], "off")
        self.assertEqual(self.client.get("/api/ingest/ping", headers=auth("x")).status_code, 403)
        old = self.pair()
        self.assertEqual(self.client.get("/api/ingest/ping", headers=auth(old)).status_code, 200)
        self.assertEqual(self.client.get("/api/ingest/ping", headers=auth("x")).status_code, 401)
        new = self.pair()
        self.assertEqual(self.client.get("/api/ingest/ping", headers=auth(old)).status_code, 401)
        self.assertEqual(self.client.delete("/api/ingest/pair").json()["state"], "off")
        self.assertEqual(self.client.get("/api/ingest/ping", headers=auth(new)).status_code, 403)
        # Only the hash is kept.
        self.pair()
        self.assertNotIn(new, (paths.DATA_DIR / rig_link.FILE).read_text())

    def test_pair_needs_a_json_body(self) -> None:
        self.assertEqual(self.client.post("/api/ingest/pair").status_code, 422)

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
        # Paired, but the only row is old: waiting, not live.
        self.assertEqual(self.client.get("/api/ingest/status").json()["state"], "waiting")


if __name__ == "__main__":
    unittest.main()
