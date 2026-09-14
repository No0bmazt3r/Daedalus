# Implementation Reference

**What actually exists in the code right now.** [`PROJECT.md`](PROJECT.md)
describes what the system is *intended* to be; this file describes what is
*built*. Where they differ, that gap is the work remaining — see
[`../TODO.md`](../TODO.md).

Everything below was read off the source, not from memory.

---

## 1. At a glance

| Subsystem | State |
|---|---|
| React dashboard shell | Built |
| Theme engine | Built — the most complete subsystem |
| Background effects | Built, pointer-reactive |
| Settings shell | Built — registry, search, resizable rail |
| Data stores (×5) | Built and containerised, each with a versioned schema |
| Preference API | Built |
| Chat session store | Built — sessions, transcripts, context-window assembly |
| Chat UI | Wired to the session API — real sidebar, persisted user turns. **Replies still mock** (no orchestrator) |
| Orchestration, tools, RAG, Ollama | **Not started** |

---

## 2. HTTP API

All endpoints are served by the FastAPI app in `backend/app/`. In the container
the same process also serves the built SPA; in development Vite proxies `/api`
to it.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness. Also distinguishes "backend down" from "nothing saved yet" |
| `GET` | `/api/prefs` | Every preference in one round trip — used on boot |
| `GET` | `/api/prefs/{key}` | Read one preference |
| `PUT` | `/api/prefs/{key}` | Write one, body `{"value": …}` |
| `DELETE` | `/api/prefs/{key}` | Clear one |
| `GET` | `/api/prefs/theme.css` | The saved palette as a stylesheet — see §3 |
| `POST` | `/api/sessions` | Open a chat. Body optional; `{}` is the normal call |
| `GET` | `/api/sessions` | Sidebar list, most recently updated first |
| `GET` | `/api/sessions/{id}` | One session, including its rolling summary |
| `PATCH` | `/api/sessions/{id}` | Rename and/or archive |
| `DELETE` | `/api/sessions/{id}` | Delete a chat and its messages — audit rows survive |
| `GET` | `/api/sessions/{id}/messages` | Full transcript, oldest first |
| `POST` | `/api/sessions/{id}/messages` | Append a **user** message |
| `GET` | `/api/logs/catalogue` | Browsable tables with live row counts |
| `GET` | `/api/logs/{store}/{table}` | A page of raw rows — read-only, allowlisted |
| `GET` | `/api/providers/catalogue` | Cloud providers offered in the UI |
| `GET`/`POST` | `/api/providers` | List / add a benchmark endpoint |
| `PATCH`/`DELETE` | `/api/providers/{id}` | Edit or remove one |
| `POST` | `/api/providers/{id}/test` | Connection test — the only outbound call |
| `GET` | `/api/system/databases` | Health, size, schema version and metrics for all five stores |
| `POST` | `/api/system/seed-demo` | Generate demo telemetry. **Dev only, unauthenticated** |

Writable preference keys (anything else is rejected with 404):

| Key | Shape |
|---|---|
| `theme` | Full `ThemeState` object |
| `custom-themes` | `{ [slug]: CustomThemeEntry }`, max 8 |
| `ui-scale` | `"100"` or `"125"` |
| `settings-ui` | `{ width: number, collapsed: boolean }` |

Interactive docs while running: <http://localhost:8000/docs>

### Why only user messages are writable

`POST /api/sessions/{id}/messages` has no `role` field. History is replayed
into the model's context on the following turn, so a client able to post an
*assistant* message could plant a fabricated sensor reading where the model
reads it as its own previous answer — and narrate it back as fact. Assistant
turns are written by the orchestrator via `chat_service.add_assistant_message()`
once it has actually produced them.

Same reasoning puts the transcript on the server rather than having the browser
post it back each turn: client-held history is a client-controlled input to the
prompt, and a forged turn is indistinguishable from a real one.

### Why `theme.css` exists

Preferences live on the server, so they cannot be read synchronously the way
`localStorage` could — the app would flash the default palette on every load.
This endpoint emits the saved palette as a render-blocking stylesheet that
`index.html` links in `<head>`, so the first painted frame is already themed.

It interpolates stored values into CSS, so it **only** emits exact `#rrggbb`
matches and known enum values. Verified: a payload with
`"bg": "red; } body { display:none } :root{ "` and
`"font": "</style><script>…"` has all hostile fields dropped. `font` is never
interpolated at all — the stored value only ever selects a row of
`_FONT_STACKS`, and anything that isn't a key falls through to the default
face, so the emitted stylesheet is bounded by that table.

