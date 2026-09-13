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
| Data stores (×4) | Built and containerised; nothing reads them in anger yet |
| Preference API | Built |
| Chat | **Mock only** — no backend call |
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
| `GET` | `/api/system/databases` | Health, size and metrics for all four stores |
| `POST` | `/api/system/seed-demo` | Generate demo telemetry. **Dev only, unauthenticated** |

Writable preference keys (anything else is rejected with 404):

| Key | Shape |
|---|---|
| `theme` | Full `ThemeState` object |
| `custom-themes` | `{ [slug]: CustomThemeEntry }`, max 8 |
| `ui-scale` | `"100"` or `"125"` |
| `settings-ui` | `{ width: number, collapsed: boolean }` |

Interactive docs while running: <http://localhost:8000/docs>

### Why `theme.css` exists

Preferences live on the server, so they cannot be read synchronously the way
`localStorage` could — the app would flash the default palette on every load.
This endpoint emits the saved palette as a render-blocking stylesheet that
`index.html` links in `<head>`, so the first painted frame is already themed.

It interpolates stored values into CSS, so it **only** emits exact `#rrggbb`
matches and known enum values. Verified: a payload with
`"bg": "red; } body { display:none } :root{ "` and
`"font": "</style><script>…"` has all hostile fields dropped.

---

## 3. Data stores

Four physically separate databases. The separation is the safety argument, not
tidiness — see `PROJECT.md` §6.3.

| Store | Module | Engine | Access |
|---|---|---|---|
| Sensor | `db/sensor_store.py` | SQLite | **read-only** (`file:…?mode=ro`) |
| Audit | `db/audit_store.py` | SQLite | read/write |
| Vector | `db/vector_store.py` | ChromaDB | read/write |
| Prefs | `db/prefs_store.py` | SQLite | read/write |

Paths resolve centrally in `db/paths.py`, overridable by environment:
`DAEDALUS_DATA_DIR`, `DAEDALUS_LOG_DIR`, `DAEDALUS_PREFS_DB`, `CHROMA_URL`.

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

**Built panels:** AI Defaults · Databases · Shortcuts. Everything else is a
placeholder.

---

## 7. Frontend structure

Paths are relative to `frontend/src/`.

| Path | Role |
|---|---|
| `contexts/ThemeContext.tsx` | Owns all appearance state; applies and persists in one effect |
| `contexts/SettingsContext.tsx` | Incognito and model selection |
| `hooks/useDraggable.ts` | Modal dragging |
| `hooks/useResizableSidebar.ts` | Settings rail resize/collapse |
| `lib/prefsClient.ts` | Preference API client — 350ms debounce, `keepalive` flush on `pagehide` |
| `lib/zoneHighlight.ts` | Hover a colour row → outlines the UI that colour drives |
| `components/ThemeModal.tsx` | Theme editor — presets, colours, harmony, effects, import/export |
| `components/SettingsModal.tsx` | Settings shell |
| `components/settings/` | `SettingsSearch`, `DatabasesPanel` |

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
| Container | Built and run; all four stores healthy; SPA, assets, deep links and path-traversal guard checked |
| Frontend | **No component tests.** Verified by headless-browser screenshots |
| Backend | **No tests.** Verified by direct API calls |

The absence of an automated test suite on both sides is the biggest gap.
