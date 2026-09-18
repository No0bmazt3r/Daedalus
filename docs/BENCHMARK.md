# The latency benchmark — what it measures, and why that is the right thing

`services/benchmark.py`, surfaced at `POST /api/forge/benchmark` and in The
Forge. This document exists to be **defended in a viva**: every choice below has
a reason, and the ones that are still weak are named in §9 rather than hidden.

Subordinate to [`PROJECT.md`](PROJECT.md). Elaborates
[`MODULES.md`](MODULES.md) §2.3.

---

## 1. The question it answers

Objective 3 asks whether a locally-hosted assistant answers a reactor operator's
question **fast enough to be usable on hardware a lab actually has**. That is not
the same question as "how fast is this model", and the difference decides the
whole design:

| a model benchmark asks | this benchmark asks |
|---|---|
| tokens per second, on a short prompt | how long before the operator sees an answer |
| on reference hardware | on *this* machine, with its VRAM and its background load |
| in isolation | with a full RAG evidence pack in the prompt |

So the unit of measurement is **an operator's wait**, and the headline figure is
**time-to-first-token (TTFT)**, not throughput. A model that streams at 40 tok/s
but takes nine seconds to start feels broken; one that starts in 900ms and
streams at 16 tok/s feels responsive. §9.2 asks for mean, p50 and p95 for
exactly this reason — the tail is what an operator remembers.

---

## 2. The prompt is ~2k tokens, and that is the single most important choice

**The failure this avoids.** Benchmarking `"hello"` produces a flattering number
the live system never reproduces. On a short prompt there is almost no prefill,
so TTFT collapses to near-zero and the measurement says nothing about the
deployed system.

A real Daedalus query never looks like that. It arrives with an evidence pack —
retrieved SOP and manual chunks, plus replayed conversation history — so the
prompt is typically **1–3k tokens**. Prefill (processing that prompt before the
first output token) dominates TTFT, and TTFT dominates perceived latency. The
benchmark therefore builds a representative pack and measures against it.

Measured on the development machine (RTX 3050 Laptop, 4GB VRAM):

| prompt | model | TTFT | prefill |
|---|---|---|---|
| 91 tokens (bare question) | `qwen3:1.7b` | 3,399 ms | 152 ms |
| 2,321 tokens (evidence pack) | `qwen3:1.7b` | 1,123 ms | 890 ms |

Prefill rises roughly **6×** with the realistic prompt. A benchmark on the bare
question would have measured the wrong thing by a wide margin.

> The 91-token rows come from live chat before retrieval is wired in. Once
> retrieval lands, chat prompts will sit in the same 1–3k band as the benchmark,
> which is the point: the two become directly comparable.

### 2.1 Where the pack comes from, and why that is recorded

`build_prompt()` prefers a **real** pack and falls back to a **fixture**:

1. **`rag_logs`** — a retrieval this system genuinely performed, with its chunks
   fetched back out of the vector store. The strongest case: the prompt is one
   the deployed system actually produced.
2. **Fixture** — synthetic reactor-SOP text padded to the same token budget,
   used when nothing has been retrieved yet or the vector store is unavailable.

Which was used travels with the result as `prompt.source` and is shown in the
UI. **A fixture number and a production-trace number are different claims** and
the report must not present them as one. A viva question of the form "is that a
real workload or a synthetic one?" has a recorded answer per run.

---

## 3. Two clocks, never mixed

The benchmark records two families of number and deliberately derives neither
from the other:

| recorded | measured by | answers |
|---|---|---|
| `time_to_first_token_ms`, `total_inference_ms` | the caller's wall clock | what an operator waits through — what Objective 3 is about |
| `prefill_ms`, `generation_ms`, `load_ms` | Ollama's own counters | what the model costs, independent of what else the machine was doing |

**Why this separation is not pedantry.** The first version derived the
generation rate as `completion ÷ (total − TTFT)`. That looks equivalent to
asking the engine and is not: it charges the model for every client-side and
scheduling delay inside that window. On a busy machine it reported `llama3.2` at
**11 tok/s** where Ollama's counters said **23.9** — and made the memory
estimator look 0.38× optimistic when, measured properly, it was within 3%. A
whole chapter's conclusion would have been wrong.

