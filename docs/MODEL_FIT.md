# Model fit — how every model is judged against this machine

Daedalus runs three kinds of model, and the Forge judges every one of them
against the machine it is on before you download it: **safe**, **marginal** or
**will not fit**, with the reasons in words, and a **recommendation** — the
strongest model this machine can afford.

This document is the contract. Anything added later — a model in a catalogue,
or a whole new kind of model — follows it, and the tests listed in §6 fail the
build when it does not.

---

## 1. The three kinds

| Kind | What it does at answer time | Catalogue | Judged by | Time budget | Hard requirement |
|---|---|---|---|---|---|
| **Chat** | Writes the answer | `backend/app/data/model_catalogue.json` | `services/model_fit.py` (its own scorer) | — (scored on speed with quality and context) | Weights + KV cache fit the GPU/CPU memory pools |
| **Embedding** | Embeds the question for Track 1 | `backend/app/data/embedding_catalogue.json` | `services/embedding_models.fit()` | **300 ms** per question | Window ≥ one chunk (~375 tokens) |
| **Re-ranker** | Re-scores Track 1's 20 candidates | `CATALOGUE` in `services/reranker.py` | `services/reranker.fit()` | **1 s** per question | — |

**A model's kind comes from Ollama, not its name.** A chat model is one whose
`/api/show` capabilities include `completion`; an embedding model reports
`embedding` instead. `ollama_client.answers_questions()` is the single rule, and
every layer uses it: the composer's model list (`GET /api/system/models`)
leaves embedders out, `inference.choose_model` refuses an override to one and
answers with the configured model, and `model_config` refuses to pin one. An
embedder is chosen only in Settings → Vector RAG. Guarded by
`tests/test_chat_models_only.py`.

Chat models have a richer scorer because they are the expensive part: weights
× quantization × context against two memory pools (VRAM and RAM), with fit,
speed, quality and context weighted for this project's workload. Embedders and
re-rankers *support* an answer, so they share one simpler rule — §2.

The budgets come from §9.2's 3-second answer: embedding the question is the
first step of every Track 1 answer, re-ranking the second, and the model's
generation needs the rest.

---

## 2. The shared rule — `services/fit_verdict.py`

Every non-chat kind calls `fit_verdict.verdict()` with three things:

1. **Memory** the model needs (its file × a runtime factor), against the RAM
   **free now** — these run beside the chat model, not instead of it.
2. **Time** per question, against the kind's budget.
3. Any **hard failures** — requirements no machine can fix.

| Verdict | When |
|---|---|
| `safe` | Fits in half the free memory, within the time budget, no hard failure |
| `marginal` | Over half the free memory, *or* over budget but within 3× it |
| `will_not_fit` | More memory than is free, *or* over 3× the budget, *or* any hard failure |

Unknown free memory (the machine could not be read) is not a failure; memory is
then simply not judged. Thresholds are constants in `fit_verdict.py`
(`MEMORY_SHARE = 0.5`, `OVER_BUDGET = 3`) — change them there, once, for every
kind.

## 3. The recommendation — `fit_verdict.recommend()`

The highest-`quality` model judged `safe`; ties go to the faster one. If none is
safe, the **fastest `marginal`** model, still labelled marginal — on a slow
machine "the least over budget" is the useful answer. Nothing `will_not_fit` is
ever recommended.

Made twice per kind that has multilingual models: once over every model
(**English** questions) and once over the multilingual ones (**Malay**). A
multilingual model can win both.

`quality` is an **ordering**, never shown as a score: an approximate rank within
the catalogue from the authors' published results (MS MARCO / BEIR for
re-rankers, MTEB retrieval for embedders). It decides between models that both
fit; it is not a measurement and the UI never presents it as one.

There is **no declared `recommended` field** in any catalogue. A recommendation
is computed per machine, every time.

---

## 4. Estimates and measurements

A time is an **estimate** until the model is benchmarked on this machine, and
everything that shows it says which (`latency_source: estimated | measured`;
`~` before an estimated figure in the UI). This is `MODULES.md` §2.2: an
estimate and a measurement must never look alike.

| Kind | Estimate | Benchmark | Stored |
|---|---|---|---|
| Embedding | `15 ms + 0.182 ms × compute_m` | One warm-up, median of 5 `/api/embed` calls on a fixed question | `DATA_DIR/embedding_benchmarks.json` |
| Re-ranker | `805 ms × compute_m / 10.6`, ÷ 1.4 if 8-bit, × 4 / threads | One warm-up, median of 3 re-scorings of 20 chunk-sized (~250-token) passages | The model's `manifest.json` |

Benchmarks are per machine, so they live under `DATA_DIR`, never in the
git-tracked `config/` — a result from the dev laptop is not a fact about the lab
machine.

### Calibration — where the constants come from

Both estimators are lines through real measurements on the development laptop
(i5-11400H, 4 threads, 8 GB RAM, RTX 3050 4 GB), recorded in the code beside the
constants:

