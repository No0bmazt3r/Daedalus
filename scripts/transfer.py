#!/usr/bin/env python3
"""Move a working Daedalus — knowledge, sensor data, config — to a fresh machine.

    python3 scripts/transfer.py pack  [--out daedalus-transfer.tgz]     # on the old laptop
    python3 scripts/transfer.py restore daedalus-transfer.tgz [--dest ~/projects/FYP/Daedalus]

What travels: the code, `config/` (rag config, knowledge graph, eval set), `data/`
(Chroma index, corpus files + manifest, sensor readings, reranker models), the
audit/chat/prefs databases, and `.env`. What does not: `node_modules`, the venv
and build output — `restore` rebuilds those with `./daedalus.sh setup` — and the
Ollama models, which `restore` pulls by the exact tags this machine has.

The index travels as-is rather than being re-ingested, so retrieval on the new
machine is the same index the old one built. Every SQLite file is copied with
`VACUUM INTO` (consistent even while the server runs; a plain copy of a WAL
database can be torn). `restore` re-counts every table against the manifest
before anything else runs, so a damaged archive stops there.

The archive holds `.env` (API keys, OAuth secrets): move it privately.
No dependencies beyond the standard library.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# .git stays behind (~500 MB of history the eval machine never needs); the
# manifest records the commit the code came from instead.
SKIP_DIRS = {".git", "node_modules", ".venv", "dist", "dist-ssr", "__pycache__", ".vite", "backups",
             "test-results", "playwright-report", ".pytest_cache"}
SKIP_SUFFIXES = ("-wal", "-shm", "-journal", ".pyc")
MANIFEST = "TRANSFER_MANIFEST.json"


def _is_sqlite(path: Path) -> bool:
    try:
        with path.open("rb") as f:
            return f.read(16) == b"SQLite format 3\x00"
    except OSError:
        return False


def _counts(db: Path) -> dict[str, int]:
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        out = {}
        for t in tables:
            try:
                out[t] = conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
            except sqlite3.Error:  # virtual tables (FTS) whose module this python lacks
                pass
        return out
    finally:
        conn.close()


def _git_commit() -> str | None:
    """HEAD's commit, read from .git without running git."""
    try:
        head = (ROOT / ".git" / "HEAD").read_text().strip()
        if not head.startswith("ref: "):
            return head
        ref = head[5:]
        loose = ROOT / ".git" / ref
        if loose.exists():
            return loose.read_text().strip()
        for line in (ROOT / ".git" / "packed-refs").read_text().splitlines():
            if line.endswith(" " + ref):
                return line.split()[0]
    except OSError:
        pass
    return None


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _env(key: str, env_file: Path) -> str:
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            k, sep, v = line.strip().partition("=")
            if sep and k == key:
                return v.strip().strip('"').strip("'")
    return ""


def _ollama_url(root: Path) -> str:
    return (_env("OLLAMA_BASE_URL", root / ".env") or "http://localhost:11434").rstrip("/")


def _local_models(root: Path) -> list[str]:
    try:
        with urllib.request.urlopen(f"{_ollama_url(root)}/api/tags", timeout=5) as r:
            names = [m["name"] for m in json.load(r)["models"]]
    except Exception as exc:  # noqa: BLE001
        print(f"  ! Ollama not reachable ({exc}); the manifest will list no models")
        return []
    return sorted(n for n in names if not n.endswith("-cloud"))  # cloud tags need no download


def pack(out: Path) -> int:
    staging = Path(tempfile.mkdtemp(prefix="daedalus-transfer-"))
    dest_root = staging / "Daedalus"
    manifest: dict = {"databases": {}, "files": 0}
    try:
        for dirpath, dirnames, filenames in os.walk(ROOT):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            rel_dir = Path(dirpath).relative_to(ROOT)
            for name in filenames:
                src = Path(dirpath) / name
                rotated_log = ".log." in name  # daedalus.log.1 … — old logs, not state
                if (name.endswith(SKIP_SUFFIXES) or rotated_log or src.is_symlink()
                        or src.resolve() == out.resolve()):
                    continue
                dst = dest_root / rel_dir / name
                dst.parent.mkdir(parents=True, exist_ok=True)
                if _is_sqlite(src):
                    conn = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
                    try:
                        conn.execute("VACUUM INTO ?", (str(dst),))
                    finally:
                        conn.close()
                    rel = str(rel_dir / name)
                    manifest["databases"][rel] = _counts(dst)
                    print(f"  db  {rel}: {sum(manifest['databases'][rel].values())} rows")
                else:
                    shutil.copy2(src, dst)
                manifest["files"] += 1

        manifest["source_commit"] = _git_commit()  # plus uncommitted changes: the files are copied as they are
        graph = ROOT / "config" / "knowledge_graph.yaml"
        manifest["graph_sha256"] = _sha(graph) if graph.exists() else None
        manifest["ollama_models"] = _local_models(ROOT)
        model_cfg = json.loads((ROOT / "config" / "model_config.json").read_text())
        manifest["chat_model"] = {"mode": model_cfg.get("mode"), "pinned": model_cfg.get("pinned")}
        (dest_root / MANIFEST).write_text(json.dumps(manifest, indent=2) + "\n")

        print(f"  packing {manifest['files']} files …")
        with tarfile.open(out, "w:gz") as tar:
            tar.add(dest_root, arcname="Daedalus")
    finally:
        shutil.rmtree(staging, ignore_errors=True)

    print(f"\nWrote {out} ({out.stat().st_size / 1e6:.0f} MB). It contains .env — move it privately.")
    print(f"Ollama models the new machine will pull: {', '.join(manifest['ollama_models']) or '(none found)'}")
    if manifest["chat_model"]["mode"] != "pinned":
        print("! Chat model is on 'auto', which picks by hardware: the new laptop may choose a different\n"
              "  model. Pin it in the Forge (either machine) before an eval run you want to compare.")
    return 0


