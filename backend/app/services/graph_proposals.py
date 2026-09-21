"""Assisted graph authoring — the model proposes, a person disposes.

Track 2's knowledge gets in by being authored, and hand-typing every node is the
cost of the provenance claim that makes `search_graph` `Integrity.SYSTEM`. This
module removes the typing without removing the claim: candidates are extracted
from the **already-ingested corpus**, checked against the schema, and queued.
Nothing reaches the graph until somebody accepts it.

## Ontology-grounded, which is the part that actually works

The literature on LLM knowledge-graph construction converges on one finding:
accuracy is best when a *fixed schema constrains extraction* and regresses when
the constraint is removed (Feng et al., *Ontology-grounded Automatic Knowledge
Graph Construction by LLM under Wikidata schema*). Free-form triple extraction
produces more and worse.

Daedalus is unusually well placed for that, because the ontology already exists
and is already enforced. `knowledge_graph.NODE_TYPES`, `EDGE_TYPES` and
`EDGE_DOMAINS` are a closed, typed schema with declared endpoint domains, and
`graph_authoring._validate` already refuses anything outside it. So the prompt
does not ask "what entities are in this text" — it asks "which of these seven
node types does this text describe, using only these seven relations", and
anything that comes back outside that vocabulary is dropped before it is queued.

## The three failure modes this guards against

1. **Duplicate entities under different surface forms** — the one the surveys
   name first. Here it would mean two `Sensor` nodes for one `sensor_readings`
   column, which silently halves every traversal that should have reached both.
   `_canonical` matches proposals against existing ids, labels and aliases
   case-insensitively *before* queueing, and a hit is counted as a duplicate
   rather than shown.
2. **Invalid triples** — an edge whose endpoints do not satisfy `EDGE_DOMAINS`.
   Caught by a dry run through the real validator. Queued anyway, marked
   invalid, with the reason: a proposer that silently dropped its own bad output
   would hide its error rate, which is the number this feature will be judged on.
3. **Cost scaling with corpus size** — extraction is per chunk and the surveys
   call this the construction bottleneck. Bounded here by `MAX_CHUNKS` and by
   running over a document at a time, so a large corpus is a series of decisions
   rather than one unbounded job.

## Rule 5, and why the web is not a source

This is a setup surface. It writes, so it is never exposed to the model as a
tool, and the orchestrator cannot reach it. Extraction reads the corpus and
nothing else — web search exists in this project to *find documents to ingest*,
and unreviewed external text placed into the graph would break the provenance
claim the queue exists to protect.
"""

from __future__ import annotations

import json
import re
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from ..db import corpus_store, paths, sqlite_util
from . import graph_authoring, knowledge_graph as kg, ollama_client

# The construction bottleneck, bounded. Extraction is one model call per chunk,
# so an unbounded run over a real corpus is minutes of GPU and hundreds of
# proposals nobody will review in one sitting.
MAX_CHUNKS = 40

# Long enough for a small local model on CPU, short enough that a wedged call
# does not hold the run open indefinitely.
CALL_TIMEOUT = 120.0

_lock = threading.Lock()
_active: dict[str, Any] = {"run_id": None}


class ProposalError(RuntimeError):
    """The run cannot start, or a decision cannot be applied."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _connect() -> Any:
    return sqlite_util.connect(paths.CORPUS_DB)


# ── the prompt ───────────────────────────────────────────────────────────────


def _schema_block() -> str:
    """The ontology, written out for the model. Generated, never hand-copied.

    If it were a string literal it would drift from `knowledge_graph` the first
    time a node type was added, and the drift would be invisible — the model
    would simply stop proposing the new type, and nothing would fail.
    """
    edges = "\n".join(
        f"  {edge}: {domain[0]} -> {domain[1]}"
        for edge, domain in kg.EDGE_DOMAINS.items()
    )
    return (
        "NODE TYPES (use no others):\n  " + "\n  ".join(kg.NODE_TYPES) +
        "\n\nRELATIONS (use no others; the endpoint types are fixed):\n" + edges
    )


_SYSTEM = (
    "You extract structured knowledge for an industrial reactor monitoring system. "
    "You work strictly within a fixed schema and never invent node types or relations "
    "outside it. You only state what the given text supports; if the text does not "
    "describe something in the schema, you return empty lists. You never guess a "
    "numeric threshold, a sensor column or a document version that is not written "
    "in the text."
)


def _prompt(text: str, existing: list[str]) -> str:
    known = "\n".join(f"  {e}" for e in existing[:60]) or "  (the graph is empty)"
    return f"""{_schema_block()}

NODES THAT ALREADY EXIST (do not propose these again):
{known}

TEXT:
\"\"\"
{text}
\"\"\"

