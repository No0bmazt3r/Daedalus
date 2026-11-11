"""A CSV saved from MainUI's Data tab: local time to UTC, zero rows skipped, re-import harmless."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app.db import import_rig_csv, paths, sensor_store

CSV = (
    "﻿Date,Time,T-101[C],P-101[barg],pH-101[-],CO2[ppm],Mode\n"
    "2026-11-11,08:05:49,0.00,0.00,0.00,0.00,Manual\n"
    "2026-11-11,08:05:50,31.52,1.79,6.69,490.20,Absorption\n"
)


class ImportRigCsvTest(unittest.TestCase):
    def test_import(self) -> None:
        if paths.SENSOR_DB.exists():
            paths.SENSOR_DB.unlink()
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.dict(os.environ, {"DAEDALUS_RIG_TZ": "Asia/Kuala_Lumpur"}):
            path = Path(tmp) / "data.csv"
            path.write_text(CSV, encoding="utf-8")
            found = import_rig_csv.rows(path, import_rig_csv._zone())
            first = sensor_store.ingest(found, "rig-a")
            again = sensor_store.ingest(found, "rig-a")
        self.assertEqual(found[1]["timestamp"], "2026-11-11T00:05:50+00:00")
        self.assertEqual((first["inserted"], first["skipped_zero"]), (1, 1))
        self.assertEqual(again["duplicates"], 1)


if __name__ == "__main__":
    unittest.main()
