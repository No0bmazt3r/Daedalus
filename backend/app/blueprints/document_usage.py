"""Which documents earn their place — Blueprints → Corpus → Usage.

Per ingested document: how often a retrieval returned it, per track, and how
often an answer actually cited it. Retrieved-but-never-cited and never-retrieved
documents are what to look at once the real corpus is in: the first is noise
that costs prompt tokens, the second is knowledge that nothing reaches.

Read from three stores and written to none:

- **retrieved** — `rag_logs.source_files`, once per retrieval. Seeded
  traversals (`vector_db_used = 'seed'`) are left out, as from every metric.
- **cited** — assistant messages in `chat.db`: each `[D1]`/`[G2]` label written
  in the answer, mapped through that turn's stored citations to a file. A graph
  node counts for the document it names (`filename`), and a step for the SOP
  that contains it. Once per answer per document.

Only what is still on record counts: a deleted chat takes its citations with it,
which is why this reads "how this corpus has been used", not "ever".
"""

from __future__ import annotations

import json
import re
import sqlite3
from typing import Any

from ..db import audit_store, corpus_store, sqlite_util
from ..db.paths import AUDIT_DB, CHAT_DB
from . import knowledge_graph as kg

_LABEL_RE = re.compile(r"\[\s*([A-Z]\d+(?:\s*[,;]\s*[A-Z]\d+)*)\s*\]")


def _node_files() -> dict[str, str]:
    """Graph node id → the document it stands for, if any."""
    try:
        graph = kg.load()
    except Exception:  # noqa: BLE001 — no graph: graph citations name no document
        return {}
    files = {n: str(a["filename"]) for n, a in graph.nodes(data=True) if a.get("filename")}
    for src, dst, key in graph.edges(keys=True):
        if key == "CONTAINS" and src in files:
            files.setdefault(dst, files[src])
    return files


def usage() -> list[dict[str, Any]]:
    documents = corpus_store.list_documents()
    by_name = {d["filename"].lower(): d for d in documents}
    stats = {
        d["filename"].lower(): {"retrieved_vector": 0, "retrieved_graph": 0, "cited": 0}
        for d in documents
    }

    audit_store.init_db()
    with sqlite_util.connect(AUDIT_DB) as conn:
        rows = conn.execute(
            "SELECT track, source_files FROM rag_logs "
            "WHERE source_files IS NOT NULL AND COALESCE(vector_db_used, '') != 'seed'"
        ).fetchall()
    for row in rows:
        try:
            files = {str(f).lower() for f in json.loads(row["source_files"]) or []}
        except (TypeError, ValueError):
            continue
        key = "retrieved_graph" if row["track"] == "graph" else "retrieved_vector"
        for f in files & stats.keys():
            stats[f][key] += 1

    node_files = _node_files()
    try:
        with sqlite_util.connect(CHAT_DB) as conn:
            answers = conn.execute(
                "SELECT content, evidence_json FROM chat_messages "
                "WHERE role = 'assistant' AND evidence_json IS NOT NULL"
            ).fetchall()
    except sqlite3.Error:
        answers = []
    for answer in answers:
        try:
            citations = (json.loads(answer["evidence_json"]) or {}).get("citations") or []
        except (TypeError, ValueError, AttributeError):
            continue
        said = {
            label.strip() for group in _LABEL_RE.findall(answer["content"] or "")
            for label in re.split(r"[,;]", group)
        }
        cited: set[str] = set()
        for c in citations:
            if c.get("label") not in said:
                continue
            name = c.get("source_file") or node_files.get(c.get("node_id") or "")
            if name and name.lower() in stats:
                cited.add(name.lower())
        for f in cited:
            stats[f]["cited"] += 1

    out = []
    for key, s in stats.items():
        d = by_name[key]
        retrieved = s["retrieved_vector"] + s["retrieved_graph"]
        out.append({
            "document_id": d["document_id"], "filename": d["filename"],
            "source_type": d.get("source_type"), "origin": d.get("origin"),
            "chunks": d.get("chunk_count"), **s,
            "verdict": "never_retrieved" if not retrieved else "never_cited" if not s["cited"] else "cited",
        })
    order = {"never_retrieved": 0, "never_cited": 1, "cited": 2}
    return sorted(out, key=lambda r: (order[r["verdict"]], -r["cited"], r["filename"].lower()))
