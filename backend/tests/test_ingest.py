"""The rig link: off without a token, refuses a wrong one, stores rows once, skips pre-connect zero rows."""

from __future__ import annotations

import os
import unittest
from unittest import mock

from fastapi.testclient import TestClient

from app.db import paths, sensor_store
from app.main import app

ROW = {"timestamp": "2026-11-11T00:05:49Z", "temp_c": 31.5, "pressure_barg": 1.78, "ph": 6.7,
       "co2_ppm": 480.2, "mode": "Manual"}
ZERO = {"timestamp": "2026-11-11T00:05:50Z", "temp_c": 0, "pressure_barg": 0, "ph": 0, "co2_ppm": 0, "mode": "Manual"}
AUTH = {"Authorization": "Bearer t0ken"}


class IngestTest(unittest.TestCase):
    def setUp(self) -> None:
        if paths.SENSOR_DB.exists():
            paths.SENSOR_DB.unlink()
        self.client = TestClient(app)

    def test_off_without_a_token_and_refuses_a_wrong_one(self) -> None:
        with mock.patch.dict(os.environ, {"DAEDALUS_INGEST_TOKEN": ""}):
            self.assertEqual(self.client.get("/api/ingest/ping", headers=AUTH).status_code, 403)
        with mock.patch.dict(os.environ, {"DAEDALUS_INGEST_TOKEN": "other"}):
            self.assertEqual(self.client.get("/api/ingest/ping", headers=AUTH).status_code, 401)

    def test_rows_stored_once_in_utc_and_zero_rows_skipped(self) -> None:
        with mock.patch.dict(os.environ, {"DAEDALUS_INGEST_TOKEN": "t0ken", "DAEDALUS_DEVICE_ID": "rig-a"}):
            self.assertEqual(self.client.get("/api/ingest/ping", headers=AUTH).json()["device_id"], "rig-a")
            first = self.client.post("/api/ingest/readings", json={"rows": [ROW, ZERO]}, headers=AUTH).json()
            again = self.client.post("/api/ingest/readings", json={"rows": [ROW]}, headers=AUTH).json()
            naive = self.client.post("/api/ingest/readings", headers=AUTH,
                                     json={"rows": [{**ROW, "timestamp": "2026-11-11T00:05:49"}]})
        self.assertEqual((first["inserted"], first["skipped_zero"]), (1, 1))
        self.assertEqual((again["inserted"], again["duplicates"]), (0, 1))
        self.assertEqual(naive.status_code, 422)
        with sensor_store.connect_ro() as conn:
            row = dict(conn.execute("SELECT timestamp, device_id FROM sensor_readings").fetchone())
        self.assertEqual(row, {"timestamp": "2026-11-11T00:05:49+00:00", "device_id": "rig-a"})


if __name__ == "__main__":
    unittest.main()
