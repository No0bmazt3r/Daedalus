"""Ariadne's Thread — one chat turn, reassembled from the audit log (MODULES.md §1).

Three reads, all from `ai_logs.db` plus the evidence pack the transcript keeps
beside each answer:

- `recent()` — the turns, newest first, each with one status word.
- `trace()` — one turn as an ordered chain: question → understanding → tools
  and retrieval → evidence → context → model → validation → answer.
- `groundedness()` — every number in the answer, marked against the evidence.

## The verdict mirrors the validator, it does not re-decide

The validator (`orchestration/validator.py`) ran at answer time against the
whole of what the model was shown — labelled lines *and* the unlabelled series
samples and headers around them. The transcript keeps only the labelled lines.
Re-deciding here against that smaller set would mark a number red that the
validator rightly passed, and the Thread would contradict the record it is
meant to explain. So the stored verdict is the authority: a number it listed as
unsupported is red, as stale is amber, and every other quantity it checked is
green. What this module adds is *where* each green number came from — the
labelled line, or "an unlabelled part of the evidence" when no line carries it.

The same rules decide what is not a claim (a small bare count, a number from
the question), because the same `numbers` functions and thresholds are used.

## What it cannot show

- The assembled prompt. It is not stored; the evidence lines and the context
  record (`memory_logs`) are what was in it, minus the fixed instructions.
- Evidence for a turn whose chat was deleted or purged (incognito). The audit
  rows outlive the transcript by design, so the trace still reads, but the
  per-number sources and the evidence step are missing, and the response says
  so (`evidence_available: false`).

## Modules

| Module | Job |
|---|---|
| `listing.py` | The list: each turn's status and bucket, the summary figures, filters, labels |
| `trace.py` | One turn as ordered steps, each pointing at its audit table |
| `groundedness.py` | Every number in the answer, marked against the evidence |
| `retrieval.py` | What was retrieved: chunks and their chunking (Track 1), or the walk (Track 2) |
| `common.py` | The two helpers all of them use |
"""

from .groundedness import groundedness
from .listing import chat_of, recent, set_label, status, summary
from .retrieval import retrieval
from .trace import trace

__all__ = ["chat_of", "groundedness", "recent", "retrieval", "set_label", "status", "summary", "trace"]