---

## 3. Data stores

Five physically separate databases. The separation is the safety argument, not
tidiness — see `PROJECT.md` §6.3.

| Store | Module | Engine | Access |
|---|---|---|---|
| Sensor | `db/sensor_store.py` | SQLite | **read-only** (`file:…?mode=ro`) |
| Audit | `db/audit_store.py` | SQLite | read/write |
| Chat | `db/chat_store.py` | SQLite | read/write |
| Vector | `db/vector_store.py` | ChromaDB | read/write |
| Prefs | `db/prefs_store.py` | SQLite | read/write |

Paths resolve centrally in `db/paths.py`, overridable by environment:
`DAEDALUS_DATA_DIR`, `DAEDALUS_LOG_DIR`, `DAEDALUS_PREFS_DB`,
`DAEDALUS_CHAT_DB`, `CHROMA_URL`.

Connection handling is shared in `db/sqlite_util.py` — WAL, a 5s busy timeout,
`foreign_keys=ON` (per-connection, and off by default, so a schema with
`ON DELETE CASCADE` silently does nothing without it), `BEGIN IMMEDIATE` write
transactions, randomised retry on lock contention, `VACUUM INTO` backups and
`quick_check` integrity checks.

> **WAL needs real shared memory.** Keep the data directory on a native Linux
> filesystem — network mounts and Windows-hosted paths under WSL (`/mnt/c/...`)
> fail by corrupting rather than erroring.

### Sensor store — the read-only boundary

```python
conn = sqlite3.connect(f"file:{SENSOR_DB}?mode=ro", uri=True)
```

The driver refuses writes, so the boundary holds below the application where a
prompt injection cannot reach it. **Verified:** INSERT, UPDATE, DELETE and DROP
all raise `attempt to write a readonly database`; reads keep working.

`SENSOR_COLUMNS` maps friendly tool-facing names (`temperature`) to real
columns (`temp_c`), so no caller-supplied string ever reaches SQL.
`AGGREGATIONS` whitelists `average | min | max | count`.

`seed_demo()` generates a plausible run (diurnal drift plus one injected CO₂
excursion) for offline development. Idempotent — it refuses if rows exist.

### Audit store — seven tables

`conversation_logs` · `tool_logs` · `rag_logs` · `model_logs` · `error_logs` ·
`feedback_logs` · `memory_logs`

Every row carries a `query_id` (`q_YYYYMMDD_HHMMSSffffff`), so one question
traces end to end. `trace(query_id)` returns every row across all tables — this
is what answers *"prove this response was grounded"*.

`log()` **never raises.** A failed audit write must not take down a chat
response; logging is evidence, not control flow.

> `memory_logs` is an addition — it appears in neither historical spec set.

### Chat store — conversation memory

Two tables. `chat_sessions` holds one row per conversation (title, rolling
summary, `ephemeral` for incognito, `archived_at`); `chat_messages` holds the
turns.

Ollama is stateless, so "the assistant remembers" only ever means the
orchestrator re-sent the transcript. This store is that transcript — and both
halves of the problem reduce to it: within a session every turn rebuilds the
prompt from these rows, and across sessions reopening a chat reads the same
rows back. Only *how much* is replayed differs.

**`seq`, not `created_at`, orders a transcript.** Two messages can share a
timestamp and the conversation would silently scramble. It is allocated as
`MAX(seq) + 1` inside the same `BEGIN IMMEDIATE` transaction that inserts, with
a unique index on `(session_id, seq)` as the backstop.

**Separate from the audit store on purpose**, though both hold conversation
text. Opposite lifecycles: a user renames, archives and deletes their own
chats; audit rows are append-only evidence the evaluation chapter rests on.
Two files make *"deleting a chat cannot delete the evidence"* a filesystem
property rather than a promise about our DELETE statements. `query_id` links
them; `ATTACH` to join.

**Failure contract is the inverse of `audit_store`.** That module swallows
errors, because a failed log must not take down a response. This one raises: a
transcript that silently fails to persist looks fine until the user reopens the
chat and it is gone. Losing evidence of a turn is recoverable; losing the turn
is not.

#### Context assembly — `services/chat_service.py`