Return JSON with exactly this shape:
{{
  "nodes": [
    {{"type": "<one of the node types>",
      "id_suffix": "<short_snake_case, no type prefix>",
      "label": "<human readable>",
      "attributes": {{"<key>": "<value>"}},
      "evidence": "<the sentence from TEXT that supports this>"}}
  ],
  "edges": [
    {{"from": "<Type:suffix>", "type": "<one of the relations>", "to": "<Type:suffix>",
      "evidence": "<the sentence from TEXT that supports this>"}}
  ]
}}

Rules:
- Every node id is "<Type>:<id_suffix>", e.g. "Sensor:co2_ppm".
- An edge may only connect the endpoint types listed for that relation.
- Edges may reference nodes you propose above, or nodes that already exist.
- `evidence` must be copied verbatim from TEXT. If you cannot quote it, omit the item.
- Propose nothing rather than something uncertain. Empty lists are a correct answer."""


# ── canonicalisation ─────────────────────────────────────────────────────────


def _surface_forms() -> dict[str, str]:
    """Every way an existing node can be named, mapped to its id.

    Ids, labels and authored aliases, lowercased. This is the duplicate guard,
    and it is deliberately generous: proposing a node that already exists under
    another name is the failure that quietly halves a traversal, so a false
    match here (skipping a real new node) is cheaper than a false miss.
    """
    forms: dict[str, str] = {}
    try:
        graph = kg.load()
    except kg.GraphValidationError:
        return forms
    for node_id, attrs in graph.nodes(data=True):
        forms[str(node_id).lower()] = node_id
        label = attrs.get("label")
        if label:
            forms[str(label).lower()] = node_id
        for alias in attrs.get("aliases") or []:
            forms[str(alias).lower()] = node_id
    return forms


def _canonical(node_id: str, label: str, forms: dict[str, str]) -> str | None:
    """The existing node this proposal is really about, or None if it is new."""
    for candidate in (node_id, label):
        if candidate and candidate.lower() in forms:
            return forms[candidate.lower()]
    return None


_SUFFIX = re.compile(r"[^a-z0-9_]+")


def _node_id(node_type: str, suffix: str) -> str:
    clean = _SUFFIX.sub("_", str(suffix).strip().lower()).strip("_")
    return f"{node_type}:{clean}" if clean else ""


# ── validation, against the real validator ──────────────────────────────────


def _dry_run(candidate_nodes: list[dict[str, Any]], candidate_edges: list[dict[str, Any]]) -> dict[str, str]:
    """Which candidates the schema would refuse, and why.

    Builds the whole proposed set on top of the current graph *in memory* and
    validates it, then bisects to attribute failures — rather than reimplementing
    `EDGE_DOMAINS` here, which would be a second copy of the rule that could
    disagree with the one actually enforced at write time.
    """
    problems: dict[str, str] = {}
    base = graph_authoring._read_raw()  # noqa: SLF001 — this module is authoring's assistant

    for node in candidate_nodes:
        trial = {"nodes": [*base["nodes"], {"id": node["id"], "type": node["type"]}],
                 "edges": list(base["edges"])}
        try:
            graph_authoring._validate(trial)  # noqa: SLF001
        except graph_authoring.AuthoringError as exc:
            problems[node["key"]] = str(exc)

    # Edges are validated with every proposed node present, because an edge
    # legitimately depends on a node from the same batch — refusing it for a
    # missing endpoint that is two rows above would be wrong.
    with_nodes = {
        "nodes": [*base["nodes"], *({"id": n["id"], "type": n["type"]} for n in candidate_nodes)],
        "edges": list(base["edges"]),
    }
    for edge in candidate_edges:
        trial = {
            "nodes": list(with_nodes["nodes"]),
            "edges": [*with_nodes["edges"],
                      {"from": edge["from"], "type": edge["type"], "to": edge["to"]}],
        }
        try:
            graph_authoring._validate(trial)  # noqa: SLF001
        except graph_authoring.AuthoringError as exc:
            problems[edge["key"]] = str(exc)
    return problems


# ── the run ──────────────────────────────────────────────────────────────────


def active_run() -> str | None:
    return _active["run_id"]


def propose(document_ids: list[str] | None = None, *, model: str | None = None) -> dict[str, Any]:
    """Read the corpus, extract candidates, queue what survives.

    Returns the run row. Nothing is written to the graph.
    """
    if not _lock.acquire(blocking=False):
        raise ProposalError(f"a proposal run is already going ({_active['run_id']})")
    run_id = f"prop_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
    try:
        _active["run_id"] = run_id
        return _run(run_id, document_ids, model)
    finally:
        _active["run_id"] = None
        _lock.release()


def _pick_model(requested: str | None) -> str:
    from . import inference  # noqa: PLC0415 — avoids an import cycle at boot

    choice = inference.choose_model(requested)
    tag = choice.get("tag")
    if not tag:
        raise ProposalError(
            "no model is available to extract with. Pull one in the Forge — this runs a local "
            "model over the corpus and cannot work without one."
        )
    return str(tag)


def _run(run_id: str, document_ids: list[str] | None, model: str | None) -> dict[str, Any]:
    started = datetime.now(timezone.utc)
    tag = _pick_model(model)

    chunks = corpus_store.list_chunks(limit=MAX_CHUNKS * 4)["chunks"]
    if document_ids:
        wanted = set(document_ids)
        chunks = [c for c in chunks if c["document_id"] in wanted]
    chunks = chunks[:MAX_CHUNKS]
    if not chunks:
        raise ProposalError(
            "there is nothing to read. The proposer extracts from ingested chunks, so import and "
            "ingest documents in Blueprints → Corpus → Build first."
        )

    with _connect() as conn:
        conn.execute(
            "INSERT INTO proposal_runs (run_id, created_at, model, documents_read, chunks_read) "
            "VALUES (?,?,?,?,?)",
            (run_id, _now(), tag, len({c["document_id"] for c in chunks}), len(chunks)),
        )

    forms = _surface_forms()
    # Edges need their own duplicate guard, and it cannot come from the
    # validator. A node that already exists fails validation as a duplicate id;
    # a *edge* that already exists does not fail at all — the graph is a
    # MultiDiGraph keyed by edge type, so re-adding one is a silent no-op. It
    # passed the dry run as valid and then failed at accept time with "already
    # exists", which puts the discovery in the worst possible place: after a
    # person has reviewed it and clicked.
    existing_edges = {
        graph_authoring.edge_key(e.get("from", ""), e.get("type", ""), e.get("to", ""))
        for e in graph_authoring._read_raw()["edges"]  # noqa: SLF001
    }
    seen: set[str] = set()
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    duplicates = 0
    failures: list[str] = []

    for chunk in chunks:
        try:
            raw = ollama_client.generate(
                tag, _prompt(chunk["text"], sorted(forms.values())),
                system=_SYSTEM, json_format=True, timeout=CALL_TIMEOUT,
            )
            parsed = json.loads(raw)
        except Exception as exc:  # noqa: BLE001 — one bad chunk is not a bad run
            failures.append(f"{chunk['chunk_id']}: {exc}")
            continue
        if not isinstance(parsed, dict):
            continue

        for item in parsed.get("nodes") or []:
            if not isinstance(item, dict):
                continue
            node_type = str(item.get("type") or "")
            if node_type not in kg.NODE_TYPES:
                continue  # outside the ontology — dropped before it can be queued
            node_id = _node_id(node_type, item.get("id_suffix") or item.get("label") or "")
            if not node_id or node_id in seen:
                continue
            label = str(item.get("label") or "")
            if _canonical(node_id, label, forms):
                duplicates += 1
                continue
            seen.add(node_id)
            attributes = item.get("attributes") if isinstance(item.get("attributes"), dict) else {}
            if label:
                attributes = {"label": label, **attributes}
            nodes.append({
                "key": node_id, "id": node_id, "type": node_type, "attributes": attributes,
                "evidence": str(item.get("evidence") or "")[:1000],
                "chunk": chunk,
            })

        for item in parsed.get("edges") or []:
            if not isinstance(item, dict):
                continue
            edge_type = str(item.get("type") or "")
            src, dst = str(item.get("from") or ""), str(item.get("to") or "")
            if edge_type not in kg.EDGE_TYPES or not src or not dst:
                continue
            key = graph_authoring.edge_key(src, edge_type, dst)
            if key in seen:
                continue
            if key in existing_edges:
                duplicates += 1
                continue
            seen.add(key)
            edges.append({
                "key": key, "from": src, "type": edge_type, "to": dst,
                "evidence": str(item.get("evidence") or "")[:1000],
                "chunk": chunk,
            })

    problems = _dry_run(nodes, edges)

    rows = []
    for node in nodes:
        rows.append((
            f"prop_{uuid.uuid4().hex[:12]}", run_id, _now(), "pending", "node",
            node["type"], node["id"], json.dumps(node["attributes"], default=str),
            None, None, None,
            node["chunk"]["document_id"], node["chunk"]["chunk_id"], node["evidence"],
            None, tag,
            0 if node["key"] in problems else 1, problems.get(node["key"]),
        ))
    for edge in edges:
        rows.append((
            f"prop_{uuid.uuid4().hex[:12]}", run_id, _now(), "pending", "edge",
            None, edge["key"], None,
            edge["from"], edge["type"], edge["to"],
            edge["chunk"]["document_id"], edge["chunk"]["chunk_id"], edge["evidence"],
            None, tag,
            0 if edge["key"] in problems else 1, problems.get(edge["key"]),
        ))

    with sqlite_util.transaction(paths.CORPUS_DB) as conn:
        conn.executemany(
            """
            INSERT INTO graph_proposals (
                proposal_id, run_id, created_at, status, target,
                node_type, element_id, attributes_json,
                source_id, edge_type, target_id,
                document_id, chunk_id, evidence, rationale, model,
                valid, validation_error
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            rows,
        )
        conn.execute(
            "UPDATE proposal_runs SET status = ?, finished_at = ?, elapsed_ms = ?, "
            "proposed = ?, duplicates = ?, invalid = ?, error = ? WHERE run_id = ?",
            (
                "ok" if not failures else "failed", _now(),
                int((datetime.now(timezone.utc) - started).total_seconds() * 1000),
                len(rows), duplicates, len(problems),
                "; ".join(failures[:5]) or None, run_id,
            ),
        )
    return get_run(run_id) or {}


