"""
Router FastAPI pour l'endpoint de chat.
POST /chat : streaming SSE via RAGPipeline (Ollama + Qdrant).
Accepte un provider et un modèle optionnels pour choisir le LLM à la volée.
"""

import json
import logging
from uuid import uuid4

from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from core.llm import get_llm_provider
from core.pipeline_instance import get_pipeline
from core.llm_stats import record_llm_run

logger = logging.getLogger(__name__)
router = APIRouter()

pipeline = get_pipeline()


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatBody(BaseModel):
    messages: list[ChatMessage]
    role_name: str | None = None
    department: str | None = None
    conversation_id: str | None = None
    provider: str | None = None
    model: str | None = None
    # Identifiants Qdrant metadata.source (ex. supabase:<uuid>) pour @mentions sans coller tout le texte.
    mentioned_source_ids: list[str] | None = None
    # Fenêtre de contexte du modèle (tokens), ex. champ context_length d’OpenRouter — pour borner le texte @mention.
    model_context_tokens: int | None = None


@router.post("/chat")
async def chat(body: ChatBody):
    user_messages = [m for m in body.messages if m.role == "user"]
    if not user_messages:
        return JSONResponse(status_code=400, content={"error": "Aucun message utilisateur fourni."})

    message = user_messages[-1].content
    conversation_id = body.conversation_id or str(uuid4())

    try:
        llm = get_llm_provider(provider=body.provider, model=body.model)
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})

    async def event_stream():
        try:
            import time

            t_start = time.perf_counter()
            first_token_ms: float | None = None

            async for item in pipeline.stream_query(
                message=message,
                conversation_id=conversation_id,
                user_id="anonymous",
                role_name=body.role_name or "",
                department=body.department or "",
                llm=llm,
                mentioned_source_ids=body.mentioned_source_ids,
                model_context_tokens=body.model_context_tokens,
            ):
                if not isinstance(item, dict):
                    # Compat backward si d'autres implémentations renvoient encore un str
                    payload = json.dumps({"choices": [{"delta": {"content": str(item)}}]})
                    yield f"data: {payload}\n\n"
                    continue

                kind = item.get("type")

                if kind == "token":
                    now = time.perf_counter()
                    if first_token_ms is None:
                        first_token_ms = (now - t_start) * 1000.0
                    payload = json.dumps({"choices": [{"delta": {"content": item.get("content", "")}}]})
                    yield f"data: {payload}\n\n"
                elif kind == "error":
                    payload = json.dumps({"choices": [{"delta": {"content": item.get("content", "")}}]})
                    yield f"data: {payload}\n\n"
                elif kind == "meta":
                    # Chunk final avec les stats d'usage et de temps de réponse
                    now = time.perf_counter()
                    response_time_ms = (now - t_start) * 1000.0
                    meta = {
                        "provider": body.provider or "openrouter",
                        "model": body.model or "",
                        "timing": {
                            "response_time_ms": round(response_time_ms),
                            "first_token_ms": round(first_token_ms or response_time_ms),
                        },
                        "usage": item.get("usage", {}),
                    }
                    # Journalisation best-effort pour le comparateur LLM.
                    try:
                        record_llm_run(meta)
                    except Exception:
                        # En cas d'erreur de logging on ne casse pas la réponse utilisateur.
                        pass
                    payload = json.dumps({"meta": meta})
                    yield f"data: {payload}\n\n"

            yield "data: [DONE]\n\n"
        except Exception as exc:
            logger.error("Erreur RAG stream : %s", exc)
            yield f"data: [ERREUR] {exc}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
        },
    )
