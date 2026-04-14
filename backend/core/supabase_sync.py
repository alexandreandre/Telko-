"""
Synchronisation des documents Supabase -> Qdrant.

Objectif :
  - Relire la table `knowledge_documents` de Supabase
  - N’indexer que les documents absents de Qdrant ou dont `updated_at` a changé
  - Sinon : aucun appel embedding (skip)
"""

import asyncio
import logging
from typing import Any

import httpx

from config import settings
from core.rag_pipeline import RAGPipeline

logger = logging.getLogger(__name__)


async def sync_supabase_knowledge_to_qdrant(pipeline: RAGPipeline) -> int:
    """
    Relit tous les documents de `knowledge_documents` dans Supabase
    et n’appelle ingest (embed + upsert) que si nécessaire.

    Returns:
        Nombre de documents effectivement (ré)indexés (embeddings).
    """
    if not settings.supabase_url or not (
        settings.supabase_service_role_key or settings.supabase_anon_key
    ):
        logger.warning(
            "sync_supabase_knowledge_to_qdrant — SUPABASE_URL ou clé API manquante. "
            "Sync ignorée."
        )
        return 0

    api_key = settings.supabase_service_role_key or settings.supabase_anon_key
    base_url = settings.supabase_url.rstrip("/")
    url = f"{base_url}/rest/v1/knowledge_documents"

    headers = {
        "apikey": api_key,
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    # On récupère les champs utiles uniquement
    params: dict[str, Any] = {
        "select": "id,title,content,file_path,source_type,updated_at",
        "order": "id.asc",
        "limit": 5000,  # suffisant pour la plupart des cas ; à ajuster au besoin
    }

    logger.info("Sync Supabase -> Qdrant démarrée (lecture de knowledge_documents).")

    indexed_count = 0
    skipped_up_to_date = 0
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.get(url, headers=headers, params=params)
            if not resp.is_success:
                logger.error(
                    "sync_supabase_knowledge_to_qdrant — échec requête Supabase (%s) : %s",
                    resp.status_code,
                    resp.text[:500],
                )
                return 0

            rows = resp.json()
            if not isinstance(rows, list):
                logger.error(
                    "sync_supabase_knowledge_to_qdrant — réponse inattendue Supabase: %r",
                    rows,
                )
                return 0

            logger.info("Supabase a renvoyé %d document(s) à vérifier.", len(rows))

            store = pipeline._store  # type: ignore[attr-defined]
            try:
                qdrant_revs = await asyncio.get_event_loop().run_in_executor(
                    None,
                    store.collect_supabase_revisions_by_source,
                )
            except Exception as exc:  # pragma: no cover
                logger.warning(
                    "sync_supabase_knowledge_to_qdrant — lecture index révisions Qdrant : %s",
                    exc,
                )
                qdrant_revs = {}

            for row in rows:
                doc_id = row.get("id")
                content = (row.get("content") or "").strip()
                title = row.get("title") or ""
                file_path = row.get("file_path")
                source_type = row.get("source_type") or "manual"
                updated_at = row.get("updated_at")
                updated_at_s = str(updated_at).strip() if updated_at is not None else ""

                if not doc_id or not content:
                    # Rien à indexer pour ce document
                    continue

                source_id = f"supabase:{doc_id}"
                stored_rev = qdrant_revs.get(source_id)

                if stored_rev is not None and updated_at_s and stored_rev == updated_at_s:
                    skipped_up_to_date += 1
                    continue

                # Nouveau doc, contenu modifié, ou index sans supabase_updated_at : réindexer
                try:
                    await store.delete_document(source_id)
                except Exception as exc:  # pragma: no cover - dépend de Qdrant externe
                    logger.warning(
                        "sync_supabase_knowledge_to_qdrant — suppression partielle pour '%s' : %s",
                        source_id,
                        exc,
                    )

                metadata = {
                    "source": source_id,
                    "filename": title or file_path or f"doc_{doc_id}",
                    "page": 1,
                    "source_type": source_type,
                    "file_path": file_path,
                    "supabase_updated_at": updated_at_s,
                }

                try:
                    await pipeline.ingest_document(text=content, metadata=metadata)
                    indexed_count += 1
                except Exception as exc:  # pragma: no cover - dépend de Qdrant / OpenRouter
                    logger.error(
                        "sync_supabase_knowledge_to_qdrant — échec indexation doc_id=%s : %s",
                        doc_id,
                        exc,
                    )

    except Exception as exc:  # pragma: no cover - dépend IO externe
        logger.exception(
            "sync_supabase_knowledge_to_qdrant — erreur inattendue pendant la sync : %s",
            exc,
        )
        return indexed_count

    logger.info(
        "Sync Supabase -> Qdrant terminée — %d document(s) (ré)indexé(s), %d déjà à jour (skip).",
        indexed_count,
        skipped_up_to_date,
    )
    return indexed_count