# ── the queue ────────────────────────────────────────────────────────────────


def get_run(run_id: str) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM proposal_runs WHERE run_id = ?", (run_id,)).fetchone()
    return dict(row) if row else None


def list_runs(limit: int = 10) -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM proposal_runs ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def list_proposals(status: str = "pending", limit: int = 200) -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM graph_proposals WHERE status = ? "
            # Nodes before edges, because an edge is only acceptable once its
            # endpoints exist and a reviewer working top-down should not hit a
            # refusal caused by a row further down the list.
            "ORDER BY CASE target WHEN 'node' THEN 0 ELSE 1 END, created_at LIMIT ?",
            (status, limit),
        ).fetchall()
    out = []
    for row in rows:
        item = dict(row)
        if item.get("attributes_json"):
            try:
                item["attributes"] = json.loads(item["attributes_json"])
            except (ValueError, TypeError):
                item["attributes"] = {}
        else:
            item["attributes"] = {}
        out.append(item)
    return out


def _decide(proposal_id: str, status: str, error: str | None = None) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE graph_proposals SET status = ?, decided_at = ?, decided_error = ? "
            "WHERE proposal_id = ?",
            (status, _now(), error, proposal_id),
        )


def accept(proposal_id: str) -> dict[str, Any]:
    """Apply one proposal through the normal authoring path.

    Deliberately `graph_authoring.create_node` / `create_edge` and not a private
    shortcut: an accepted proposal must be validated, written and **logged to
    `graph_edits` exactly like a hand-authored one**. The history should not be
    able to tell them apart at write time, because the write is the same event —
    what differs is who typed it, and that is what `graph_proposals` records.
    """
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM graph_proposals WHERE proposal_id = ?", (proposal_id,)
        ).fetchone()
    if row is None:
        raise ProposalError(f"no proposal {proposal_id!r}")
    if row["status"] != "pending":
        raise ProposalError(f"this proposal is already {row['status']}")

    try:
        if row["target"] == "node":
            attributes = json.loads(row["attributes_json"] or "{}")
            result = graph_authoring.create_node(row["node_type"], row["element_id"], attributes)
        else:
            result = graph_authoring.create_edge(row["source_id"], row["edge_type"], row["target_id"])
    except graph_authoring.AuthoringError as exc:
        # Recorded on the row rather than raised away: a proposal that could not
        # be applied is a fact about the proposer worth keeping, and the reviewer
        # needs the reason on the row they were looking at.
        _decide(proposal_id, "failed", str(exc))
        raise ProposalError(str(exc)) from exc

    _decide(proposal_id, "accepted")
    return result


def reject(proposal_id: str) -> None:
    _decide(proposal_id, "rejected")


def status() -> dict[str, Any]:
    """Queue counts and recent runs — the panel's one call."""
    try:
        with _connect() as conn:
            counts = {
                r["status"]: r["n"]
                for r in conn.execute(
                    "SELECT status, COUNT(*) AS n FROM graph_proposals GROUP BY status"
                ).fetchall()
            }
        corpus = corpus_store.stats()
        return {
            "available": True,
            "counts": {
                k: counts.get(k, 0) for k in ("pending", "accepted", "rejected", "failed")
            },
            # What the proposer can read. Stated up front, because "nothing was
            # proposed" and "there was nothing to read" are different answers.
            "chunks_available": corpus.get("chunks", 0),
            "max_chunks": MAX_CHUNKS,
            "active_run": active_run(),
            "runs": list_runs(),
        }
    except Exception as exc:  # noqa: BLE001 — a status call reports, never raises
        return {"available": False, "error": str(exc), "counts": {}, "runs": []}