So `tokens_per_sec` comes from `eval_count ÷ eval_duration`, the engine's own
figures. When the engine returns no counters the wall-clock fallback is used
**and flagged** as `rate_source: "wall_clock"` — see §6.

---

## 4. Warm-up, and what it excludes

A warm-up pass runs before the timed one. Without it the first benchmark of a
model measures **disk**, not inference:

| `llama3.2` | TTFT |
|---|---|
| cold (weights not resident) | 22.0 s |
| warm | 1.2 s |

Nearly all of that gap was reading 1.9 GB of weights off an SSD. Both numbers
are true and they answer different questions; the benchmark measures the warm
case because that is the steady state an operator lives in, and records
`warmed_up` so nobody has to guess which they are reading.

The effect is still visible in live traffic — row 6 in `model_logs` carries
`load_ms: 7431`, a cold load inside a real chat turn, and its TTFT is 13,432 ms
against 3,399 ms for the equivalent warm turn. **This is the strongest argument
in the data for reporting p95 and not only the mean.**

Warm-up is **skipped for cloud tags** (§7): there are no local weights to load,
so the pass would measure nothing and spend quota.

---

## 5. Determinism

`temperature: 0.0` and a fixed `num_predict`. Re-running the benchmark must
measure the machine, not resample a different answer of a different length. With
sampling on, run-to-run variance in output length alone would swamp the latency
signal.

---

## 6. Reasoning models — a correctness bug worth knowing about

Ollama streams a reasoning model's chain of thought in a separate `thinking`
field and leaves `response` empty until deliberation finishes:

```json
{"response": "", "thinking": "Okay", "done": false}
{"response": "", "thinking": ", the", "done": false}
```

The benchmark originally started its TTFT clock on the first non-empty
`response`. For a reasoning model that token may never arrive inside
`num_predict` — so **TTFT was recorded as NULL**. Both models this project
actually uses (`qwen3`, `gpt-oss`) are reasoning models, and 2 of the first 4
successful benchmark runs lost the headline metric entirely.

The clock now starts on the first generated token **of either kind**, because
that is the moment the engine stopped prefilling and started producing, and the
operator is waiting through thinking tokens whether or not the UI renders them.
Thinking tokens count toward the token total; they are kept out of `sample`,
which is the answer text.

> If the report quotes TTFT for a reasoning model, it should say that thinking
> time is included. That is the honest measure of the operator's wait, and it is
> also why a reasoning model's TTFT is structurally higher than a
> non-reasoning one of the same size — a fair comparison must note it.

---

## 7. Cloud baselines, and what they may and may not claim

Rule 1 forbids cloud models at runtime and permits them **only as offline
evaluation baselines**. Benchmarking one is therefore legitimate, and the result
means something different from a local run. Three things follow, all set from
the tag rather than trusted to the caller:

**1. It is logged as a different kind of row.** `source = 'benchmark_cloud'`, not
`'benchmark'`. A separate value rather than a flag, so every query asking what
*this machine* can do keeps filtering `source = 'benchmark'` and stays correct
without being rewritten. Averaging the two would report a datacentre as a laptop.

**2. It never sees real documents.** `build_prompt(allow_real=False)` forces the
fixture. The real pack is genuine plant SOP and manual text, and a cloud
benchmark posts its prompt to a third party. The fixture is synthetic, so
nothing leaves the building.

**3. Its tok/s is not trustworthy.** Ollama's cloud returns **no engine
counters** — `prefill_ms`, `generation_ms` and `load_ms` are NULL on every cloud
row. The wall-clock fallback then divides by a very small window and produces
nonsense:

```
128 tokens ÷ (1891 ms − 1738 ms) = 836.6 tok/s
```

A 120B model does not generate at 836 tok/s. That figure is an artifact of a
153 ms window containing network jitter. The UI labels it `~` with
`rate source: wall_clock`, and **the report must not quote a cloud tok/s
figure**. TTFT and end-to-end for cloud rows are measured directly and are
sound; the generation rate is not.

Cloud TTFT across two runs of the same prompt: **1,090 ms** and **1,738 ms** — a
60% spread, because the load on someone else's GPU is not a controlled variable.

---

## 8. Where it is stored

