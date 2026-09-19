-- MCP servers — external tool providers Daedalus can connect to.
--
-- ## Why this table has a `tools_hash` column
--
-- Every other tool in this project is declared in Python, reviewed in a diff and
-- gated on effects known before the call (`services/agent_tools/registry`).
-- `PROJECT.md` §7.2 is explicit that the tool layer is deterministic and
-- whitelisted, and §5's comparison requires both tracks to be frozen while it
-- runs.
--
-- An MCP server breaks both properties by design: it declares its own tools at
-- connect time, with its own schemas, and it may declare different ones
-- tomorrow. That is the whole point of the protocol and it is genuinely useful —
-- but a benchmark recorded against a tool list nobody wrote down is not
-- reproducible, and "the agent had a tool we cannot name" is the kind of gap a
-- reviewer is entitled to ask about.
--
-- So the tool list is snapshotted at connect time and hashed. A later connection
-- that returns a different list is reported as **drift** rather than silently
-- adopted, and the snapshot is what a results chapter can quote.
--
-- ## Why there is no `api_key`
--
-- An HTTP server's credential, if it needs one, goes in `headers_json`, which is
-- the same plain-text caveat every other credential in this database carries and
-- is never returned by the API. A stdio server's credentials are its own
-- business — it is a process on this machine, started by the operator.
--
-- ## Why `command` is not reachable from a tool
--
-- A stdio server is a program this backend spawns. `manage_mcp` is offered to
-- the model read-only for exactly that reason: a model that could write this row
-- could name any executable on the machine and have it started, which is
-- `execute_code` with none of the containment. Adding a server is an operator
-- action, through Settings.

CREATE TABLE IF NOT EXISTS mcp_servers (
    id                TEXT PRIMARY KEY,        -- mcp_YYYYMMDD_HHMMSSffffff_xxxx
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,

    label             TEXT NOT NULL,
    transport         TEXT NOT NULL CHECK (transport IN ('stdio', 'http')),

    -- stdio: the program and its arguments, as a JSON array of strings.
    command           TEXT,
    args_json         TEXT NOT NULL DEFAULT '[]',
    -- Extra environment for the child. Never inherited wholesale — see
    -- services/mcp_client.py, which scrubs for the same reason the execute
    -- tools do.
    env_json          TEXT NOT NULL DEFAULT '{}',

    -- http: the endpoint, and any headers it needs (auth included).
    url               TEXT,
    headers_json      TEXT NOT NULL DEFAULT '{}',   -- never returned by the API

    enabled           INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),

    -- The last successful handshake, and what the server said it could do.
    last_connected_at TEXT,
    last_error        TEXT,
    server_name       TEXT,
    server_version    TEXT,
    protocol_version  TEXT,

    -- The frozen tool list, and a hash of it. See the note above.
    tools_json        TEXT,
    tools_hash        TEXT,
    tools_pinned_at   TEXT
);

-- One row per label: two servers with the same name makes "which one answered
-- this call" unanswerable in a log, which is the question tool_logs exists for.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_servers_label ON mcp_servers(label);
