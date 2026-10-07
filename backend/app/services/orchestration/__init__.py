"""Steps 5–8 and 10 of PROJECT.md §7.1: from an understood question to a checked answer.

    Understanding (query_pipeline, steps 1–4)
      │  planner     intent + signals → tool calls, time resolved by rules     step 5
      │  executor    agent_tools.call per call, runtime surface, query_id      step 6
      │  evidence    envelopes → labelled lines [S1] [D1] [G1]                 step 7
      │  prompt      rules + history + evidence + standalone question         step 8
      ▼
    inference.answer_stream — the model call                                  step 9
      │  validator   numbers, citations, control claims → pass or fallback     step 10
      ▼
    transcript + conversation_logs / tool_logs / rag_logs / model_logs        step 11

Nothing here calls a model. The two model steps before the answer (follow-up
rewriting, the intent tiebreaker) belong to `query_pipeline`; the answer itself
belongs to `inference`. That keeps every module in this package deterministic —
the same question against the same stores produces the same plan, the same
evidence and the same verdict — which is what makes an answer replayable from
its logs.
"""

from . import evidence, executor, numbers, planner, prompt, timeparse, validator
from .evidence import EvidencePack
from .planner import Plan
from .validator import FALLBACK, Validation

__all__ = [
    "FALLBACK",
    "EvidencePack",
    "Plan",
    "Validation",
    "evidence",
    "executor",
    "numbers",
    "planner",
    "prompt",
    "timeparse",
    "validator",
]