`build_context()` turns a stored transcript into the messages that go into a
prompt, inside a token budget (default 1200 — the SLM tier runs at num_ctx
4096–8192 and the evidence pack plus SOP chunks already claim 1–2k). It
accumulates newest-first, drops whole turns that do not fit, and trims a window
that would open on an orphaned assistant message.

Replayed history is a **Rule 3 hazard**: turn 3 said "CO₂ is 470.2 ppm", and at
turn 9 the model has a number in context that it did not fetch. Three defences:

1. `evidence_json` is stored for the UI but **never replayed** — only natural
   language is.
2. Every historical assistant turn is stamped with the time it was said, and a
   `HISTORY_NOTICE` system line tells the model what that stamp means.
3. Groundedness validation (Layer 7) checks the answer's numbers against the
   *current* evidence pack only; a number appearing only in history sets
   `hallucination_flag`.

The third is what measures the problem — it feeds the <10% hallucination
target directly. The first two reduce how often it arises.

`ContextWindow.needs_summary` reports that turns fell out of the window, so the
orchestrator can fold them into the rolling summary **after** responding.
Summarisation is another inference call; doing it inline would spend the
latency budget the <3s target is measured against.

### Raw store browser — `services/log_browser.py`

Backs Settings → Databases → **Browse rows**: a draggable popup with Peek (transparency) UI showing what is actually in the stores right now. `trace(query_id)` proves one response was grounded; this shows everything that has been recorded. It now spans across `chat`, `audit`, `sensor` (telemetry & anomalies), and `vector` (knowledge base embeddings).

Three properties, all verified:

| Property | How |
|---|---|
| Allowlist, not reflection | A store and table are checked against `BROWSABLE` before any SQL is built, so no caller string reaches a query. `sqlite_master` and `prefs` return 404 |
| Read-only | Every connection is opened `mode=ro`; the driver refuses writes |
| Secrets unreachable | `model_endpoints` is absent from `BROWSABLE` entirely, and `REDACTED_COLUMNS` masks credential-shaped columns as a second line |

Rows are ordered by `rowid`, not a timestamp column — every table has one, it is
always insertion order, and same-second rows would otherwise be arbitrary.
Cells over 4000 characters are truncated with a count, so one large transcript
cannot push megabytes into the browser.

### Dynamic Model Discovery — `/api/system/models`

Daedalus fetches models dynamically rather than keeping hardcoded lists. The frontend components (Chat model selector) adaptively query the `/api/system/models` endpoint which aggregates:
- **Local Models:** Probes the local Ollama instance (at `OLLAMA_BASE_URL`) for downloaded SLMs, failing fast if offline.
- **Cloud Baselines:** Includes any external endpoints configured in the Added Models settings.

### Cloud model endpoints — `services/model_endpoints.py`

Settings → **Add Models**. Configures OpenAI, Anthropic, DeepSeek, OpenRouter,
Groq, Mistral, Together, Gemini or any OpenAI-compatible URL.

**These are benchmark baselines, not runtime models.** Rule 1 forbids cloud
APIs in the live query path and permits them as offline evaluation references
(§5's comparison needs a ceiling; §2.2 #7 adds LLM-as-a-judge over exported
logs). The rule is enforced by the schema, not by intent:

```sql
purpose TEXT NOT NULL DEFAULT 'benchmark' CHECK (purpose = 'benchmark')
```

**Verified:** inserting a row with `purpose='runtime'` raises
`CHECK constraint failed: purpose = 'benchmark'`.

The key is write-only over HTTP. It goes in through `POST`/`PATCH` and comes
back only as `key_hint` (`sk-…9f4a`); `EndpointOut` has no `api_key` field at
all, so a future handler cannot leak it by returning the wrong dict.
`store.secret_for()` is the single named accessor that returns the real value.

`test_endpoint()` calls `GET {base_url}/models` — the OpenAI-compatible
convention, costs nothing, and answers both questions a user has (is the URL
right, is the key accepted) without spending tokens. **A failed test is a 200
with `last_test_ok: false`**, not an HTTP error: the request succeeded, and
"your key was rejected" is its finding. Every failure mode maps to a sentence
that says what to fix — a rejected key and an unreachable host must not read
the same.

### Schema migrations — `db/migrations.py`

