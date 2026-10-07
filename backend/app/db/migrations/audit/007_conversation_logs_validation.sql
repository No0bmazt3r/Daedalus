-- What PROJECT.md §7.1 step 10 decided about an answer, and what it replaced.
--
--   validation_json      the validator's verdict: passed, reasons, the numbers
--                        it could not find in this turn's evidence, the ones it
--                        found only in replayed history, unknown citation
--                        labels, and any control claim. NULL when no model ran.
--   model_response_text  the model's own answer, when the validator replaced it
--                        with the fixed fallback. NULL when the answer passed —
--                        `response_text` is then already what the model said.
--
-- `response_text` keeps meaning "what the operator was given". Storing the
-- rejected text beside it rather than in it is what lets the evaluation count
-- hallucinations the validator caught: a caught hallucination is still one the
-- model produced, and §9 reports both the rate produced and the rate delivered.
ALTER TABLE conversation_logs ADD COLUMN validation_json TEXT;
ALTER TABLE conversation_logs ADD COLUMN model_response_text TEXT;
