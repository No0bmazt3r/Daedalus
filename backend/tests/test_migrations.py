"""The migration runner — the piece that can quietly break every other store."""

from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app.db import migrations

REAL_ROOT = migrations.MIGRATIONS_ROOT


class MigrationRunnerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.dir = root / "migrations" / "toy"
        self.dir.mkdir(parents=True)
        self.db = root / "toy.db"
        self.patches = [
            mock.patch.object(migrations, "MIGRATIONS_ROOT", root / "migrations"),
            mock.patch.dict(migrations.STORES, {"toy": self.db}, clear=True),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self) -> None:
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def write(self, name: str, sql: str) -> None:
        (self.dir / name).write_text(sql)

    def columns(self) -> list[str]:
        with sqlite3.connect(self.db) as conn:
            return [r[1] for r in conn.execute("PRAGMA table_info(t)")]

    def test_applies_in_order_once_and_records_each(self) -> None:
        self.write("001_init.sql", "CREATE TABLE t (a INTEGER);")
        self.write("002_add_b.sql", "ALTER TABLE t ADD COLUMN b TEXT;")
        self.assertEqual([m.version for m in migrations.migrate("toy")], [1, 2])
        self.assertEqual(self.columns(), ["a", "b"])
        self.assertEqual(migrations.migrate("toy"), [])  # idempotent on the next boot
        self.assertEqual(sorted(migrations.applied("toy")), [1, 2])

    def test_a_failing_file_rolls_back_whole_and_earlier_files_stay(self) -> None:
        self.write("001_init.sql", "CREATE TABLE t (a INTEGER);")
        self.write("002_bad.sql", "ALTER TABLE t ADD COLUMN b TEXT;\nNOT SQL AT ALL;")
        with self.assertRaises(migrations.MigrationError):
            migrations.migrate("toy")
        self.assertEqual(self.columns(), ["a"])  # 002's first statement did not stick
        self.assertEqual(sorted(migrations.applied("toy")), [1])

    def test_an_edited_applied_file_is_refused(self) -> None:
        self.write("001_init.sql", "CREATE TABLE t (a INTEGER);")
        migrations.migrate("toy")
        self.write("001_init.sql", "CREATE TABLE t (a INTEGER, sneaky TEXT);")
        with self.assertRaisesRegex(migrations.MigrationError, "changed on disk"):
            migrations.migrate("toy")
        self.assertEqual(migrations.repair("toy"), [1])  # the cosmetic-edit escape hatch
        self.assertEqual(migrations.migrate("toy"), [])

    def test_a_gap_filled_below_the_applied_version_is_refused(self) -> None:
        self.write("001_init.sql", "CREATE TABLE t (a INTEGER);")
        self.write("003_c.sql", "ALTER TABLE t ADD COLUMN c TEXT;")
        migrations.migrate("toy")
        self.write("002_b.sql", "ALTER TABLE t ADD COLUMN b TEXT;")
        with self.assertRaisesRegex(migrations.MigrationError, "numbered below"):
            migrations.migrate("toy")

    def test_a_deleted_applied_file_is_refused(self) -> None:
        self.write("001_init.sql", "CREATE TABLE t (a INTEGER);")
        migrations.migrate("toy")
        (self.dir / "001_init.sql").unlink()
        with self.assertRaisesRegex(migrations.MigrationError, "file is missing"):
            migrations.migrate("toy")

    def test_bad_filenames_and_trigger_bodies(self) -> None:
        # A trigger body holds semicolons; splitting must use SQLite's parser.
        self.write("001_init.sql", "CREATE TABLE t (a INTEGER);\nCREATE TABLE log (x);\n"
                                   "CREATE TRIGGER tr AFTER INSERT ON t BEGIN INSERT INTO log VALUES (1); END;")
        migrations.migrate("toy")
        with sqlite3.connect(self.db) as conn:
            conn.execute("INSERT INTO t VALUES (1)")
            self.assertEqual(conn.execute("SELECT count(*) FROM log").fetchone()[0], 1)
        self.write("2_Bad Name.sql", "SELECT 1;")
        with self.assertRaisesRegex(migrations.MigrationError, "bad migration filename"):
            migrations.discover("toy")

    def test_every_real_migration_applies_to_a_fresh_database(self) -> None:
        stores = {d.name: Path(self.tmp.name) / f"{d.name}.db" for d in REAL_ROOT.iterdir() if d.is_dir()}
        with mock.patch.object(migrations, "MIGRATIONS_ROOT", REAL_ROOT), \
             mock.patch.dict(migrations.STORES, stores, clear=True):
            for store in stores:
                migrations.migrate(store)
                self.assertEqual(migrations.status(store)["pending"], [], store)

if __name__ == "__main__":
    unittest.main()