Numbered SQL files under `db/migrations/<store>/`, applied once, in order,
each inside its own transaction, recorded in a `schema_migrations` table and
mirrored to `PRAGMA user_version`. Applied automatically at startup; the CLI
(`./daedalus.sh migrate`, or `python -m app.db.migrate`) offers `status`, `up`,
`check`, `backup`, `repair` and `new`.

Four safety properties, all verified:

| Situation | Behaviour |
|---|---|
| An applied file is edited | Refuses to run — checksum mismatch, names the file |
| A number fills a gap below the applied version | Refuses — anyone already migrated would skip it |
| An applied file is missing from disk | Refuses — the database can no longer be reasoned about |
| A migration contains bad SQL | Rolls that file back entirely; version unchanged |

`status` exits `0`/`2`/`1` for up-to-date/pending/broken, so CI can tell "needs
migrating" from "is wrong". A migration failure at startup is deliberately
fatal.

`sensor` is deliberately unmanaged: the SCADA subsystem owns that schema, and
migrating a database we do not own breaches Rule 2 as surely as an INSERT.

> `IF NOT EXISTS` in each `001` is deliberate — it baselines the databases that
> existed before the runner did, rather than erroring on them.

### Vector store

Two shapes behind one interface: **server mode** when `CHROMA_URL` is set (the
compose service), **embedded mode** otherwise (a persistent client under
`data/chroma`). Collection: `daedalus_knowledge`.

Chroma is an **optional import**. A machine without it still boots the
dashboard and preference API; absence is reported as a status, not raised.
The container installs `chromadb-client` rather than full `chromadb` — it only
talks HTTP, and the full package drags in onnxruntime for embedded mode the
image never uses.

---

## 4. Theme engine — `frontend/src/lib/themes.ts`

The most complete subsystem: 16 presets, live editing, and everything derived
rather than hand-listed.

### State

```ts
interface ThemeState {
  id: string            // active theme, or 'custom' for unsaved edits
  originId: string      // what it was derived from — drives per-row reset
  colors: ThemeColors   // 7 base colours
  advanced?: AdvancedColors  // 14 optional per-zone overrides
  font, density, pattern, effectColor,
  effectIntensity, effectSize, frosted, reactive
}
```

`originId` matters: editing a preset moves `id` to the transient `custom` slot,
but the per-row reset buttons still need to know what to snap back to.

### Derivation

Nothing is hand-listed that can be computed:

| Function | Derives |
|---|---|
| `deriveSyntaxColors()` | A 10-token syntax ramp from bg/text/primary |
| `computeAdvancedDefaults()` | All 14 per-zone colours, so they track the base palette |
| `deriveIncognitoColor()` | A complementary accent, contrast-corrected |
| `generateHarmonyColors()` | A full palette from one accent + harmony type |

**Incognito colour rule.** Rotate the accent 150° (distinct but harmonious),
floor saturation at 55 (a muted accent would produce an easily-missed state),
then walk lightness away from the background until it clears **4.5:1**. A fixed
lightness failed on light themes at ~2:1. Near-greyscale accents have no hue to
rotate, so those fall back to violet. All 16 themes verified ≥4.5:1.

### CSS variables written

**Base (7):** `--bg` `--sidebar` `--card` `--border` `--primary` `--text-main` `--text-muted`
**Syntax (10):** `--hl-bg` `--hl-fg` `--hl-keyword` `--hl-string` `--hl-comment` `--hl-function` `--hl-number` `--hl-builtin` `--hl-variable` `--hl-params`
**Zones (14):** `--user-bubble-bg` `--ai-bubble-bg` `--bubble-border` `--sidebar-bg` `--brand-color` `--brand-mix-to` `--input-bg` `--input-border` `--send-btn-bg` `--send-btn-hover` `--code-bg` `--code-fg` `--toggle-active` `--incognito`
**Effects (4):** `--bg-effect-color` `--bg-effect-intensity` `--bg-effect-size` `--bg-effect-reactive`
**Typography (1):** `--font-family`

Emits `daedalus-theme-change` on every apply; the effects layer listens to
invalidate its cached variable reads.

### CSS utility classes — `frontend/src/index.css`

