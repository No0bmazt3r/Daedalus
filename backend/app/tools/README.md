# Tools — what the model is allowed to use

Deterministic functions the planner calls; the model never touches a database
itself. Every call passes the registry's gates (allowed, enabled, arguments
valid, read-only unless unlocked) and is logged. Also the external integrations
that tools reach through: web search and MCP servers.

Screen: `components/settings/AgentToolsPanel.tsx`, `IntegrationsPanel.tsx`, `SearchPanel.tsx`

## Files

| File | Job |
|---|---|
| `agent_tools/registry.py` | Registration, the gates, capability locks, logging |
| `agent_tools/sensor.py` | Readings and trends (read-only sensor DB) |
| `agent_tools/search.py` | Track 1 hybrid search (BM25 + vector, RRF, re-rank) and Track 2 search |
| `agent_tools/knowledge.py`, `session.py`, `system.py`, `other.py` | The remaining built-in tools |
| `agent_tools/extended/` | Advanced-mode tools: MCP, web, workspace, execute, state, orchestration |
| `mcp_client.py` | The MCP protocol (stdio/HTTP) |
| `mcp_servers.py` | Connect, pin the tool list, report drift |
| `web_search.py` | Web-search providers (SearXNG, …) |

## Routes — `api/`

| File | Prefix |
|---|---|
| `tools.py` | `/api/tools` — list, schemas, try, policy (locks, enable/disable, mode) |
| `mcp.py` | `/api/mcp` |
| `search.py` | `/api/search` |

## Touches

- **Stores:** sensor (read-only), audit (`tool_logs`), prefs (`tool_policy_store`, `mcp_store`, `search_store`), corpus, vectors
- **Depends on:** blueprints (the two tracks), forge (`embedding_models`, `reranker`)

Tests: `backend/tests/tools/`, `backend/tests/retrieval/test_hybrid.py`
