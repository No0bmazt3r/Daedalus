-- Whether the model was asked to think (Forge → per-model switch). 1 on, 0 off,
-- NULL for a model without the capability and for rows written before this.
-- Thinking changes both speed and answers, so two runs are only comparable
-- when this matches.
ALTER TABLE model_logs ADD COLUMN thinking INTEGER;
