# Acknowledgments

Daedalus is built on open-source work. This file credits the projects whose
designs, interfaces or code influenced it, and records the licence position
for each.

If you believe something here is mis-attributed or missing, open an issue —
it will be corrected.

---

## Odysseus

**[odysseus-dev/odysseus](https://github.com/odysseus-dev/odysseus)** — a
self-hosted AI workspace for chat, agents, research, documents and local model
workflows. Created by **Felix Kjellberg (PewDiePie)**, who is the project's
principal author (`pewdiepie-archdaemon`), with a substantial community of
contributors. **Licensed AGPL-3.0.**

Odysseus was used as a **reference implementation** while building Daedalus's
presentation layer. These subsystems were modelled on it:

| Daedalus | What was taken from Odysseus |
|---|---|
| Theme engine (`frontend/src/lib/themes.ts`) | The *idea* and UX of live, per-zone colour customisation with derived ramps and import/export; a handful of CSS custom-property names (`--bg`, `--border`, `--sidebar`) |
| Settings shell (`components/SettingsModal.tsx`, `lib/settingsRegistry.ts`) | The interaction design — a panel registry, keyword search with keyboard navigation, and a drag-resizable collapsible rail |
| Preference API (`backend/app/api/prefs.py`, `lib/prefsClient.ts`) | The route contract: `GET`/`PUT /api/prefs/<key>` with a `{"value": …}` envelope |
| Settings responsiveness (`hooks/useResizableSidebar.ts`) | `isDesktopSidebarMode` — the 620px container threshold below which the rail goes horizontal and resize/collapse are withdrawn |
| Cloud endpoints (`services/model_endpoints.py`) | The shape of the feature — provider catalogue, base URL + key, a Test action against `/models`. Odysseus' own implementation (`src/llm_core.py`, `core/database.py:ModelEndpoint`) is far broader; Daedalus stores benchmark credentials only |
| Keyboard shortcuts (`lib/keybinds.ts`, `hooks/useGlobalShortcuts.ts`, `components/settings/ShortcutsPanel.tsx`) | The interaction: a rebindable action map, keycap display, click-then-press with the combo previewed before it commits, conflicts surfaced rather than refused, and the reasoning behind the AltGr carve-out — `getModifierState('AltGraph')` distinguishes AltGr from a genuine Ctrl+Alt, and is ignored on macOS where Option sets it legitimately. Daedalus' action list, handlers, storage and types are its own |
| Appearance (`lib/uiChrome.ts`, `components/settings/AppearancePanel.tsx`) | The idea of a column of switches over the app's own chrome, grouped by region with a per-section reset. The set of switchable things is Daedalus' own, and is narrower on purpose: nothing switchable can hide an answer, a citation or a refusal |

### This is not a fork, and the distinction is deliberate

**No Odysseus source code is present in, or was copied into, this repository.**

The AltGr guard is the closest the two come: the same three-condition test, for
the same documented reason, because there is one correct way to distinguish that
keystroke and the reason it matters — a `ctrl+alt+<letter>` binding that deletes
a conversation — applies identically here. It is four lines of boolean logic
against a Web API, expressed differently, in a different language.

Odysseus is a Python/Flask application with a vanilla-JavaScript frontend and
contains no TypeScript at all. Daedalus's frontend is React 19 + TypeScript +
Tailwind v4. The theme engine and settings shell here were written from
scratch in a different language and framework, informed by observing how
Odysseus behaves. What is shared is interface-level — a few variable names and
an HTTP route shape — which is not copyrightable expression and does not make
this a derivative work.

That distinction carries legal weight and is why it is stated precisely.
Odysseus is **AGPL-3.0**, a strong copyleft licence: a genuine fork or an
adaptation of its code would oblige Daedalus to be AGPL-3.0 as well, and
AGPL §13 would additionally require offering the Corresponding Source to
anyone interacting with it over a network. Daedalus is **MIT** (see
[`LICENSE`](LICENSE)), which is only tenable because no AGPL code was
incorporated.

**If Odysseus code is ever copied into this project, that changes.** The
correct response then is to relicense Daedalus under AGPL-3.0 and comply with
§13 — not to keep the MIT notice in place.

A vendored copy of the Odysseus repository was kept in `odysseus/` during the
port as a reference sample, and removed once the work was done (commit
`6c8d480`). It is git-ignored and never shipped.

---

## Everything else

The stack itself, each under its own permissive licence:

| Project | Used for | Licence |
|---|---|---|
| [FastAPI](https://fastapi.tiangolo.com/) | Backend orchestration (Layer 7) | MIT |
| [SQLite](https://sqlite.org/) | Four of the five stores | Public domain |
| [ChromaDB](https://www.trychroma.com/) | Vector store (Layer 5) | Apache-2.0 |
| [Ollama](https://ollama.com/) | Local model runtime (Layer 6) | MIT |
| [PydanticAI](https://ai.pydantic.dev/) | Typed tool contracts (Layer 8) | MIT |
| [React](https://react.dev/) · [Vite](https://vite.dev/) · [TanStack Router](https://tanstack.com/router) | Dashboard (Layer 9B) | MIT |
| [Tailwind CSS](https://tailwindcss.com/) · [shadcn/ui](https://ui.shadcn.com/) · [Base UI](https://base-ui.com/) | Styling and primitives | MIT |
| [Lucide](https://lucide.dev/) | Icons | ISC |
| [Monocraft](https://github.com/IdreesInc/Monocraft) | The Minecraft typeface — the UI's default face, bundled at `frontend/src/assets/fonts/` | SIL OFL 1.1 |
| [Geist](https://vercel.com/font) · [OpenDyslexic](https://opendyslexic.org/) | Alternative faces in the Font selector | SIL OFL 1.1 |

The CO₂ sorption reactor, its SCADA layer and the ingestion and anomaly
subsystems are the work of the wider project team; Daedalus reads from them
and never writes to them. See [`docs/PROJECT.md`](docs/PROJECT.md) §4.
