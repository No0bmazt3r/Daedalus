"""Command-line front end for the migration runner.

    python -m app.db.migrate status          # what's applied, what's pending
    python -m app.db.migrate up              # apply everything pending
    python -m app.db.migrate up chat         # …for one store only
    python -m app.db.migrate check           # integrity-check every database
    python -m app.db.migrate backup          # consistent snapshot of each
    python -m app.db.migrate repair chat     # re-record a cosmetic file edit
    python -m app.db.migrate new chat add_x  # scaffold the next migration file

Run from the `backend/` directory. The app also migrates on startup, so `up`
is mostly for applying a schema change without restarting, and for CI.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

from . import migrations, paths, sqlite_util

# Snapshots go beside the repo, not beside whatever directory you happened to
# run this from — the CLI is normally invoked from `backend/`, which would
# otherwise scatter backups into `backend/backups/`.
DEFAULT_BACKUP_DIR = paths.PREFS_DB.parent.parent.parent / "backups"

# Exit codes, so CI can tell "needs migrating" from "is broken".
EXIT_OK = 0
EXIT_ERROR = 1
EXIT_PENDING = 2


def _stores(requested: str | None) -> list[str]:
    if requested is None:
        return list(migrations.STORES)
    if requested not in migrations.STORES:
        raise SystemExit(
            f"unknown store '{requested}' "
            f"(known: {', '.join(sorted(migrations.STORES))})"
        )
    return [requested]


def cmd_status(args: argparse.Namespace) -> int:
    rows = [migrations.status(store) for store in _stores(args.store)]
    width = max(len(str(row["store"])) for row in rows)
    exit_code = EXIT_OK

    for row in rows:
        if row["error"]:
            state, exit_code = "ERROR", EXIT_ERROR
        elif row["pending"]:
            state = f"{len(row['pending'])} pending"
            exit_code = EXIT_PENDING if exit_code == EXIT_OK else exit_code
        elif not row["exists"]:
            state = "not created yet"
        else:
            state = "up to date"

        print(
            f"  {str(row['store']):<{width}}  "
            f"v{row['current_version']:03d}/{row['latest_version']:03d}  {state}"
        )
        for label in row["pending"]:
            print(f"  {'':<{width}}    → {label}")
        if row["error"]:
            print(f"  {'':<{width}}    {row['error']}")
    return exit_code


def cmd_up(args: argparse.Namespace) -> int:
    for store in _stores(args.store):
        try:
            applied = migrations.migrate(store)
        except migrations.MigrationError as exc:
            print(f"  {store}: FAILED\n    {exc}", file=sys.stderr)
            return EXIT_ERROR
        if applied:
            for migration in applied:
                print(f"  {store}: applied {migration.label}")
        else:
            print(f"  {store}: nothing to do")
    return EXIT_OK


def cmd_check(args: argparse.Namespace) -> int:
    exit_code = EXIT_OK
    for store in _stores(args.store):
        path = migrations.STORES[store]
        if not path.exists():
            print(f"  {store}: not created yet")
            continue
        problem = sqlite_util.integrity_check(path)
        size = sqlite_util.file_size(path) or 0
        if problem:
            print(f"  {store}: CORRUPT — {problem}", file=sys.stderr)
            exit_code = EXIT_ERROR
        else:
            print(f"  {store}: ok ({size / 1024:.1f} KiB)")
    return exit_code


def cmd_backup(args: argparse.Namespace) -> int:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    target = Path(args.into) / stamp
    exit_code = EXIT_OK
    for store in _stores(args.store):
        path = migrations.STORES[store]
        if not path.exists():
            print(f"  {store}: not created yet — skipped")
            continue
        try:
            written = sqlite_util.backup(path, target / path.name)
        except (OSError, sqlite_util.DatabaseUnavailableError) as exc:
            print(f"  {store}: FAILED — {exc}", file=sys.stderr)
            exit_code = EXIT_ERROR
            continue
        print(f"  {store}: → {written}")
    return exit_code


def cmd_repair(args: argparse.Namespace) -> int:
    repaired = migrations.repair(args.store)
    if repaired:
        versions = ", ".join(f"{v:03d}" for v in repaired)
        print(f"  {args.store}: re-recorded checksums for {versions}")
        print("  This asserted the SQL is unchanged in meaning. If it isn't,")
        print("  the database no longer matches what the code believes.")
    else:
        print(f"  {args.store}: no checksum drift")
    return EXIT_OK


def cmd_new(args: argparse.Namespace) -> int:
    existing = migrations.discover(args.store)
    version = (existing[-1].version + 1) if existing else 1
    slug = args.name.strip().lower().replace("-", "_").replace(" ", "_")
    path = migrations.MIGRATIONS_ROOT / args.store / f"{version:03d}_{slug}.sql"
    if path.exists():
        raise SystemExit(f"{path} already exists")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"-- {version:03d} {slug}\n"
        f"-- Store: {args.store}\n"
        f"--\n"
        f"-- Append-only: once this has run anywhere, edit it never — add\n"
        f"-- another file instead.\n\n",
        encoding="utf-8",
    )
    print(f"  created {path}")
    return EXIT_OK


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m app.db.migrate",
        description="Daedalus schema migrations.",
    )
    sub = parser.add_subparsers(dest="command")

    def add(name: str, help_text: str, *, store_required: bool = False):
        sp = sub.add_parser(name, help=help_text)
        if store_required:
            sp.add_argument("store", help="which store to act on")
        else:
            sp.add_argument("store", nargs="?", help="limit to one store")
        return sp

    add("status", "show applied and pending migrations").set_defaults(func=cmd_status)
    add("up", "apply pending migrations").set_defaults(func=cmd_up)
    add("check", "integrity-check each database").set_defaults(func=cmd_check)

    backup = add("backup", "write a consistent snapshot of each database")
    backup.add_argument(
        "--into",
        default=str(DEFAULT_BACKUP_DIR),
        help="destination directory (default: <repo>/backups)",
    )
    backup.set_defaults(func=cmd_backup)

    add("repair", "re-record checksums after a cosmetic edit", store_required=True
        ).set_defaults(func=cmd_repair)

    new = sub.add_parser("new", help="scaffold the next migration file")
    new.add_argument("store")
    new.add_argument("name", help="lower_snake description, e.g. add_pinned_flag")
    new.set_defaults(func=cmd_new)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "command", None):
        parser.print_help()
        return EXIT_OK
    try:
        return int(args.func(args))
    except migrations.MigrationError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return EXIT_ERROR


if __name__ == "__main__":
    raise SystemExit(main())
