# Daedalus backend

FastAPI service for the Daedalus UI. Currently exposes the user-preference
store that replaces browser localStorage; the Layer 7 chat/tool routers mount
into the same app as they land.

## Run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Run it from this `backend/` directory. The Vite dev server proxies `/api` to
`http://localhost:8000`, so the frontend needs no extra configuration.

## Storage

SQLite at `backend/data/prefs.db`, table `user_prefs(user_id, key, value,
updated_at)` with the value held as JSON.

This is a **separate database file from the sensor DB on purpose**: Layer 3
opens `sensor_readings` strictly read-only, and preferences are the one thing
the UI must write. Keeping them apart preserves that contract.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness; also lets the UI tell "backend down" from "nothing saved yet" |
| `GET` | `/api/prefs` | Every preference in one round trip (used on boot) |
| `GET` | `/api/prefs/{key}` | Read one |
| `PUT` | `/api/prefs/{key}` | Write one, body `{"value": ...}` |
| `DELETE` | `/api/prefs/{key}` | Clear one |

Writable keys: `theme`, `custom-themes`, `ui-scale`.

Interactive docs while running: <http://localhost:8000/docs>
