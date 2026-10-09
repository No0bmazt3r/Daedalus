# Daedalus Documentation

Everything about this project lives in this folder. Start with
**[`PROJECT.md`](PROJECT.md)** — it is the canonical specification and it wins
over anything else here.

---

## Start here

| I want to… | Read |
|---|---|
| Understand the whole project | [`PROJECT.md`](PROJECT.md) |
| Know what's actually built right now | [`FEATURES.md`](FEATURES.md) |
| See what's next | [`../TODO.md`](../TODO.md) |
| Report progress (advisor, examiner) | [`STATUS.md`](STATUS.md) — plain-language status, with the screenshot checklist |
| Write the FYP2 report | [`REPORT_NOTES.md`](REPORT_NOTES.md) — chapter-by-chapter sources, the FYP1 framing, prior art, rejected alternatives, figures |
| Find which files make up each feature (for explaining the code) | [`CODE_MAP.md`](CODE_MAP.md) — layers, the databases, and every feature from screen to store |
| Understand the three sidebar modules | [`MODULES.md`](MODULES.md) — Ariadne's Thread, The Forge, Labyrinth Blueprints, all built |
| Know how a model is judged against this machine, or add one | [`MODEL_FIT.md`](MODEL_FIT.md) — the fit contract for chat, embedding and re-ranker models |
| Run the dual-track evaluation | [`EVALUATION.md`](EVALUATION.md) — query set, freeze-then-run, metrics, what a run writes |
| Defend the latency measurements | [`BENCHMARK.md`](BENCHMARK.md) — methodology, and what it does *not* claim |
| Run it | [`../README.md`](../README.md) |
| Know what every script does | [`SCRIPTS.md`](SCRIPTS.md) |
| See every error page, or tweak a picture or its animation | [`ERROR_PAGES.md`](ERROR_PAGES.md) |
| Know what this project borrowed, and from whom | [`../ACKNOWLEDGMENTS.md`](../ACKNOWLEDGMENTS.md) |

## Precedence — read this before trusting any file

When two documents disagree, resolve in this order:

1. **[`PROJECT.md`](PROJECT.md)** — canonical: what Daedalus is, the five
   rules, the architecture and the comparison protocol. §2 records how the two
   FYP1 spec sets disagreed and how each conflict was resolved.
2. **[`FEATURES.md`](FEATURES.md)** — canonical for *implementation detail*:
   the API surface, data-store contracts, theme engine, deployment. Describes
   what exists; `PROJECT.md` describes what is intended.
3. **[`MODULES.md`](MODULES.md)** — design for Ariadne's Thread, The Forge and
   Labyrinth Blueprints. Subordinate to `PROJECT.md`: it elaborates §10.2 and
   never overrides it. All three are built; where a build departed from the
   design, the module's section says so.
4. **[`BENCHMARK.md`](BENCHMARK.md)**, **[`MODEL_FIT.md`](MODEL_FIT.md)**,
   **[`EVALUATION.md`](EVALUATION.md)** — canonical for *how* latency, model
   fit and the comparison are measured, and what may be concluded from each.

**The FYP1 spec sets are retired.** `research/` (8 files) and `architecture/`
(15 files) were removed on 2026-10-10. Everything still true in them is in
`PROJECT.md`; the report-relevant framing only they carried is in
`REPORT_NOTES.md`; the originals are in git history.

---

## Feeding this to an AI

Context windows are finite; don't paste the whole folder.

| Task | Give it |
|---|---|
| Anything at all | `PROJECT.md` (start here, always) |
| Changing existing code | `PROJECT.md` + `FEATURES.md` + `CODE_MAP.md` |
| Database work | `PROJECT.md` §6 + `FEATURES.md` §3 |
| The tool layer | `PROJECT.md` §3 and §7 + `FEATURES.md` *Agent tools* |
| RAG / retrieval | `PROJECT.md` §5 + `MODULES.md` §3 |
| Model selection | `PROJECT.md` §8 + `MODEL_FIT.md` + `BENCHMARK.md` |
| Evaluation | `PROJECT.md` §5 and §9 + `EVALUATION.md` |
| Report or viva prep | `REPORT_NOTES.md` + `PROJECT.md` §14 + `STATUS.md` |

Two rules worth passing along with the files:

1. `PROJECT.md` wins over everything else.
2. Its five rules (§3) constrain every layer — no exceptions.
