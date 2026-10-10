# Evaluation — running the dual-track comparison

[`PROJECT.md`](PROJECT.md) §5 says *what* is compared and §9 *against which
targets*; this is how to run it. The machinery is `backend/app/services/evaluation.py`,
driven from a terminal by `backend/app/cli_eval.py`. Guarded by
`backend/tests/evaluation/test_evaluation.py`.

> **Status (2026-10-10):** the harness is built and tested; no run has been
> made. `queries.yaml` holds 5 `EX…` examples against the placeholder graph —
> a run against them measures the harness, not Daedalus.

---

## 1. What a run is

One run asks every question in the query set once per **arm**, through the same
chat path an operator uses, and scores each answer against hand-written labels.

| Arm | What answers | Compared with |
|---|---|---|
| `vector` | Track 1 — vector RAG with the configured re-ranker | either graph arm: does graph structure beat vector similarity? |
| `graph-walk` | Track 2, the fixed walk | `graph-agent`: do the agent's hop choices beat a fixed path? |
| `graph-agent` | Track 2, the agent loop | |

Only one arm answers any question. The comparison is always *between* arms.

**The same pipeline, not a copy of it.** Each question goes through
`inference.answer_stream` in its own empty, ephemeral session, inside
`rag_config.arm(...)`. Planning, retrieval, prompting and validation are the
shipped code, so what is measured is what ships. The arm is a context-scoped
override (a `ContextVar`), not a config write: the frozen config refuses writes,
and someone using the app during a run still gets the configured track.
Everything else, including budget, step limit, re-ranker and embedding model, is
read from the frozen config, so the arms differ only in the track and mode.

An evaluation turn logs `model_logs.source = 'eval'`, so operator statistics that
filter on `'chat'` leave it out. It also skips the background title and summary
jobs, so no extra model call competes with the next timed question.

---

## 2. The query set — `config/eval/queries.yaml`

The query set is tracked in git on purpose: these labels are the ground truth,
so every change shows up in a diff. Write them **before** looking at either
track's answers.

```yaml
- id: Q07
  category: multi_hop_causal        # one of the five below
  question: Why would the CO2 reading drift upward during absorption?
  language: en                      # en | ms
  rig_specific: false               # true → label from `rig` documents only
  expect:
    answerable: true                # false for out_of_corpus: the right answer is a refusal
    key_facts: ["NDIR", "drift|calibrat"]   # regex each, case-insensitive; ALL must match
    relevant_documents: ["NDIR_Analyser_Manual.pdf"]   # Track 1 relevance, by filename
    relevant_nodes: ["AnomalyType:ndir_drift"]         # Track 2 relevance, by node id
  notes: where the label came from
```

| Category | §5 hypothesis |
|---|---|
| `single_hop_factual` | Tie |
| `single_hop_procedural` | Tie |
| `multi_hop_causal` | GraphRAG wins — the key differentiator |
| `ambiguous` | Unknown — which degrades more gracefully? |
| `out_of_corpus` | Must refuse — tests groundedness discipline |

Aim for 30–50 questions, with 6–10 in each category. Rig-specific questions need
their labels taken from `rig` documents (§5, *Knowledge provenance*): a
reference document stating another plant's setpoint is not a correct answer
here.

```
cd backend
python -m app.cli_eval validate
```

`validate` lists every problem at once: a duplicate id, an unknown category, a
key fact that is not a valid regex, or an `out_of_corpus` question marked
answerable. After the problems it gives coverage warnings: categories under
6, a total outside 30–50, and labels that point at nothing (a node missing from
the graph, a filename missing from the corpus). A warning does not block a run,
but a label that points at nothing scores as a miss every time.

The shipped entries are `EX…` examples written against the placeholder graph.
Replace them once the lab's documents are ingested.

---

## 3. Freeze, then run once

§5's sequencing rule: build both tracks, **freeze both**, then run the
evaluation once without further tuning.

```
python -m app.cli_eval run --practice        # any time; the report says "not citable"
python -m app.cli_eval run                   # official
python -m app.cli_eval run --arms vector --ids Q01,Q02 --practice
python -m app.cli_eval list
python -m app.cli_eval report eval_20261001_120000
```

- **Official runs refuse to start unless frozen.** To freeze, set `"frozen": true`
  in `config/rag_config.json` by hand. `--practice` runs anyway and marks the
  report **practice — not citable**.
- **A repeat is refused.** If an official run already exists with the same
  configuration fingerprint and query-set hash, a new one needs
  `--rerun-reason "…"`, and the reason is printed at the top of the report.
- **A run with `--ids` is partial** and is never citable.
- The fingerprint covers the frozen RAG config, the embedding model and index
  state, the chat model and the graph file's hash. The snapshot also records
  the git commit (read from `.git`, without running git), the corpus stats and
  the machine.

Runs go **arm by arm**, not question by question, so one arm's loaded embedder
or warm cache does not affect another arm's timings halfway through.