| Group | Classes |
|---|---|
| Theme surfaces | `.theme-bg` `.theme-sidebar` `.theme-card` `.theme-border` `.theme-text` `.theme-text-muted` `.theme-primary` `.theme-bg-primary` |
| Editable zones | `.zone-sidebar` `.zone-brand` `.zone-brand-text` `.zone-input` `.zone-send-btn` `.zone-user-bubble` `.zone-ai-bubble` `.zone-bubble-border` `.zone-code` `.zone-toggle-active` |
| Incognito | `.incognito-text` `.incognito-bg` `.incognito-bg-soft` `.incognito-glow` `.incognito-drop-glow` `.incognito-placeholder` |
| Patterns | `.bg-pattern-dots` `.bg-pattern-synapse` |
| Layout | `.no-scrollbar` `.density-compact` `.density-spacious` `.ui-scale-125` `.theme-frosted` `.theme-range` |
| Tooling | `.theme-zone-highlight` |

The shadcn design tokens (`--popover`, `--accent`, `--muted-foreground`, …) are
re-pointed at the theme variables in `index.css`. Without that they resolve to
the fixed light-mode oklch defaults, and since the app never sets `.dark`,
every dropdown and popover rendered white regardless of theme.

---

## 5. Background effects

Nine options; seven canvas-animated. `frontend/src/lib/canvasEffects.ts` was ported from
Odysseus (a reference app no longer vendored in this repo);
`frontend/src/lib/pointerField.ts` is new.

| Effect | Pointer reaction |
|---|---|
| Synapse | Pulses brighten and swell; movement fires new pulses down nearby grid lines |
| Rain | Drops part around the cursor and slow as they pass |
| Constellations | The cursor becomes a star — nearby stars link to it and drift toward it |
| Perlin Flow | The flow field bends into a vortex |
| Petals | Sweeping acts as a gust, pushing and spinning petals away |
| Sparkles | A sparkle trail follows the cursor; nearby ones brighten |
| Embers | Acts as a draft, fanning embers outward and up |
| Dots, Solid | Static — the Reactive toggle disables itself |

> Odysseus's effects are **not** reactive — all `pointer-events: none` with no
> pointer handling. Cursor reactivity is new work here.

One window listener serves every effect; canvases stay click-through. `energy`
decays ~1.2s after movement stops, so the background settles rather than
staying deformed around a parked cursor.

**Performance notes worth preserving.** CSS variable reads are cached and
invalidated on `daedalus-theme-change` — `effectScale()` was originally called
once *per ember per frame* (~60 style recalcs/frame). The canvas rect is cached
with a 250ms TTL, because `getBoundingClientRect()` forces layout.

---

## 6. Settings shell

`frontend/src/lib/settingsRegistry.ts` is the single source of truth: every panel
declares its id, label, group, icon, keywords, `adminOnly` and `implemented`
flag once. Nav, groups and search all read from it, so they cannot drift apart.

- **Search** matches labels, group names *and* keywords — `vram` → Hardware,
  `sqlite` → Databases. Arrow keys navigate, Enter opens, Escape clears.
- **Resizable rail** — 150–340px, drag below 110px to collapse.
  `role="separator"` with live `aria-valuenow`; Enter/Space toggles, arrows
  resize in 16px steps.
- **Persisted** to `settings-ui` server-side, not `localStorage`.
- Unbuilt panels carry a dot, and search says "not built yet" rather than
  opening a dead page silently.

**Built panels:** Add Models · Databases · Shortcuts. Everything else is a
placeholder.

---

## 7. Frontend structure

Paths are relative to `frontend/src/`.

| Path | Role |
|---|---|
| `contexts/ThemeContext.tsx` | Owns all appearance state; applies and persists in one effect |
| `contexts/SettingsContext.tsx` | Incognito and model selection |
| `contexts/SessionsContext.tsx` | Conversation state — list, active chat, transcript, send |
| `hooks/useDraggable.ts` | Modal dragging |
| `hooks/useResizableSidebar.ts` | Settings rail resize/collapse |
| `lib/prefsClient.ts` | Preference API client — 350ms debounce, `keepalive` flush on `pagehide` |
| `lib/sessionsClient.ts` | Chat session API client — typed, 5s timeout, `SessionApiError` |
| `lib/zoneHighlight.ts` | Hover a colour row → outlines the UI that colour drives |
| `components/ThemeModal.tsx` | Theme editor — presets, colours, harmony, effects, import/export |
| `components/SettingsModal.tsx` | Settings shell |
| `components/Sidebar.tsx` | Chat list from `GET /api/sessions` — select, inline rename, delete, filter |
| `components/ChatInterface.tsx` | Composer and transcript, driven by `SessionsContext` |
| `hooks/useElementWidth.ts` | ResizeObserver width, for container-driven layout |
| `lib/systemClient.ts` | Log-browser and provider API client |
| `components/settings/` | `SettingsSearch`, `DatabasesPanel`, `RawLogModal`, `ModelEndpointsPanel` |

