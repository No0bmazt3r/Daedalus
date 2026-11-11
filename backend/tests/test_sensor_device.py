"""Sensor rows read as the rig they came from; a row or file with no id is the .env rig."""

from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app.system import log_browser


def _db(path: Path, with_device: bool) -> None:
    conn = sqlite3.connect(path)
    device = "device_id TEXT, " if with_device else ""
    conn.execute(f"CREATE TABLE sensor_readings (timestamp TEXT, {device}mode TEXT, "
                 "temp_c REAL, pressure_barg REAL, ph REAL, co2_ppm REAL)")
    cols = "timestamp, device_id" if with_device else "timestamp"
    for ts, dev in (("2026-11-11T08:00:00+00:00", "rig-b"), ("2026-11-11T08:00:01+00:00", "")):
        values = (ts, dev) if with_device else (ts,)
        conn.execute(f"INSERT INTO sensor_readings ({cols}) VALUES ({','.join('?' * len(values))})", values)
    conn.commit()
    conn.close()


class SensorDeviceTest(unittest.TestCase):
    def devices(self, with_device: bool) -> list[str]:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sensor.db"
            _db(path, with_device)
            with mock.patch.dict(log_browser.BROWSABLE, {"sensor": (path, ("sensor_readings",))}), \
                 mock.patch.dict("os.environ", {"DAEDALUS_DEVICE_ID": "rig-a"}):
                page = log_browser.read("sensor", "sensor_readings", newest_first=False)
        self.assertEqual(page["columns"][:3], ["Device", "Date", "Time (UTC)"])
        return [row["Device"] for row in page["rows"]]

    def test_a_stamped_id_wins_and_a_blank_one_falls_back(self) -> None:
        self.assertEqual(self.devices(with_device=True), ["rig-b", "rig-a"])

    def test_a_file_with_no_device_column_is_the_env_rig(self) -> None:
        self.assertEqual(self.devices(with_device=False), ["rig-a", "rig-a"])


if __name__ == "__main__":
    unittest.main()
