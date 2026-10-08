# Over-engineering audit

Run: 2026-10-02 · **All 19 cuts done 2026-10-07** (each Check re-run first; `F3` became `hooks/useElementSize.ts`; `B1` also removed the old-container guard in `scripts/common.sh` and the `.env.example` entry) · Tool: `/ponytail:ponytail-audit` (whole repo) · Branch: `develop` @ `6ab2cbd`
Status legend (same as [`TODO.md`](../TODO.md)): `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` decided to keep

Scope: dead code, unused dependencies, duplication, config nobody sets. Bugs,
security and performance are out of scope.

**Projected saving:** about −457 lines and −2 dependencies.

> **How this was found:** names were matched with grep across `backend/app`,
> `backend/tests` and `frontend/src`. Code reached only by a dynamic lookup
> (string dispatch, a registry, a decorator) could be flagged by mistake. Before
> deleting an item, run its **Check** command (it should print nothing outside
> the defining file). After deleting, run `tsc` / `pnpm build` and `pytest`.

---

## Frontend

| # | Status | Tag | What to cut | Where | ~Lines | Check |
|---|---|---|---|---|---|---|
| F1 | [x] | delete | Unused UI components: `accordion`, `card`, `input`, `separator` | `frontend/src/components/ui/` | 244 | `grep -rnE "ui/(accordion\|card\|input\|separator)['\"]" frontend/src` |
| F2 | [x] | delete | `useCollapse` hook — repeats `Collapse`'s logic, no callers | `frontend/src/components/ui/collapse.tsx:187` | 65 | `grep -rn "useCollapse" frontend/src` |
| F3 | [x] | shrink | `useElementHeight` + `useElementWidth` are one hook twice → single `useElementSize(ref)` returning `{width, height}` | `frontend/src/hooks/useElement*.ts` | 35 | `grep -rn "useElement" frontend/src` |
| F4 | [x] | delete | `@tanstack/react-query` dependency — only `QueryClientProvider` mounted, no `useQuery` anywhere | `frontend/src/main.tsx:4`, `package.json` | 5 + 1 dep | `grep -rn "react-query" frontend/src` |
| F5 | [x] | delete | `@tanstack/router-devtools` dev dependency — never imported | `frontend/package.json` | 1 dep | `grep -rn "router-devtools" frontend/src` |
| F6 | [x] | delete | `SkeletonText` | `frontend/src/components/ui/skeleton.tsx:23` | 12 | `grep -rn "SkeletonText" frontend/src` |
| F7 | [x] | delete | `THEME_DEFAULT_REACTIVE` | `frontend/src/lib/themes.ts:390` | 10 | `grep -rn "THEME_DEFAULT_REACTIVE" frontend/src` |
| F8 | [x] | delete | `updateEndpoint` | `frontend/src/lib/systemClient.ts:252` | 9 | `grep -rn "updateEndpoint" frontend/src` |
| F9 | [x] | delete | `archiveSession`, `getSession` | `frontend/src/lib/sessionsClient.ts:133,172` | 9 | `grep -rnE "archiveSession\|getSession\b" frontend/src` |
| F10 | [x] | delete | `updateGraphNode` | `frontend/src/lib/blueprintsClient.ts:679` | 5 | `grep -rn "updateGraphNode" frontend/src` |
| F11 | [x] | delete | `fetchToolSchemas` | `frontend/src/lib/toolsClient.ts:209` | 2 | `grep -rn "fetchToolSchemas" frontend/src` |
| F12 | [x] | delete | `lib/utils.ts` — re-exports `cn`, but every file imports from `"cn"` directly | `frontend/src/lib/utils.ts` | 1 | `grep -rn "lib/utils" frontend/src` |

## Backend

| # | Status | Tag | What to cut | Where | ~Lines | Check |
|---|---|---|---|---|---|---|
| B1 | [x] | yagni | Chroma server mode (`CHROMA_URL` → `HttpClient`). The compose service is gone, `.env.example` leaves it blank, and `common.sh` already ignores the old value → keep embedded mode only | `backend/app/db/vector_store.py:88`, `backend/app/db/paths.py`, `scripts/common.sh:154`, `.env.example:63` | 20 | `grep -rn "CHROMA_URL" backend scripts .env.example` |
| B2 | [x] | delete | `get_recent_messages` | `backend/app/db/chat_store.py:507` | 14 | `grep -rn "get_recent_messages" backend` |
| B3 | [x] | delete | `get_provider`, `UnknownProviderError` | `backend/app/db/search_store.py:46,105` | 9 | `grep -rnE "get_provider\|UnknownProviderError" backend` |
| B4 | [x] | delete | `NoModelAvailable` — its own docstring says nothing raises it | `backend/app/services/inference.py:86` | 7 | `grep -rn "NoModelAvailable" backend` |
| B5 | [x] | delete | `forget_resolved_base` | `backend/app/services/ollama_client.py:143` | 5 | `grep -rn "forget_resolved_base" backend` |
| B6 | [x] | delete | `_installed_tags` | `backend/app/services/inference.py:110` | 3 | `grep -rn "_installed_tags" backend` |
| B7 | [x] | delete | `status_all` | `backend/app/db/migrations.py:325` | 2 | `grep -rn "status_all" backend` |

## Judgment call — not counted above

| # | Status | What | Where | ~Lines | Note |
|---|---|---|---|---|---|
| J1 | [-] | Theming and background-effects subsystem | `lib/themes.ts`, `lib/canvasEffects.ts`, `components/ThemeModal.tsx`, `contexts/ThemeContext.tsx`, `lib/pointerField.ts` | ~3,700 | **Kept (2026-10-07):** the themes, effects and the themed error pages are part of the product as designed, not scaffolding. |

## Considered and kept

Kept on purpose; don't re-flag these in a later audit.

- `app/cli_eval.py` has no importers, but it is the evaluation CLI entry point (`python -m app.cli_eval`).
- `nvidia-ml-py` alongside the `nvidia-smi` fallback: a measured 13 ms vs 613 ms under WSL (see `backend/requirements.txt`).
- `httpx` and `pyyaml` listed explicitly although they arrive through chromadb: imported directly, so a transitive dependency is not a contract.

---

## Re-audit checklist

1. For each `[ ]` row, run its **Check**. No hits outside the defining file means it is still dead; hits mean something now uses it, so mark it `[-]` with a note.
2. For each row marked `[x]`, run the **Check**. It should print nothing at all.
3. Run `cd frontend && pnpm build` and `cd backend && pytest`.
4. Run `/ponytail:ponytail-audit` again for anything new, and add new rows here (next ids F13, B8, J2).
5. Update the matching line in [`TODO.md`](../TODO.md) (Known issues → over-engineering audit).