### The settings shell resizes on its *container*, not the viewport

The Settings window is draggable and resizable, so its content can be narrow on
a wide screen — a viewport media query measures the wrong thing. `useElementWidth`
observes the shell body, and below **620px** the vertical rail becomes a
horizontal scrolling strip of chips, with drag-resize and collapse withdrawn
because neither means anything in that layout.

That threshold and that behaviour are Odysseus' `isDesktopSidebarMode`, which
gates the same thing at the same width. The stored width and collapsed flag are
left untouched while compact, so widening the window restores exactly what the
user had set.

### Conversation state is server-owned

The transcript is not React state that happens to be saved — it is read from
the API and written back to it. That is what makes it survive a reload, a
second tab, and tomorrow; and it keeps history out of reach of the client,
which matters because history is replayed into the model's context.

A session is **not created until the first message is sent**, so clicking
"New" cannot litter the sidebar with empty rows. Toggling incognito hides the
open chat rather than destroying it — derived during render from the mode the
session was created under, so toggling back brings it into view.

> **Unknown `/api/*` paths 404 rather than falling through to the SPA.**
> Without that, a container image predating an endpoint serves `index.html`
> with a 200 and the client fails parsing HTML as JSON — a confusing symptom
> for a simple cause. The client guards the parse as well.

### Nothing in browser storage

Deliberate. `localStorage` is touched in exactly one place —
`migrateLegacyLocalStorage()` — which reads legacy keys once, pushes them to
the backend, and **deletes** them.

---

## 8. Deployment

One image serves the API and the SPA (multi-stage: pnpm builds the bundle,
FastAPI serves it). `./daedalus.sh start`, or `docker compose up` directly.

Configuration is entirely in `.env` (template: `.env.example`), read by both
compose and `daedalus.sh`.

| Service | Notes |
|---|---|
| `daedalus` | The app. Volumes: `./data`, `./logs`, `./backend/data` |
| `chromadb` | Vector store, persistent volume, telemetry disabled |
| `ollama` | Optional — `--profile with-ollama`; host by default for GPU |

**Two gotchas worth remembering.** The chroma image is minimal (dash only, no
curl/wget/python), so no healthcheck can run inside it — readiness is reported
by the app instead. And Docker creates missing bind-mount directories as
**root**, which breaks the non-root container; `data/` and `logs/` are
therefore tracked with `.gitkeep`.

---

## 9. Verification status

| Area | Covered by |
|---|---|
| Theme engine | 92 assertions — hex round-trips, harmony across 4×2 modes, incognito contrast on all 16 themes, state coercion and clamping |
| Read-only boundary | INSERT/UPDATE/DELETE/DROP all verified to raise |
| `theme.css` injection | Hostile `bg`, `font`, `density` payloads verified dropped |
| Container | Built and run; all five stores healthy; SPA, assets, deep links and path-traversal guard checked |
| Frontend | **No component tests.** Verified by headless-browser screenshots |
| Chat store | Seq allocation, cascade delete, auto-titling, incognito sweep, budget trimming and every error path exercised by direct calls |
| Migrations | Edited-file, gap-numbering, missing-file and bad-SQL rollback all verified to refuse or roll back |
| Session API | Every endpoint exercised, including 404/413/422 paths and a rejected forged `assistant` role |
| Frontend build | `tsc -b` and `vite build` clean; session round-trip verified against a live dev server |
| Scripts | `sync.sh --check`/apply, `reset.sh` refusal while the stack is up, WAL-sidecar deletion, host-path resolution |
| Log browser | Allowlist verified: `sqlite_master`, `prefs` and `model_endpoints` all 404. Paging, ordering and the 1000-row cap exercised |
| Model endpoints | Key absent from every response; duplicate URL 409; bad URL 422; unreachable-host and rejected-key paths produce distinct messages; a new key clears the cached verdict; `purpose='runtime'` refused by the schema |
| Backend | **No automated tests.** Verified by direct API calls |

The absence of an automated test suite on both sides is the biggest gap.
