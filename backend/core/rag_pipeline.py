"""
Pipeline RAG (Retrieval-Augmented Generation) principal.
Orchestre la chaîne complète : recherche les chunks pertinents dans Qdrant →
construit le prompt avec contexte → appelle le LLM et retourne la réponse en streaming.
"""

import asyncio
import logging
from collections import defaultdict
from typing import AsyncGenerator, TypedDict, Any

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

from core.llm import BaseLLMProvider, LLMProviderError, get_llm_provider
from core.llm.openwebui import OpenWebUIProvider
from core.vector_store import QdrantStore

logger = logging.getLogger(__name__)

_MAX_HISTORY_TURNS = 10  # Nombre maximum de tours (question+réponse) conservés par conversation

# Fenêtre de contexte si le client ne fournit pas `model_context_tokens` (OpenRouter / défaut courant).
_DEFAULT_MODEL_CONTEXT_TOKENS = 128_000
# Estimation prudente pour texte FR / technique (souvent ~2 caractères par token côté Azure / cl100k).
_CHARS_PER_TOKEN_ESTIMATE = 2.0
_CONTEXT_SAFETY_MARGIN_TOKENS = 2_048

_DOC_SECTION_PREFIX = "\n\n=== DOCUMENTS PERTINENTS (base documentaire Telko) ===\n"
_MENTION_TRUNCATION_NOTE = (
    "[Note : seule une partie du document a été transmise au modèle (limite de contexte). "
    "Le résumé ou l’analyse peuvent être incomplets.]\n\n"
)


def _rough_tokens_from_chars(char_count: int) -> int:
    return max(0, int(char_count / _CHARS_PER_TOKEN_ESTIMATE))


