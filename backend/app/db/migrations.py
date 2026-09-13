"""Versioned schema migrations for every writable store.

## Why this exists

The stores used to declare their schema as one `CREATE TABLE IF NOT EXISTS`
blob executed on boot. That works exactly once. It cannot add a column, cannot
backfill, cannot tell you what version a database is at, and silently does
nothing when a table exists but is *shaped differently* than the code expects —
which is the state a half-finished schema change leaves behind.

A migration is a numbered `.sql` file. It runs once, in order, inside a
transaction, and the fact that it ran is recorded in the database itself.

    app/db/migrations/<store>/001_initial_schema.sql
                             /002_add_pinned_flag.sql

## Rules

1. **Migrations are append-only.** Never edit an applied file — write a new
   one. The runner stores a checksum and refuses to proceed if a file it has
   already applied changed on disk, because at that point the code's idea of
   the schema and the database's actual shape have diverged silently.
2. **Numbers never reuse and never fill gaps.** Adding `003` after `004` is
   applied is rejected: whoever else ran `004` will never get `003`.
3. **Each file is one transaction.** A failure rolls its file back entirely,
   so a database is never left half-migrated. Earlier files stay applied.
4. **`IF NOT EXISTS` in `001` is deliberate.** Databases created before this
   runner existed already have their tables; baselining them must be a no-op
   rather than an error.

## Foreign keys during migration

Disabled while migrating. SQLite's supported recipe for altering a table is
create-new / copy / drop-old / rename, and with enforcement on, the drop
cascades into child tables. The pragma is restored for normal connections.
"""

from __future__ import annotations

import hashlib
import re
import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from . import paths, sqlite_util

MIGRATIONS_ROOT = Path(__file__).resolve().parent / "migrations"

# Which stores this runner manages, and where each one lives.
#
# `sensor` is deliberately absent: the SCADA ingestion subsystem owns that
# schema, and Daedalus opens it read-only. Migrating a database we do not own
# would breach Rule 2 as surely as an INSERT would.
STORES: dict[str, Path] = {
    "prefs": paths.PREFS_DB,
    "audit": paths.AUDIT_DB,
    "chat": paths.CHAT_DB,
}

_FILENAME = re.compile(r"^(\d{3,})_([a-z0-9_]+)\.sql$")

_TRACKING_TABLE = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    checksum   TEXT NOT NULL,
    applied_at TEXT NOT NULL
);
"""


class MigrationError(RuntimeError):
    """A migration could not be applied, or the set on disk is inconsistent."""


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    path: Path
    sql: str
    checksum: str

    @property
    def label(self) -> str:
        return f"{self.version:03d}_{self.name}"


def _checksum(text: str) -> str:
    # Newlines normalised so a checkout with different line endings does not
    # read as schema drift.
    return hashlib.sha256(text.replace("\r\n", "\n").encode("utf-8")).hexdigest()


def _split_statements(script: str) -> Iterator[str]:
    """Yield complete SQL statements from a migration file.

    `executescript()` would be simpler but it issues a COMMIT before running,
    which would silently break the transaction this runs inside. Splitting on
    `;` naively would break `CREATE TRIGGER` bodies, so completeness is decided
    by SQLite's own parser instead of by us.
    """
    buffer = ""
    for line in script.splitlines(keepends=True):
        # Skip comment lines sitting between statements, so a trailing comment
        # at end of file does not look like an unterminated statement.
        if not buffer.strip() and line.lstrip().startswith("--"):
            continue
        buffer += line
        if sqlite3.complete_statement(buffer):
            statement = buffer.strip()
            if statement:
                yield statement
            buffer = ""
    if buffer.strip():
        raise MigrationError(
            f"unterminated SQL statement (missing semicolon?): {buffer.strip()[:80]}…"
        )


def discover(store: str) -> list[Migration]:
    """Every migration file for a store, in version order."""
    directory = MIGRATIONS_ROOT / store
    if not directory.is_dir():
        return []

    found: dict[int, Migration] = {}
    for path in sorted(directory.iterdir()):
        if path.suffix != ".sql":
            continue
        match = _FILENAME.match(path.name)
        if not match:
            raise MigrationError(
                f"bad migration filename '{path.name}' — expected NNN_lower_snake.sql"
            )
        version, name = int(match.group(1)), match.group(2)
        if version in found:
            raise MigrationError(
                f"duplicate migration version {version} in {store}: "
                f"{found[version].path.name} and {path.name}"
            )
        sql = path.read_text(encoding="utf-8")
        found[version] = Migration(version, name, path, sql, _checksum(sql))

    return [found[v] for v in sorted(found)]


def _ensure_tracking(conn: sqlite3.Connection) -> None:
    # `execute`, never `executescript`: the latter issues an implicit COMMIT
    # before it runs, which would silently end the transaction `migrate()`
    # opened and leave a migration applied but unrecorded.
    conn.execute(_TRACKING_TABLE)


def applied(store: str) -> dict[int, sqlite3.Row]:
    """Versions already applied to this store's database, keyed by version."""
    db_path = _db_path(store)
    if not db_path.exists():
        return {}
    with sqlite_util.connect(db_path) as conn:
        _ensure_tracking(conn)
        rows = conn.execute(
            "SELECT version, name, checksum, applied_at FROM schema_migrations"
        ).fetchall()
    return {row["version"]: row for row in rows}


