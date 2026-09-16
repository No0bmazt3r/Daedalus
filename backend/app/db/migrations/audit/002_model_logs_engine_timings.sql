-- Separate the runtime's own timings from wall-clock measurement.
--
-- `total_inference_ms` and `time_to_first_token_ms` are measured by the client
-- and are the right numbers for "what does an operator experience" — they
-- include queueing, transport and whatever else the machine was doing. But they
-- are not the right numbers for "how fast is this model", and the first Forge
-- benchmark conflated the two: it reported llama3.2 at 11 tok/s where the
-- engine's own counters said 23.9, because the client-side arithmetic swept up
-- several seconds of unrelated load on a busy machine.
--
-- Ollama reports `prompt_eval_duration` and `eval_duration` per request. Those
-- are what the engine actually spent on prefill and on generation, and they are
-- what belongs in a latency chapter next to the perceived figures rather than
-- instead of them.
--
-- Added now, before rows accumulate. A column that arrives after the fact
-- leaves every earlier row null, and the comparison the evaluation needs is
-- exactly the one that would be missing.
ALTER TABLE model_logs ADD COLUMN prefill_ms INTEGER;
ALTER TABLE model_logs ADD COLUMN generation_ms INTEGER;
ALTER TABLE model_logs ADD COLUMN load_ms INTEGER;
-- Where the row came from: 'benchmark' for a Forge run, 'chat' for a real
-- query. Both land in this table on purpose (MODULES.md 2.3) so the latency
-- chapter can compare them; this is what lets it tell them apart again.
ALTER TABLE model_logs ADD COLUMN source TEXT;