---

## 4. When a question or a run goes wrong

| What happens | What the harness does |
|---|---|
| A turn takes longer than `QUESTION_TIMEOUT_S` (180 s) | Records it as an error (wrong, not credited even if an answer arrives later). The deadline still applies when the model sends nothing at all, because the stream is read on its own thread. |
| …and the turn is still running | `answer_stream` cannot be cancelled, so the harness **waits** up to `DRAIN_TIMEOUT_S` (120 s) more for it to finish before asking the next question. Otherwise the next question would be timed while this one still holds the model. |
| …and it is still running after that | The run **stops** with status `aborted`. Timing more questions next to a stuck model would make every later latency figure wrong. |
| An exception, Ollama going away, Ctrl-C | The run is saved with status `aborted` and the reason. Every answer scored so far is kept, and the report starts with **Incomplete — not citable**. |
| The process is killed outright | `run.json` is rewritten atomically after **every** answer, so the folder holds everything up to the last one, with status `running`. `report <run_id>` still builds a report from it. |

An aborted official run does not count toward the "run once" rule, because only
a `complete` run blocks a repeat.

---

## 5. What is scored

Per question per arm, then aggregated per arm, overall and by category.

| Metric | Definition |
|---|---|
| **Correct** | Answerable: the answer does not decline, and **every** `key_facts` pattern matches. Out of corpus: the answer declines. |
| Declined | The validator's fallback text, an `out_of_scope` intent, or wording that says the information is not there (English or Malay). |
| Fact recall | The share of key facts matched, for answerable questions only. |
| Refusal correct / false refusal | Declined exactly when it should have, and declined an answerable question, respectively. |
| Hallucination, grounded | The validator's own flags from `conversation_logs`, i.e. what the shipped system *caught*. |
| Precision@3, @5, recall@5, MRR | Track 1 only. A retrieved chunk is relevant when its source file is in `relevant_documents`. Precision@k divides by the number actually retrieved when that is under k. |
| Node precision / recall | Track 2 only. The reached nodes against `relevant_nodes`, compared as a set: a walk has no ranking, so there is no @k or MRR. Hops, agent stop reasons and rejected replies are listed with them. |
| Rig share | The share of retrieved items that came from `rig` documents (`rag_logs.retrieved_origins`). |
| Latency | Whole turn, time to first token, and retrieval alone. Mean, p50 and p95, using nearest-rank percentiles. |

**Correctness here is lexical.** That makes it cheap, repeatable and visible in a
diff, but it is strict: a correct answer phrased differently from the pattern
counts as a miss. Write patterns with alternatives (`drift|calibrat`), and use
the failure list to find patterns that were too narrow. §9.3's other two
methods cover what lexical scoring cannot.

---

## 6. What a run writes — `data/eval/<run_id>/`

| File | For |
|---|---|
| `run.json` | Everything: snapshot, query set, every scored answer, summary. The source the other files are generated from. |
| `report.md` | The comparison table, correctness by category, agent stop reasons, and every wrong answer with what was missing. The qualitative failure analysis starts from this. |
| `results.csv` | One row per question per arm, with empty `human_score` / `human_notes` columns for the human panel. |
| `judge.jsonl` | Input for Method B (§9.3): question, labels and answer per arm, for an **offline** LLM judge over exported results. Nothing in the harness calls a model to judge. |

Every row carries its `query_id`, so any answer can be opened in Replay or traced
across the audit tables.

---

## 7. Ablations — one variable, two runs, one table

Supplementary to the official comparison, never instead of it: ablation runs are
**practice** runs, so none of them is citable as the headline result.

Every run's snapshot records the chunk recipe the corpus was actually cut with
(`strategy chunk_size/overlap`, from the ingest runs that wrote the chunks),
along with Track 1's `retrieval` settings (`top_k`, `similarity_threshold`) in
`rag_config`. `compare` puts runs side by side, per arm, and says when they differ
in anything besides the variable under test.

**Chunk size**

1. `python -m app.cli_eval run --practice --arms vector` at the current size (A).
2. Blueprints → Track 1 → Build: set the second chunk size, re-chunk and re-embed
   every document.
3. Run step 1 again (B).
4. `python -m app.cli_eval compare <A> <B>`. Paste the table into the report.
5. Put the chunk size back, re-chunk, and confirm `report` shows the original
   recipe before any official run.

**`top_k` / similarity cut-off:** the same, changing Settings → Vector RAG →
Retrieval depth between the runs instead of re-chunking. Both are frozen with the
track, so unfreeze first and freeze again afterwards.

---

## 8. Not built

- A dashboard surface. Running from the terminal is deliberate: an official run
  is long and is started once, on purpose.
- Per-stage latency beyond first token and retrieval (planning, validation).
- Two chunkings live at once. An ablation re-chunks between runs rather than
  keeping a second index, because the manifest holds one chunking per document.