Every run writes one `model_logs` row with a synthetic `query_id` prefixed
`bench_`. This is **the same table live traffic writes to**, which is the point:
§2.3 requires the latency chapter to draw benchmark and production numbers from
one place so they are comparable. `source` is what separates them again:

| `source` | meaning |
|---|---|
| `chat` | a live query. Local model, Rule 1. |
| `benchmark` | a Forge run on this machine's hardware. |
| `benchmark_cloud` | a Forge run against a cloud tag. Measures someone else's hardware. |

Failed runs are written too, with `status = 'error'` and the daemon's own
message. A benchmark that could not run is evidence, not an absence.

`error_message` is exported with these rows, so nothing sensitive goes in it —
notably, the signin URL Ollama returns on an unauthorized cloud request is a
capability and is carried to the UI on a transient event instead.

---

## 9. Threats to validity — the honest limitations

Name these before an examiner does.

**9.1 Single run per click.** No averaging, no confidence interval. The observed
spread is large — live TTFT for the same model and prompt ranged 3,399 ms to
13,432 ms (4×), driven by cold loads and background load. *Any figure in the
report must be an aggregate over many runs, drawn from `model_logs` by query,
not a single benchmark result read off the UI.* Averaging inside the tool is
tracked in `TODO.md`.

**9.2 The machine is not quiescent.** Runs happen on a development laptop with a
browser and a dev server running. This is arguably more representative than a
sterile bench, but it is not controlled. The engine counters (`prefill_ms`,
`generation_ms`) are the defence: they are insulated from background load in a
way the wall clock is not, which is precisely why both are recorded.

**9.3 Fixture vs production-trace prompts are different populations.** Both are
~2k tokens, but the fixture is synthetic reactor text and a `rag_logs` pack is
whatever retrieval actually returned. Do not pool them without saying so.
`prompt.source` on every row makes the split recoverable after the fact.

**9.4 Cloud rows measure a moving target.** Ollama may change the hardware
behind `gpt-oss:120b` at any time, and `model_logs` has no column recording
which hardware served a run. Two cloud rows months apart may not be comparable
and nothing in the data would reveal it. Treat cloud numbers as a
*contemporaneous* reference point, not a stable baseline.

**9.5 Reasoning-model TTFT includes thinking time** (§6). Fair within a model,
and a caveat that must be stated when comparing a reasoning model against a
non-reasoning one.

**9.6 Quantisation is not held constant** across the candidate set. A Q4_K_M and
a Q8_0 build of the same model are different artifacts with different speed and
quality. The Forge records `quantization` per row; comparisons must respect it.

**9.7 One prompt shape.** Latency is measured on a RAG-style evidence pack only.
A long multi-turn conversation with no retrieval has a different prefill profile
and is not covered.

---

## 10. Reproducing a figure

```bash
./daedalus.sh dev          # or start
# Forge → Models → benchmark (flask icon) on any installed row
```

Then read the numbers from the store rather than the screen:

```sql
-- local benchmark latency, aggregated the way §9.2 asks for
SELECT model_name,
       COUNT(*)                                   AS runs,
       AVG(time_to_first_token_ms)                AS ttft_mean,
       AVG(total_inference_ms)                    AS total_mean,
       AVG(CAST(completion_token_count AS REAL)
           / (generation_ms / 1000.0))            AS tok_s_engine
FROM model_logs
WHERE source = 'benchmark'          -- excludes cloud and live chat
  AND status = 'ok'
  AND generation_ms IS NOT NULL     -- engine-derived rates only
GROUP BY model_name;
```

SQLite has no percentile function; compute p50/p95 in the analysis script from
the ordered rows. `services/model_usage.py` already does this per model and is
what the Forge displays.

Store: `logs/ai_logs.db` in dev, `DAEDALUS_LOG_DIR` otherwise.

---

## 11. What a reader may conclude

**Supported.** That a given model, on this machine, with a realistic RAG-sized
prompt, starts answering in *X* ms and completes in *Y* ms; and that its
engine-reported generation rate is *Z* tok/s. Aggregated across enough runs,
with p50 and p95, this answers Objective 3 directly.

**Not supported.** That these figures transfer to other hardware; that a cloud
model's generation rate is *Z* (§7); that a single run is representative (§9.1);
or that two models differing in quantisation or in reasoning behaviour are
being compared like for like (§9.5, §9.6).
