import sys

with open('backend/app/services/inference.py', 'r') as f:
    lines = f.readlines()

start = -1
end = -1
for i, line in enumerate(lines):
    if line.startswith('    def _worker() -> None:'):
        start = i
    if start != -1 and i > start and not line.startswith(' ') and line.strip():
        end = i
        break

if end == -1: end = len(lines)

new_worker = """    def _worker() -> None:
        try:
            started = time.perf_counter()
            first_token_at: float | None = None
            pieces: list[str] = state["pieces"]
            final: dict[str, Any] = {}
            error: str | None = None

            try:
                if ollama_client.httpx is None:
                    raise ollama_client.OllamaUnavailable("httpx is not installed")
                for base in ollama_client.candidate_base_urls():
                    try:
                        with ollama_client.httpx.stream(
                            "POST",
                            f"{base}/api/chat",
                            json=payload,
                            timeout=ollama_client._timeout(GENERATE_TIMEOUT),
                        ) as response:
                            if response.status_code >= 400:
                                response.read()
                                raise ollama_client.OllamaError(
                                    ollama_client._error_detail(response)
                                )
                            for line in response.iter_lines():
                                if not line.strip():
                                    continue
                                try:
                                    event = json.loads(line)
                                except ValueError:
                                    continue
                                if event.get("error"):
                                    raise ollama_client.OllamaError(str(event["error"]))
                                piece = (event.get("message") or {}).get("content") or ""
                                if piece and first_token_at is None:
                                    first_token_at = time.perf_counter()
                                if piece:
                                    pieces.append(piece)
                                    q.put({"phase": "generating", "piece": piece})
                                if event.get("done"):
                                    final = event
                        break
                    except (ollama_client.OllamaError, ollama_client.OllamaUnavailable):
                        raise
                    except Exception:
                        continue
                else:
                    raise ollama_client.OllamaUnavailable("no Ollama daemon answered")
            except Exception as exc:  # noqa: BLE001
                error = f"{exc.__class__.__name__}: {exc}"
                q.put({"phase": "error", "error": error})

            ended = time.perf_counter()
            total_ms = int((ended - started) * 1000)
            ttft_ms = int((first_token_at - started) * 1000) if first_token_at else None
            text = _LEADING_STAMP.sub("", "".join(pieces)).strip()

            ns = 1_000_000
            audit_store.log(
                "model_logs",
                query_id=query_id,
                model_name=tag,
                temperature=None,
                prompt_token_count=final.get("prompt_eval_count"),
                completion_token_count=final.get("eval_count") or (len(pieces) or None),
                time_to_first_token_ms=ttft_ms,
                total_inference_ms=total_ms,
                prefill_ms=int(final.get("prompt_eval_duration", 0) // ns) or None,
                generation_ms=int(final.get("eval_duration", 0) // ns) or None,
                load_ms=int(final.get("load_duration", 0) // ns) or None,
                source="chat",
                status="error" if error else "ok",
                error_message=error,
            )

            audit_store.log(
                "conversation_logs",
                query_id=query_id,
                session_id=session_id,
                user_query=question,
                model_used=tag,
                response_text=text if not error else None,
                total_latency_ms=total_ms,
                error_message=error,
            )

            if error:
                q.put(None)
                return

            stored = chat_service.add_assistant_message(
                session_id, text, query_id=query_id, evidence=evidence, model_tag=tag
            )

            q.put({
                "phase": "done",
                "result": {
                    "query_id": query_id,
                    "session_id": session_id,
                    "user_message": user_turn,
                    "message": stored,
                    "answer": text,
                    "model": tag,
                    "model_choice": choice,
                    "timings": {
                        "time_to_first_token_ms": ttft_ms,
                        "total_inference_ms": total_ms,
                        "prefill_ms": int(final.get("prompt_eval_duration", 0) // ns) or None,
                        "generation_ms": int(final.get("eval_duration", 0) // ns) or None,
                    },
                    "context": {
                        "history_messages": len(window.messages),
                        "dropped": window.dropped,
                        "estimated_tokens": window.estimated_tokens,
                        "needs_summary": window.needs_summary,
                    },
                }
            })
            q.put(None)
        finally:
            ACTIVE_GENERATIONS.pop(session_id, None)

"""

lines[start:end] = [new_worker]
with open('backend/app/services/inference.py', 'w') as f:
    f.writelines(lines)
