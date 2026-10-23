# System — plumbing every other module leans on

Not a feature window of its own: health, preferences, live updates, the process
log, the raw store browser (Data stores), backup/import, SearXNG containers and
the danger zone.

Screen: `components/stores/`, `components/settings/SystemPanel.tsx`, `DatabasesPanel.tsx`

## Files

| File | Job |
|---|---|
| `live_events.py` | Publishes "something changed" (models, corpus, trace, …) over SSE |
| `app_logs.py` | The process log: rotating file, secrets scrubbed |
| `log_browser.py` | Read-only, allow-listed browser over the stores |
| `maintenance.py` | Backup export/import, wipes |
| `containers.py` | Start/stop SearXNG from the UI |

## Routes — `api/`

| File | Prefix |
|---|---|
| `health.py` | `/api/health` |
| `prefs.py` | `/api/prefs` — settings store, `theme.css` |
| `events.py` | `/api/events` — the SSE stream |
| `logs.py` | `/api/logs` — Data stores browser |
| `system.py` | `/api/system` — observability, databases, demo seeding, model list |
| `maintenance.py` | `/api/system` — process log, export/import, containers, wipe |

## Touches

- **Stores:** all of them (read-only browsing, backup); prefs (read/write)
- **Depends on:** forge (`ollama_client`, `model_config`), blueprints (`graph_seed`)

Tests: `backend/tests/test_error_reporting.py`, `test_scrub.py`, `test_migrations.py`