- **Embedding:** nomic-embed-text (110 M compute) **35 ms**; qwen3-embedding:0.6b
  (440 M) **95 ms** — so ~15 ms of round trip plus ~0.18 ms per million compute
  parameters. Ollama chose the device; a model too big for the GPU runs on the
  CPU, slower than the line says.
- **Re-ranker:** MiniLM-L6 **805 ms**; MiniLM-L12 (8-bit) 1127; mMiniLMv2-L12
  (8-bit) 1150; mxbai-xsmall (8-bit) 1238; TinyBERT 37 — for 20 × ~250-token
  passages. The first attempt used single paragraphs and ran 2–3× faster than
  real chunks; passage length matters for a cross-encoder.

**Recalibrate** on the lab machine before the evaluation: benchmark two models
of different sizes, put the numbers in the constants and in the comment beside
them, and update this section.

`compute_m` is the parameters a forward pass multiplies through — total minus
the token-embedding table, which is a lookup. For a multilingual model the
table is most of the file, which is why bge-m3 (568 M) costs what a 300 M model
does.

---

## 5. Checklists

### Adding a model to a catalogue

1. **Embedding** — add an entry to `embedding_catalogue.json` with every field
   listed in its `_about` block: `tag`, `label`, `dimensions`, `max_tokens`,
   `approx_bytes`, `params_m`, `compute_m`, `languages` (`English…` or
   `Multilingual…`), `quality`, `query_prefix`, `document_prefix`, `note`. Take
   the prefixes from the model's own card (`""` when it expects none) — an
   asymmetric embedder given an unprefixed question retrieves below its
   published quality. Read `dimensions`, `max_tokens` and
   `approx_bytes` from the tag's manifest on `registry.ollama.ai`, not a model
   card.
2. **Re-ranker** — add an entry to `reranker.CATALOGUE` with `repo`, a **pinned
   40-character `revision`** that exists, an `onnx` path that exists at that
   revision, `size_bytes` from the Hugging Face API, `compute_m`, `quantized`,
   `quality`, `multilingual`, `languages`, `licence` (one a thesis can use),
   `note`. Download it and check that it ranks a relevant passage above an
   irrelevant one before committing.
3. **Chat** — `model_catalogue.json`, per `model_fit.py`.
4. Set `quality` relative to the entries already there, from published results.
5. Run the backend tests. The catalogue contract tests (§6) fail on a missing or
   mistyped field.
6. If the new model is likely to be recommended, benchmark it and check the
   estimate was in the right range; if it was far off, recalibrate (§4).

### Adding a new kind of model

1. Give it a catalogue with the fields its verdict needs (size, compute,
   quality, languages if any) and a contract test that checks every entry.
2. Implement `fit()` by calling `fit_verdict.verdict()` and
   `fit_verdict.recommend()` — do not write a second rule. Pick its time budget
   from §9.2 and state where the number comes from; add any hard requirement.
3. Add `benchmark()`, storing per machine under `DATA_DIR`.
4. **Forge:** a browse tab showing every model with its verdict, reasons, time
   (estimated or measured) and recommendation badges, with Download; and a pane
   under *Installed* for what is on disk, with Benchmark and Delete.
5. **Settings:** where the model is *chosen*, a compact picker that shows the
   chosen model's verdict on one line and names the recommendation when it is
   different — never the full catalogue again (`docs/FEATURES.md` §6).
6. Add a row to §1 and §4 of this document.

---

## 6. What enforces this

| Test | Guards |
|---|---|
| `tests/test_embedding_fit.py` · `CatalogueContractTest` | Every embedding and re-ranker entry carries every field its verdict needs; no catalogue declares `recommended` |
| `tests/test_embedding_fit.py` · `SharedRuleTest` | The verdict levels, hard failures, and the recommendation fallback |
| `tests/test_embedding_fit.py` · `EmbeddingFitTest` | The chunk-window rule, English/Malay recommendations, benchmark-over-estimate, models pulled from outside the catalogue |
| `tests/test_rerank.py` · `RerankerFitTest` | Re-ranker estimates, verdicts and recommendations |

## 7. Known limits

- **GPU memory is not judged for embedders and re-rankers** — only free RAM.
  Ollama may place an embedder on the GPU; the verdict is conservative for that
  case, not wrong.
- **Free RAM is read now**, so a verdict reflects whether the chat model is
  loaded at that moment. Judge with the chat model you will use loaded.
- **Prefixes are applied, not yet measured here.** Each embedder gets the query
  and document prefix its card specifies (`embedding_models.prefixes`), and the
  document prefix is stamped on the index so a change marks it stale. A
  three-passage spot check with qwen3-embedding:0.6b showed the prefix pushing
  an off-topic passage further away but no gain on a same-topic distractor —
  too small to conclude anything. Measure it on the evaluation set.
