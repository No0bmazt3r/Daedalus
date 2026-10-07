-- Track 2's authoring history — the graph half of the knowledge layer.
--
-- ## Why this is in the corpus store and not a new one
--
-- The file is named for what it first held. What it *is* is the knowledge
-- layer's operational store: metadata about how each track's knowledge got
-- there. Track 1's half is documents and chunks; Track 2's is the edit history
-- of the authored graph. Neither is the knowledge itself — that is Chroma and
-- the YAML — and both are operational records of the same subsystem.
--
-- MODULES.md §3.4 chose a git-tracked YAML over a store for the graph, and that
-- still holds: the YAML remains the source of truth and the thing that reviews
-- in a diff. This table is not a second copy of the graph. It is the answer to
-- "who changed this node, when, and what did it look like before" for edits made
-- through the app rather than through a commit — which is exactly the history
-- git cannot show, because an in-app edit is not a commit until somebody makes
-- one.
--
-- ## Why the before/after payloads are stored whole
--
-- A diff is reconstructible from two snapshots; two snapshots are not
-- reconstructible from a diff plus a graph that has since moved on. The graph is
-- tens of nodes, the payloads are small, and an undo that cannot reproduce the
-- exact prior state is not an undo.

CREATE TABLE IF NOT EXISTS graph_edits (
    edit_id     TEXT PRIMARY KEY,
    at          TEXT NOT NULL,
    -- What was touched. `node` and `edge` are the graph's two element kinds;
    -- `graph` covers whole-file operations like a validated import.
    target      TEXT NOT NULL CHECK (target IN ('node','edge','graph')),
    action      TEXT NOT NULL CHECK (action IN ('create','update','delete','import')),
    -- The node id, or "from|TYPE|to" for an edge. Not a foreign key: the whole
    -- point of a history is that it outlives the row it describes.
    element_id  TEXT,
    element_type TEXT,

    before_json TEXT,
    after_json  TEXT,

    -- Refused edits are recorded too. A validation failure is the most
    -- interesting thing in an authoring session — it is the schema catching
    -- something — and a log that only kept successes would hide exactly the
    -- events somebody is debugging.
    ok          INTEGER NOT NULL DEFAULT 1,
    error       TEXT,

    -- Graph totals immediately after, so the history doubles as a size curve
    -- without replaying every edit.
    nodes_after INTEGER,
    edges_after INTEGER,
    note        TEXT
);

CREATE INDEX IF NOT EXISTS idx_graph_edits_at ON graph_edits(at DESC);
CREATE INDEX IF NOT EXISTS idx_graph_edits_element ON graph_edits(element_id);
CREATE INDEX IF NOT EXISTS idx_graph_edits_ok ON graph_edits(ok);
