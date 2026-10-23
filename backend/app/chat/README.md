# Chat — answering a question (the core)

The Layer 7 orchestrator behind `POST /api/chat`: normalise → guard → rewrite →
classify → resolve times → plan → call tools → build evidence → stream the
model → **validate every number** → log under one `query_id`. Plus the
conversation itself: sessions, rolling summary, titles, the assistant settings
and the persona.

Screen: `ChatInterface.tsx`, `AnswerMarkdown.tsx`, `Citations.tsx` · Client: `lib/chatClient.ts`, `lib/sessionsClient.ts`

## Files

| File | Job |
|---|---|
| `query_pipeline/` | Steps 1–4: `normaliser`, `safety` (refuses control/write requests), `condense` (follow-ups), `intent` |
| `orchestration/` | Steps 5–8, 10: `timeparse`, `planner`, `executor`, `evidence`, `prompt`, `validator`, `numbers` |
| `inference.py` | Step 9 (the model call) and 11 (logging); ties the pipeline together |
| `chat_service.py` | Context window assembly for a session |
| `summariser.py`, `token_calibration.py` | Rolling summary; token counting calibrated per model |
| `session_titles.py` | Auto-titles for chats |
| `assistant_settings.py` | Settings → Assistant |
| `persona.py` | What the assistant learns about the user — proposed by a background job, applied only once accepted |
| `schemas.py` | Pydantic wire contracts for sessions and messages |

## Routes — `api/`

| File | Prefix |
|---|---|
| `chat.py` | `/api/chat` — send/stream, feedback, status |
| `sessions.py` | `/api/sessions` — chats and messages |
| `assistant.py` | `/api/assistant` |
| `persona.py` | `/api/persona` |

## Touches

- **Stores:** chat, audit, sensor (read-only, via tools), prefs
- **Depends on:** tools (`agent_tools` registry), forge (`ollama_client`, `model_config`), blueprints (`rag_config`, `knowledge_graph`)

Tests: `backend/tests/chat/`, `backend/tests/tools/test_orchestration.py` · Steps: `docs/PROJECT.md` §7.1
