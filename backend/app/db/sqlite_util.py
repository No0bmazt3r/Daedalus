"""Shared SQLite connection handling.

Every writable store in Daedalus wants the same five things: WAL, a busy
timeout, foreign keys on, explicit transactions, and a retry when another
writer holds the lock. They were being re-declared in each store module, which
meant a fix in one did not reach the others. They live here now.

## Why the pragmas are what they are

- **WAL** — one writer and N readers proceed concurrently. The dashboard polls
  `/api/system/databases` while a chat turn is being written; without WAL the
  read blocks the write.
- **`busy_timeout`** — SQLite's answer to write contention is to make the
  loser wait, not fail. Five seconds is far beyond our worst case (a few
  writes per minute) and turns a spurious `SQLITE_BUSY` into a short pause.
- **`foreign_keys`** — *off by default, and per-connection*. A schema with
  `ON DELETE CASCADE` silently does nothing without it, so deleting a chat
  session would orphan every one of its messages rather than remove them.
- **`synchronous=NORMAL`** — with WAL this is crash-safe against process
  death, which is the failure we actually face. `FULL` additionally survives
  OS/power loss at a large write cost; a lab workstation does not need it.

## WAL needs real shared memory

WAL coordinates writers through a `-shm` file that must support mmap. Network
mounts (NFS, SMB) and Windows-hosted paths under WSL (`/mnt/c/...`) do not
reliably provide that, and the symptom is corruption rather than an error.
Keep `DAEDALUS_DATA_DIR` on a native Linux filesystem — see `paths.py`.
"""

from __future__ import annotations

import random
import sqlite3
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, TypeVar

# Long enough to outlast any writer we generate, short enough that a genuinely
# stuck lock surfaces as an error instead of hanging a request forever.
BUSY_TIMEOUT_MS = 5_000
CONNECT_TIMEOUT_S = 5.0

# Retries cover the window where a *different process* holds the write lock —
# `busy_timeout` alone does not cover every SQLITE_BUSY path.
MAX_RETRIES = 4
BASE_BACKOFF_S = 0.05

T = TypeVar("T")


class DatabaseUnavailableError(RuntimeError):
    """The database could not be opened or written after retrying.

    Distinct from a caller error (bad input) so the API layer can map it to
    503 rather than 400 or 500.
    """


def _apply_pragmas(conn: sqlite3.Connection, *, foreign_keys: bool) -> None:
    # Order matters: these must run outside a transaction. `foreign_keys` is a
    # silent no-op inside one, which is the classic way cascades stop working.
    conn.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute(f"PRAGMA foreign_keys={'ON' if foreign_keys else 'OFF'}")


@contextmanager
def connect(
    path: Path,
    *,
    read_only: bool = False,
    foreign_keys: bool = True,
) -> Iterator[sqlite3.Connection]:
    """An autocommit connection with Daedalus' pragmas applied.

    `isolation_level=None` disables the driver's implicit transaction handling,
    so a transaction only exists when `transaction()` opens one. Without this,
    `sqlite3` begins one invisibly before the first INSERT and holds it until a
    commit that may never come.
    """
    if not read_only:
        path.parent.mkdir(parents=True, exist_ok=True)

    if read_only:
        # The driver itself refuses writes — the boundary holds below the
        # application, where a coding mistake cannot reach it.
        target: Any = f"file:{path}?mode=ro"
        uri = True
    else:
        target, uri = str(path), False

    try:
        conn = sqlite3.connect(
            target, timeout=CONNECT_TIMEOUT_S, uri=uri, isolation_level=None
        )
    except sqlite3.Error as exc:
        raise DatabaseUnavailableError(f"cannot open {path}: {exc}") from exc

    try:
        conn.row_factory = sqlite3.Row
        _apply_pragmas(conn, foreign_keys=foreign_keys)
        yield conn
    finally:
        conn.close()


@contextmanager
def transaction(
    path: Path, *, foreign_keys: bool = True
) -> Iterator[sqlite3.Connection]:
    """A write transaction: commits on success, rolls back on any exception.

    `BEGIN IMMEDIATE` takes the write lock up front. The default deferred
    transaction takes a read lock first and upgrades on the first write, which
    can fail with `SQLITE_BUSY` *mid-transaction* — after the caller has
    already done work. Taking it immediately turns that into an honest wait at
    a point where retrying is safe.
    """
    with connect(path, foreign_keys=foreign_keys) as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            yield conn
        except BaseException:
            conn.execute("ROLLBACK")
            raise
        conn.execute("COMMIT")


def with_retry(fn: Callable[[], T], *, what: str = "write") -> T:
    """Run `fn`, retrying while SQLite reports the database is locked.

    Backoff is randomised so two retrying writers do not resynchronise onto
    the same schedule and collide again.
    """
    last: sqlite3.Error | None = None
    for attempt in range(MAX_RETRIES):
        try:
            return fn()
        except sqlite3.OperationalError as exc:
            message = str(exc).lower()
            if "locked" not in message and "busy" not in message:
                raise
            last = exc
            if attempt == MAX_RETRIES - 1:
                break
            time.sleep(BASE_BACKOFF_S * (2**attempt) * (1 + random.random()))
    raise DatabaseUnavailableError(
        f"{what} failed after {MAX_RETRIES} attempts: {last}"
    ) from last


def integrity_check(path: Path) -> str | None:
    """`None` when the file is healthy, else the first problem reported.

    `quick_check` skips the expensive cross-page index verification, which
    makes it cheap enough to run on every boot.
    """
    if not path.exists():
        return None
    try:
        with connect(path, read_only=True) as conn:
            row = conn.execute("PRAGMA quick_check(1)").fetchone()
    except (sqlite3.Error, DatabaseUnavailableError) as exc:
        return str(exc)
    result = row[0] if row else "no result"
    return None if result == "ok" else str(result)


def backup(path: Path, dest: Path) -> Path:
    """Consistent copy of a live database.

    `VACUUM INTO` snapshots inside a read transaction. Copying the file with
    `cp` while WAL is active captures the main file without its pending WAL
    frames — a torn database that may not even open.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        raise FileExistsError(f"refusing to overwrite existing backup {dest}")
    with connect(path, read_only=True) as conn:
        conn.execute("VACUUM INTO ?", (str(dest),))
    return dest


def file_size(path: Path) -> int | None:
    """Size in bytes including WAL, or `None` if the file is absent.

    The `-wal` sidecar holds committed data not yet checkpointed into the main
    file, so reporting the main file alone understates a busy database.
    """
    try:
        total = path.stat().st_size
    except OSError:
        return None
    for suffix in ("-wal", "-shm"):
        try:
            total += path.with_name(path.name + suffix).stat().st_size
        except OSError:
            pass
    return total