def _db_path(store: str) -> Path:
    try:
        return STORES[store]
    except KeyError:
        raise MigrationError(
            f"unknown store '{store}' (known: {', '.join(sorted(STORES))})"
        ) from None


def _verify(store: str, on_disk: list[Migration], done: dict[int, sqlite3.Row]) -> None:
    """Reject a migration set that cannot be applied safely.

    Both checks catch the same class of bug — the database's real shape no
    longer matches what the code believes — and both are far cheaper to hit
    here than at 2am during the evaluation run.
    """
    by_version = {m.version: m for m in on_disk}

    for version, row in sorted(done.items()):
        migration = by_version.get(version)
        if migration is None:
            raise MigrationError(
                f"{store}: version {version} ('{row['name']}') is applied in the "
                f"database but its file is missing. Restore it, or this database "
                f"cannot be reasoned about."
            )
        if migration.checksum != row["checksum"]:
            raise MigrationError(
                f"{store}: {migration.label} changed on disk after it was applied.\n"
                f"  recorded {row['checksum'][:12]}…  now {migration.checksum[:12]}…\n"
                f"Migrations are append-only: add a new file instead. If the edit "
                f"was cosmetic, re-record it with `migrate repair {store}`."
            )

    if done:
        highest = max(done)
        out_of_order = [m.label for m in on_disk if m.version not in done and m.version < highest]
        if out_of_order:
            raise MigrationError(
                f"{store}: {', '.join(out_of_order)} numbered below the applied "
                f"version {highest}. Renumber above it — anyone who already "
                f"migrated would otherwise never run these."
            )


def pending(store: str) -> list[Migration]:
    """Migrations not yet applied, in the order they will run."""
    on_disk = discover(store)
    done = applied(store)
    _verify(store, on_disk, done)
    return [m for m in on_disk if m.version not in done]


def migrate(store: str) -> list[Migration]:
    """Apply every pending migration. Returns what ran, in order.

    Safe to call on every boot: with nothing pending it is two cheap queries.
    """
    db_path = _db_path(store)
    to_apply = pending(store)
    if not to_apply:
        return []

    applied_now: list[Migration] = []
    for migration in to_apply:
        def _apply(migration: Migration = migration) -> None:
            # Foreign keys off — see the module docstring. Must be set outside
            # the transaction, which `transaction()` handles.
            with sqlite_util.transaction(db_path, foreign_keys=False) as conn:
                _ensure_tracking(conn)
                try:
                    for statement in _split_statements(migration.sql):
                        conn.execute(statement)
                except sqlite3.Error as exc:
                    raise MigrationError(
                        f"{store}: {migration.label} failed and was rolled back: {exc}"
                    ) from exc
                conn.execute(
                    "INSERT INTO schema_migrations (version, name, checksum, applied_at) "
                    "VALUES (?, ?, ?, ?)",
                    (
                        migration.version,
                        migration.name,
                        migration.checksum,
                        datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    ),
                )
                # Mirrors the version where `sqlite3 db 'PRAGMA user_version'`
                # can read it without knowing our table. Int from a regex, so
                # interpolation is safe — PRAGMA takes no parameters.
                conn.execute(f"PRAGMA user_version = {migration.version:d}")

        sqlite_util.with_retry(_apply, what=f"migration {migration.label}")
        applied_now.append(migration)

    return applied_now


def migrate_all() -> dict[str, list[Migration]]:
    """Bring every managed store up to date. Called once at startup."""
    return {store: migrate(store) for store in STORES}


def repair(store: str) -> list[int]:
    """Re-record checksums for applied migrations whose files changed.

    The escape hatch for a knowingly cosmetic edit — a fixed typo in a comment.
    It asserts "the schema did not change"; if that is wrong, the database is
    now lying about its shape. Write a new migration instead whenever the SQL
    itself changed.
    """
    db_path = _db_path(store)
    by_version = {m.version: m for m in discover(store)}
    repaired: list[int] = []
    with sqlite_util.transaction(db_path) as conn:
        _ensure_tracking(conn)
        rows = conn.execute("SELECT version, checksum FROM schema_migrations").fetchall()
        for row in rows:
            migration = by_version.get(row["version"])
            if migration and migration.checksum != row["checksum"]:
                conn.execute(
                    "UPDATE schema_migrations SET checksum = ? WHERE version = ?",
                    (migration.checksum, migration.version),
                )
                repaired.append(migration.version)
    return repaired


def status(store: str) -> dict[str, object]:
    """What `migrate status` prints, and what `/api/system/databases` reports."""
    db_path = _db_path(store)
    on_disk = discover(store)
    try:
        done = applied(store)
        _verify(store, on_disk, done)
        problem: str | None = None
    except (MigrationError, sqlite_util.DatabaseUnavailableError) as exc:
        done, problem = {}, str(exc)

    return {
        "store": store,
        "path": str(db_path),
        "exists": db_path.exists(),
        "current_version": max(done) if done else 0,
        "latest_version": on_disk[-1].version if on_disk else 0,
        "applied": len(done),
        "pending": [m.label for m in on_disk if m.version not in done] if not problem else [],
        "error": problem,
    }


def status_all() -> list[dict[str, object]]:
    return [status(store) for store in STORES]