def _completion_reserve_tokens(model_ctx: int) -> int:
    """Réserve une partie de la fenêtre pour la génération (les API comptent souvent prompt + sortie)."""
    return min(16_384, max(4_096, model_ctx // 8))


def _format_markdown_instructions_block(role_name: str, department: str) -> str:
    """Bloc d’instructions Markdown + profil (sans section documents)."""
    return (
        "Mise en forme attendue (Markdown) :\n"
        "- Utilise des titres de niveau 2 (`##`) pour structurer ta réponse (par exemple `## Résumé`, `## Détails`, `## Actions recommandées`).\n"
        "- Utilise des listes à puces pour énumérer des points.\n"
        "- Mets en **gras** les éléments importants (décisions, chiffres clés, avertissements).\n"
        "- Sois clair, concis et évite les phrases trop longues.\n\n"
        "Gestion des sources :\n"
        "- Quand tu t'appuies sur un document, mentionne-le dans le texte sous la forme `[nom_du_fichier – page X]` lorsque la page est connue.\n"
        "- À la toute fin de ta réponse, ajoute OBLIGATOIREMENT une section `## Sources`.\n"
        "- Dans `## Sources`, liste uniquement les documents réellement utilisés pour répondre, sous forme de liens Markdown cliquables :\n"
        "  - `- [nom_du_fichier – page X](#)` si tu ne connais pas l'URL exacte,\n"
        "  - ou `- [nom_du_fichier – page X](URL_COMPLÈTE)` si l'URL est présente dans le texte du contexte.\n\n"
        f"L'utilisateur est {role_name or 'un collaborateur'} dans le département {department or 'non précisé'}."
    )


def _telko_rag_system_lead() -> str:
    return (
        "Tu es un assistant interne pour une société de télécom et tu réponds TOUJOURS en français. "
        "Réponds UNIQUEMENT à partir des documents fournis ci‑dessous. "
        "Si une information n'est pas explicitement présente dans les documents, dis-le clairement et explique ce qu'il manque.\n\n"
    )


def _mention_context_char_cap(
    *,
    model_context_tokens: int,
    role_name: str,
    department: str,
    message: str,
    history: list[tuple[str, str]],
) -> int:
    """
    Nombre maximal de caractères pour le corps du contexte documentaire @mention,
    d’après la fenêtre du modèle et une estimation prudente des tokens (prompt hors document).
    """
    ctx = min(max(model_context_tokens, 8_192), 2_000_000)
    reserve_out = _completion_reserve_tokens(ctx)
    prompt_token_budget = ctx - reserve_out - _CONTEXT_SAFETY_MARGIN_TOKENS
    if prompt_token_budget < 1024:
        prompt_token_budget = 1024

    skeleton = (
        _telko_rag_system_lead()
        + _format_markdown_instructions_block(role_name, department)
        + _DOC_SECTION_PREFIX
    )
    hist_chars = sum(len(h) + len(a) for h, a in history[-_MAX_HISTORY_TURNS :])
    fixed_tokens = _rough_tokens_from_chars(len(skeleton) + len(message) + hist_chars)

    mention_token_budget = prompt_token_budget - fixed_tokens
    char_cap = int(mention_token_budget * _CHARS_PER_TOKEN_ESTIMATE)
    cap = max(0, char_cap)
    logger.info(
        "Budget contexte @mention : model_ctx=%d, reserve_sortie=%d, cap_chars=%d (estimation %.1f car./token).",
        ctx,
        reserve_out,
        cap,
        _CHARS_PER_TOKEN_ESTIMATE,
    )
    return cap


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

class SourceRef(TypedDict):
    filename: str
    page: str | int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _format_context(docs: list[Document]) -> str:
    """Formate la liste de Documents en un bloc de contexte lisible par le LLM."""
    parts: list[str] = []
    for doc in docs:
        filename = doc.metadata.get("filename") or doc.metadata.get("source", "inconnu")
        page = doc.metadata.get("page", "")
        header = f"[{filename}" + (f", page {page}]" if page else "]")
        parts.append(f"{header}\n{doc.page_content}")
    return "\n\n".join(parts)


def _format_mention_context(docs: list[Document]) -> str:
    """
    Contexte @mention : un seul titre par fichier, puis les corps de chunks concaténés.
    Évite un en-tête par chunk (512 car.), ce qui explosait le nombre de tokens côté Azure.
    """
    if not docs:
        return ""
    blocks: list[str] = []
    current_title: str | None = None
    buf: list[str] = []

    def flush() -> None:
        nonlocal buf, current_title
        if current_title is None or not buf:
            return
        blocks.append(f"### {current_title}\n\n" + "\n\n".join(buf))
        buf = []

    for d in docs:
        title = str(d.metadata.get("filename") or d.metadata.get("source") or "Document")
        body = (d.page_content or "").strip()
        if not body:
            continue
        if title != current_title:
            flush()
            current_title = title
        buf.append(body)
    flush()
    return "\n\n---\n\n".join(blocks)


def _sort_mention_chunks(docs: list[Document]) -> None:
    """Ordonne les chunks d’un même document (page puis offset de découpe si présent)."""

    def key(d: Document) -> tuple:
        m = d.metadata or {}
        page = m.get("page")
        try:
            p = int(page) if page is not None else 0
        except (TypeError, ValueError):
            p = 0
        start = m.get("start_index")
        try:
            s = int(start) if start is not None else 0
        except (TypeError, ValueError):
            s = 0
        return (p, s)

    docs.sort(key=key)


def _extract_sources(docs: list[Document]) -> list[SourceRef]:  # noqa: F841 — conservé pour usage futur
    """Extrait les références de source uniques depuis les métadonnées des Documents."""
    seen: set[tuple] = set()
    sources: list[SourceRef] = []
    for doc in docs:
        filename = doc.metadata.get("filename") or doc.metadata.get("source", "")
        page = doc.metadata.get("page", "")
        key = (filename, page)
        if key not in seen:
            seen.add(key)
            sources.append({"filename": filename, "page": page})
    return sources


# ---------------------------------------------------------------------------
# RAGPipeline
# ---------------------------------------------------------------------------

class RAGPipeline:
    """
    Orchestre les composants du pipeline RAG :
      - RecursiveCharacterTextSplitter (chunk_size=512, overlap=64)
      - QdrantStore pour la recherche sémantique
      - LLM provider (get_llm_provider) pour le streaming token par token

    Historique de conversation :
      Stocké en mémoire dans un dict {conversation_id: [(human, ai), ...]}.
      Limité à _MAX_HISTORY_TURNS tours (les plus anciens sont supprimés).

    Méthode publique :
      - stream_query() : tokens en streaming (SSE)
    """

    def __init__(self) -> None:
        self._store = QdrantStore()
        self._llm = get_llm_provider()
        self._splitter = RecursiveCharacterTextSplitter(
            chunk_size=512,
            chunk_overlap=64,
            length_function=len,
        )
        # Historique par conversation_id : list de (question, réponse)
        self._histories: dict[str, list[tuple[str, str]]] = defaultdict(list)
        logger.info("RAGPipeline initialisé.")

    # ------------------------------------------------------------------
    # Gestion de la collection Qdrant (à appeler au démarrage)
    # ------------------------------------------------------------------

    def init(self) -> None:
        """Initialise la collection Qdrant. À appeler une fois au démarrage de l'app."""
        self._store.init_collection()

    # ------------------------------------------------------------------
    # Historique de conversation
    # ------------------------------------------------------------------

    def _get_history(self, conversation_id: str) -> list[tuple[str, str]]:
        return self._histories[conversation_id]

    def _save_turn(self, conversation_id: str, question: str, answer: str) -> None:
        """Ajoute un tour à l'historique et tronque si nécessaire."""
        history = self._histories[conversation_id]
        history.append((question, answer))
        if len(history) > _MAX_HISTORY_TURNS:
            self._histories[conversation_id] = history[-_MAX_HISTORY_TURNS:]

    def clear_history(self, conversation_id: str) -> None:
        """Efface l'historique d'une conversation (utile pour les tests ou reset UI)."""
        self._histories.pop(conversation_id, None)

    # ------------------------------------------------------------------
    # Ingestion (chunking + upsert)
    # ------------------------------------------------------------------

    async def ingest_document(self, text: str, metadata: dict) -> int:
        """
        Découpe un texte en chunks et les indexe dans Qdrant.

        Args:
            text:     Texte brut du document.
            metadata: Dict avec au minimum 'source' (et idéalement 'filename', 'page').

        Returns:
            Nombre de chunks créés et indexés.
        """
        chunks = self._splitter.create_documents(
            texts=[text],
            metadatas=[metadata],
        )
        if not chunks:
            logger.warning("Aucun chunk produit pour source='%s'.", metadata.get("source"))
            return 0
        await self._store.add_documents(chunks)
        logger.info(
            "Document '%s' indexé en %d chunk(s).",
            metadata.get("source", "?"),
            len(chunks),
        )
        return len(chunks)

    # ------------------------------------------------------------------
    # Streaming token par token
    # ------------------------------------------------------------------

    async def stream_query(
        self,
        message: str,
        conversation_id: str,
        user_id: str,  # noqa: ARG002
        role_name: str = "",
        department: str = "",
        llm: BaseLLMProvider | None = None,
        mentioned_source_ids: list[str] | None = None,
        model_context_tokens: int | None = None,
        openwebui_knowledge_source: str | None = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        """
        Interroge le pipeline RAG et yield les tokens au fur et à mesure.

          1. Récupère l'historique de la conversation
          2. Contexte : Open WebUI + `openwebui_knowledge_source=telko` (défaut) → contexte Qdrant Telko (@mention ou k=5) ;
             Open WebUI + `openwebui` → RAG côté instance OW (paramètre `files` si configuré) ;
             sinon chunks Qdrant pour `mentioned_source_ids` (@mention) ou recherche sémantique (k=5).
          3. Construit les messages au format OpenAI-like avec contexte + historique
          4. Stream via le LLM provider

        L'historique est mis à jour après la génération complète.

        `model_context_tokens` : fenêtre du modèle (ex. context_length OpenRouter) pour tronquer le texte @mention.

        `openwebui_knowledge_source` : uniquement si le LLM est OpenWebUIProvider — `telko` (défaut) ou `openwebui`.
        """
        history = self._get_history(conversation_id)

        active_llm = llm or self._llm
        raw_ow_src = (openwebui_knowledge_source or "telko").strip().lower()
        if raw_ow_src not in ("openwebui", "telko"):
            raw_ow_src = "telko"
        # Open Web UI : si `openwebui`, RAG délégué à l’instance OW (paramètre `files` si configuré).
        # Si `telko` (défaut), même LLM OW mais contexte Qdrant Telko — pas de `files` (évite double RAG).
        use_openwebui_server_rag = isinstance(active_llm, OpenWebUIProvider) and raw_ow_src == "openwebui"
        n_mention = len([x for x in (mentioned_source_ids or []) if (x or "").strip()])
        ow_files_n = (
            len(getattr(active_llm, "chat_files", None) or [])
            if isinstance(active_llm, OpenWebUIProvider)
            else 0
        )
        if use_openwebui_server_rag:
            rag_branch = "openwebui_with_files_param" if ow_files_n else "openwebui_no_files_param"
        elif n_mention:
            rag_branch = "qdrant_fetch_by_mention"
        else:
            rag_branch = "qdrant_semantic_k5"
        logger.info(
            "Telko diag | rag_request | conv=%s | provider_openwebui=%s | ow_knowledge_source=%s | "
            "ow_files_entries=%s | mentions=%d | branch=%s",
            conversation_id,
            isinstance(active_llm, OpenWebUIProvider),
            raw_ow_src if isinstance(active_llm, OpenWebUIProvider) else None,
            ow_files_n,
            n_mention,
            rag_branch,
        )

        if use_openwebui_server_rag:
            docs = []
            embed_usage = {}
            context = ""
            if ow_files_n:
                logger.info(
                    "RAGPipeline.stream_query — conv=%s | requête='%s...' | RAG Open WebUI (paramètre files=%d), "
                    "Qdrant Telko ignoré.",
                    conversation_id,
                    (message[:80] + "…") if len(message) > 80 else message,
                    ow_files_n,
                )
            else:
                logger.info(
                    "RAGPipeline.stream_query — conv=%s | requête='%s...' | RAG uniquement côté instance Open WebUI "
                    "(pas de paramètre files Telko), Qdrant Telko ignoré.",
                    conversation_id,
                    (message[:80] + "…") if len(message) > 80 else message,
                )
            openwebui_lead = (
                "Tu es un assistant interne pour une société de télécom et tu réponds TOUJOURS en français. "
            )
            if ow_files_n:
                openwebui_lead += (
                    "Telko transmet à Open WebUI des références de base documentaire (paramètre `files` de l’API) ; "
                    "l’instance doit enrichir la requête avec les extraits pertinents. "
                )
            else:
                openwebui_lead += (
                    "La recherche documentaire (RAG) doit être assurée par l’instance Open WebUI "
                    "(configuration Knowledge / pipelines côté serveur), pas par la base Telko (Qdrant). "
                )
            openwebui_lead += (
                "Réponds en t’appuyant sur le contexte qu’Open WebUI injecte dans la conversation ; "
                "si l’information n’y figure pas, dis-le clairement.\n\n"
            )
            system_content = openwebui_lead + _format_markdown_instructions_block(role_name, department)
        else:
            embed_usage: dict[str, Any] = {}
            ids = [s.strip() for s in (mentioned_source_ids or []) if s.strip()]
            if ids:
                mention_docs: list[Document] = []
                for sid in ids:
                    part = await asyncio.get_event_loop().run_in_executor(
                        None,
                        self._store.fetch_all_by_source,
                        sid,
                    )
                    mention_docs.extend(part)
                _sort_mention_chunks(mention_docs)
                if not mention_docs:
                    yield {
                        "type": "error",
                        "content": (
                            "\n\n⚠️ Ce document n’a pas d’extraits indexés dans la base de recherche. "
                            "Ouvrez la Base documentaire et vérifiez que le fichier est bien indexé, "
                            "puis réessayez."
                        ),
                    }
                    return
                docs = mention_docs
                logger.info(
                    "RAGPipeline.stream_query — conv=%s | @mention | %d chunk(s) depuis Qdrant | requête='%s...'.",
                    conversation_id,
                    len(docs),
                    (message[:80] + "…") if len(message) > 80 else message,
                )
            else:
                docs = await self._store.similarity_search(message, k=5)
                logger.info(
                    "RAGPipeline.stream_query — conv=%s | requête='%s...' | %d document(s) de contexte.",
                    conversation_id,
                    (message[:80] + "…") if len(message) > 80 else message,
                    len(docs),
                )
                if not docs:
                    logger.warning(
                        "RAGPipeline.stream_query — aucun document retourné par Qdrant pour conv=%s. "
                        "Vérifier l'ingestion (chunks indexés) et la collection '%s'.",
                        conversation_id,
                        self._store._collection if hasattr(self._store, "_collection") else "inconnue",
                    )
                else:
                    preview = [
                        {
                            "source": d.metadata.get("source"),
                            "filename": d.metadata.get("filename") or d.metadata.get("source"),
                            "page": d.metadata.get("page"),
                        }
                        for d in docs[:5]
                    ]
                    logger.debug("RAGPipeline.stream_query — premiers documents de contexte: %s", preview)
                embed_usage = self._store.get_last_embeddings_usage() or {}

            if ids:
                context = _format_mention_context(docs)
            else:
                context = _format_context(docs)
            if ids:
                mctx = model_context_tokens if model_context_tokens and model_context_tokens > 0 else _DEFAULT_MODEL_CONTEXT_TOKENS
                cap = _mention_context_char_cap(
                    model_context_tokens=mctx,
                    role_name=role_name,
                    department=department,
                    message=message,
                    history=history,
                )
                if len(context) > cap:
                    note = _MENTION_TRUNCATION_NOTE
                    body_cap = max(0, cap - len(note))
                    context = note + context[:body_cap]

            system_content = (
                _telko_rag_system_lead()
                + _format_markdown_instructions_block(role_name, department)
                + _DOC_SECTION_PREFIX
                + context
            )

        messages = [
            {
                "role": "system",
                "content": system_content,
            },
            # Historique : derniers 10 tours = 20 messages, format user/assistant alterné
            *[
                msg
                for human, ai in history[-10:]
                for msg in (
                    {"role": "user", "content": human},
                    {"role": "assistant", "content": ai},
                )
            ],
            {"role": "user", "content": message},
        ]
        full_response = ""
        # usage brut renvoyé par le provider (OpenRouter dans notre cas)
        raw_usage: dict[str, Any] | None = None
        try:
            if isinstance(active_llm, OpenWebUIProvider) and not use_openwebui_server_rag:
                stream_iter = active_llm.stream(messages, files_payload=[])
            else:
                stream_iter = active_llm.stream(messages)
            async for content, usage in stream_iter:  # type: ignore[misc]
                if usage:
                    # Dernier chunk de stream : uniquement l'usage
                    raw_usage = dict(usage)
                if content:
                    full_response += content
                    yield {"type": "token", "content": content}
        except LLMProviderError as e:
            yield {"type": "error", "content": f"\n\n⚠️ Erreur LLM : {e}"}
            return

        self._save_turn(conversation_id, message, full_response)
        logger.info(
            "stream_query() — conv=%s | %d chars | %d source(s).",
            conversation_id,
            len(full_response),
            len(docs),
        )

        # Chunk final : toujours émettre les métadonnées (latences / journalisation), même si le
        # provider ne renvoie pas d'usage tokenisé (ex. certaines API Open WebUI en streaming).
        embed_tokens = {
            "prompt_tokens": embed_usage.get("prompt_tokens"),
            "total_tokens": embed_usage.get("total_tokens"),
        }
        if raw_usage is not None:
            llm_tokens = {
                "prompt_tokens": raw_usage.get("prompt_tokens"),
                "completion_tokens": raw_usage.get("completion_tokens"),
                "total_tokens": raw_usage.get("total_tokens"),
            }
            cost_total = raw_usage.get("cost")
            usage_struct = {
                "llm": llm_tokens,
                "embeddings": embed_tokens,
                "cost": {
                    "llm_usd": cost_total,
                    "embeddings_usd": None,
                    "total_usd": cost_total,
                },
                "raw": raw_usage,
            }
        else:
            usage_struct = {
                "llm": {
                    "prompt_tokens": None,
                    "completion_tokens": None,
                    "total_tokens": None,
                },
                "embeddings": embed_tokens,
                "cost": {
                    "llm_usd": None,
                    "embeddings_usd": None,
                    "total_usd": None,
                },
                "raw": None,
            }
        yield {"type": "meta", "usage": usage_struct}


# ---------------------------------------------------------------------------
# Tests basiques — exécuter avec : python core/rag_pipeline.py
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import os
    import sys

    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

    from config import settings

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    pipeline = RAGPipeline()

    async def setup() -> None:
        """Initialise Qdrant et indexe des documents de test."""
        pipeline.init()
        await pipeline.ingest_document(
            text=(
                "Le projet Telko est une plateforme de gestion documentaire interne. "
                "Elle permet d'indexer des fichiers SharePoint et de les interroger via un assistant IA."
            ),
            metadata={"source": "test-telko", "filename": "presentation_telko.pdf", "page": 1},
        )
        await pipeline.ingest_document(
            text=(
                "La politique de congés de l'entreprise prévoit 25 jours ouvrés par an. "
                "Les demandes doivent être soumises 2 semaines à l'avance via le portail RH."
            ),
            metadata={"source": "test-rh", "filename": "politique_rh.pdf", "page": 3},
        )
        await asyncio.sleep(0.5)  # Laisse Qdrant indexer
        print("Documents de test indexés.")

    async def test_stream_query() -> None:
        print("\n=== TEST stream_query() ===")
        tokens: list[str] = []
        async for token in pipeline.stream_query(
            message="Qu'est-ce que Telko ?",
            conversation_id="conv-test-001",
            user_id="user-001",
        ):
            print(token, end="", flush=True)
            tokens.append(token)
        print()
        assert len(tokens) > 0, "Le stream doit produire des tokens"
        print("OK")

    async def test_history_truncation() -> None:
        print(f"\n=== TEST troncature historique (max {_MAX_HISTORY_TURNS} tours) ===")
        conv_id = "conv-test-truncate"
        for i in range(_MAX_HISTORY_TURNS + 3):
            pipeline._save_turn(conv_id, f"question {i}", f"réponse {i}")
        history = pipeline._get_history(conv_id)
        assert len(history) == _MAX_HISTORY_TURNS, (
            f"Attendu {_MAX_HISTORY_TURNS} tours, obtenu {len(history)}"
        )
        assert history[0][0] == f"question {3}", "Les plus anciens doivent être supprimés"
        print(f"Historique tronqué à {len(history)} tours. OK")

    async def cleanup() -> None:
        from qdrant_client.models import FieldCondition, Filter, FilterSelector, MatchValue
        for source_id in ("test-telko", "test-rh"):
            pipeline._store._client.delete(
                collection_name=settings.qdrant_collection_name,
                points_selector=FilterSelector(
                    filter=Filter(
                        must=[FieldCondition(key="metadata.source", match=MatchValue(value=source_id))]
                    )
                ),
            )
        print("\nNettoyage des données de test OK.")

    async def run_all() -> None:
        await setup()
        await test_stream_query()
        await test_history_truncation()
        await cleanup()
        print("\nTous les tests sont passés.")

    asyncio.run(run_all())
