# Ariadne's Thread — proving an answer was grounded

Reassembles one chat turn from the audit log: the ordered steps, what was
retrieved, every number in the answer marked green/red/amber against the
evidence, and a person's label (the evaluation's ground truth). Read-only except
for labels. `__init__.py` is the public API (`recent`, `trace`,
`groundedness`, `retrieval`, `set_label`, …) and documents the design.

Screen: `frontend/src/components/thread/` · Client: `lib/threadClient.ts`

## Files

| File | Job |
|---|---|
| `listing.py` | The list: each turn's status and bucket, summary figures, filters, labels |
| `trace.py` | One turn as ordered steps, each pointing at its audit table |
| `groundedness.py` | Every number in the answer, marked against the evidence |
| `retrieval.py` | What was retrieved: chunks (Track 1) or the walk (Track 2) |
| `common.py` | Shared helpers |
| `thread_settings.py` | Settings → Ariadne's Thread |

## Routes — `api/`

| File | Prefix |
|---|---|
| `thread.py` | `/api/trace` — list, one trace, groundedness, retrieval, label, settings |

## Touches

- **Stores:** audit (read; labels appended), chat (evidence packs), corpus (chunk text)
- **Depends on:** chat (`orchestration.numbers`, `orchestration.evidence`), blueprints (`knowledge_graph`)

Tests: `backend/tests/thread/` · Design: `docs/MODULES.md` §1
