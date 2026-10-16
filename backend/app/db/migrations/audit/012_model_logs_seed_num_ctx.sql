-- What the answer was decoded under, beside the existing `temperature`:
-- `ollama_client.ANSWER_OPTIONS`. Two answers with the same prompt_sha256,
-- model, seed and num_ctx at temperature 0 should be the same answer.
-- NULL on rows written before this, which were sampled at the model's default.
ALTER TABLE model_logs ADD COLUMN seed INTEGER;
ALTER TABLE model_logs ADD COLUMN num_ctx INTEGER;