def _pull(root: Path, tag: str) -> bool:
    req = urllib.request.Request(f"{_ollama_url(root)}/api/pull", data=json.dumps({"model": tag}).encode(),
                                 headers={"Content-Type": "application/json"})
    last = ""
    try:
        with urllib.request.urlopen(req, timeout=3600) as r:
            for line in r:
                status = json.loads(line).get("status", "")
                if "error" in json.loads(line):
                    print(f"\n  ! {tag}: {json.loads(line)['error']}")
                    return False
                if status != last:
                    print(f"\r  {tag}: {status}".ljust(70), end="", flush=True)
                    last = status
    except Exception as exc:  # noqa: BLE001
        print(f"\n  ! {tag}: {exc}")
        return False
    print()
    return True


def restore(archive: Path, dest: Path) -> int:
    dest = dest.expanduser().resolve()
    if str(dest).startswith("/mnt/"):
        sys.exit("Restore under /home, not /mnt/…: the databases use WAL, which breaks on Windows-mounted paths.")
    if dest.exists() and any(dest.iterdir()):
        sys.exit(f"{dest} is not empty — pick another --dest or move it aside first.")

    print(f"Extracting into {dest} …")
    with tempfile.TemporaryDirectory(dir=dest.parent if dest.parent.exists() else None) as tmp:
        with tarfile.open(archive, "r:gz") as tar:
            try:
                tar.extractall(tmp, filter="data")
            except TypeError:  # Python without extraction filters (< 3.11.4)
                tar.extractall(tmp)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(Path(tmp) / "Daedalus"), dest)

    manifest = json.loads((dest / MANIFEST).read_text())
    print("Checking every database against the manifest …")
    bad = []
    for rel, expected in manifest["databases"].items():
        got = _counts(dest / rel)
        if got != expected:
            bad.append(rel)
            print(f"  ✗ {rel}: expected {expected}, got {got}")
        else:
            print(f"  ✓ {rel}: {sum(got.values())} rows")
    graph = dest / "config" / "knowledge_graph.yaml"
    if manifest.get("graph_sha256") and _sha(graph) != manifest["graph_sha256"]:
        bad.append("config/knowledge_graph.yaml")
        print("  ✗ knowledge graph hash differs")
    else:
        print("  ✓ knowledge graph")
    if bad:
        sys.exit("The archive is damaged — re-pack on the old machine. Nothing else was run.")

    print("\nRunning ./daedalus.sh setup (dependencies, venv, migrations) …")
    if subprocess.call(["./daedalus.sh", "setup"], cwd=dest) != 0:
        sys.exit("setup failed — fix what it reports, then re-run `./daedalus.sh setup` in " + str(dest))

    print(f"\nPulling Ollama models from {_ollama_url(dest)} …")
    missing = [t for t in manifest.get("ollama_models", []) if not _pull(dest, t)]

    print("\nValidating the eval query set against the restored graph and corpus …")
    subprocess.call([str(dest / "backend" / ".venv" / "bin" / "python"), "-m", "app.cli_eval", "validate"],
                    cwd=dest / "backend")

    print("\nDone.")
    if missing:
        print(f"! Not pulled: {', '.join(missing)} — check OLLAMA_BASE_URL in .env, then `ollama pull <tag>`.")
    if manifest["chat_model"]["mode"] != "pinned":
        print("! Chat model is on 'auto' — pin it in the Forge before an eval run you want to compare.")
    print(f"Next:  cd {dest}/backend && .venv/bin/python -m app.cli_eval run --retrieval-only\n"
          "       (its retrieval numbers should match the old machine's — then the knowledge moved intact)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("pack", help="write the transfer archive")
    p.add_argument("--out", type=Path, default=ROOT.parent / "daedalus-transfer.tgz")
    r = sub.add_parser("restore", help="unpack, verify, set up and pull models")
    r.add_argument("archive", type=Path)
    r.add_argument("--dest", type=Path, default=Path.home() / "projects" / "FYP" / "Daedalus")
    args = parser.parse_args()
    return pack(args.out.resolve()) if args.cmd == "pack" else restore(args.archive, args.dest)


if __name__ == "__main__":
    sys.exit(main())
