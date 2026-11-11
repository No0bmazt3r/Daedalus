"""Credentials in `prefs.db`, encrypted at rest.

API keys (benchmark endpoints, search providers) and MCP env/header values are
stored as `enc:v1:<Fernet token>`. The key is **not** in the database: it is
`$DAEDALUS_SECRET_KEY` when set, otherwise a `secret.key` file beside
`prefs.db`, created on first use with mode 0600. A copy of `prefs.db` on its own
therefore holds nothing usable — which is the case the old plain-text caveat
("do not copy the file around") was about.

It is not a secret store against someone who can read the key file too; on a
single-operator machine nothing local is. Lose the key file and the stored
credentials read as absent (re-enter them), never as garbage.

A value without the prefix is a legacy plain-text row: returned as-is, and
re-sealed by `seal_column` the first time its store starts.
"""

from __future__ import annotations

import logging
import os
import sqlite3
import threading
from typing import Final

from cryptography.fernet import Fernet, InvalidToken

from .paths import PREFS_DB

PREFIX: Final = "enc:v1:"
KEY_PATH: Final = PREFS_DB.parent / "secret.key"

log = logging.getLogger(__name__)
_lock = threading.Lock()
_fernet: Fernet | None = None


def _box() -> Fernet:
    global _fernet
    with _lock:
        if _fernet is None:
            key = os.environ.get("DAEDALUS_SECRET_KEY", "").encode() or _key_file()
            _fernet = Fernet(key)
        return _fernet


def _key_file() -> bytes:
    try:
        return KEY_PATH.read_bytes().strip()
    except FileNotFoundError:
        KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
        key = Fernet.generate_key()
        # O_EXCL: two processes starting at once must not each write a key.
        try:
            fd = os.open(KEY_PATH, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            return KEY_PATH.read_bytes().strip()
        with os.fdopen(fd, "wb") as handle:
            handle.write(key)
        return key


def seal(value: str | None) -> str | None:
    """Encrypt one value. Empty stays None; an already-sealed value is left alone."""
    if not value:
        return None
    if value.startswith(PREFIX):
        return value
    return PREFIX + _box().encrypt(value.encode()).decode()


def unseal(value: str | None) -> str | None:
    """Decrypt one value. Plain text (a legacy row) passes through."""
    if not value or not value.startswith(PREFIX):
        return value
    try:
        return _box().decrypt(value[len(PREFIX):].encode()).decode()
    except InvalidToken:
        log.warning("a stored credential cannot be decrypted with %s; treating it as absent", KEY_PATH)
        return None


def seal_column(conn: sqlite3.Connection, table: str, column: str) -> int:
    """Encrypt every plain-text value left in `table.column`. Returns how many."""
    rows = conn.execute(
        f"SELECT rowid, {column} FROM {table} WHERE {column} IS NOT NULL AND {column} != '' "
        f"AND {column} NOT LIKE '{PREFIX}%'"
    ).fetchall()
    for rowid, value in rows:
        conn.execute(f"UPDATE {table} SET {column} = ? WHERE rowid = ?", (seal(value), rowid))
    return len(rows)
