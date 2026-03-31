"""
Client d'embeddings via Ollama.
Expose une fonction pour transformer un texte (question ou chunk de document)
en vecteur dense, en appelant le modèle d'embedding configuré dans OLLAMA_EMBED_MODEL.
"""

import asyncio
import logging
from itertools import islice
from typing import Iterator

import httpx
from langchain_ollama import OllamaEmbeddings

from config import settings

logger = logging.getLogger(__name__)

_BATCH_SIZE = 32  # Nombre maximum de textes traités par appel Ollama


def _batched(iterable: list[str], size: int) -> Iterator[list[str]]:
    """Découpe une liste en sous-listes de taille `size`."""
    it = iter(iterable)
    while batch := list(islice(it, size)):
        yield batch


class LocalEmbeddings:
    """
    Wrapper autour d'OllamaEmbeddings (langchain-ollama).

    Paramètres lus depuis config.settings :
      - ollama_base_url    : URL de l'instance Ollama
      - ollama_embed_model : modèle d'embedding (ex: nomic-embed-text)

    Le batch processing par groupes de 32 évite de saturer la RAM
    lors de l'ingestion de gros corpus de documents.
    """

    def __init__(self) -> None:
        self._model = settings.ollama_embed_model
        self._base_url = settings.ollama_base_url
        self._client = OllamaEmbeddings(
            model=self._model,
            base_url=self._base_url,
        )
        logger.info(
            "LocalEmbeddings initialisé — modèle=%s url=%s batch_size=%d",
            self._model,
            self._base_url,
            _BATCH_SIZE,
        )

    async def _check_reachable(self) -> None:
        """Vérifie qu'Ollama répond avant d'envoyer une requête."""
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(self._base_url)
                resp.raise_for_status()
        except (httpx.ConnectError, httpx.TimeoutException) as exc:
            raise RuntimeError(
                f"Ollama n'est pas joignable à '{self._base_url}'. "
                "Vérifiez qu'Ollama est démarré (`ollama serve`) et que "
                "OLLAMA_BASE_URL est correctement configuré."
            ) from exc

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """
        Génère les embeddings pour une liste de textes (chunks de documents).

        Traite les textes par lots de 32 pour ne pas saturer la RAM.

        Args:
            texts: Liste de chaînes à vectoriser.

        Returns:
            Liste de vecteurs (un par texte), chaque vecteur étant une list[float].

        Raises:
            RuntimeError: Si Ollama n'est pas joignable ou si l'embedding échoue.
            ValueError: Si la liste de textes est vide.
        """
        if not texts:
            raise ValueError("La liste de textes ne peut pas être vide.")

        await self._check_reachable()

        all_embeddings: list[list[float]] = []
        batches = list(_batched(texts, _BATCH_SIZE))
        logger.info(
            "Embedding de %d texte(s) en %d batch(es) de %d",
            len(texts),
            len(batches),
            _BATCH_SIZE,
        )

        for i, batch in enumerate(batches, start=1):
            logger.debug("Traitement batch %d/%d (%d textes)", i, len(batches), len(batch))
            try:
                batch_vectors = await asyncio.get_event_loop().run_in_executor(
                    None, self._client.embed_documents, batch
                )
                all_embeddings.extend(batch_vectors)
            except Exception as exc:
                logger.error("Erreur lors de l'embedding du batch %d : %s", i, exc)
                raise RuntimeError(f"Erreur d'embedding (batch {i}) : {exc}") from exc

        return all_embeddings

    async def embed_query(self, text: str) -> list[float]:
        """
        Génère l'embedding d'un texte unique (requête utilisateur ou titre).

        Args:
            text: Chaîne à vectoriser.

        Returns:
            Vecteur dense sous forme de list[float].

        Raises:
            RuntimeError: Si Ollama n'est pas joignable ou si l'embedding échoue.
            ValueError: Si le texte est vide.
        """
        if not text or not text.strip():
            raise ValueError("Le texte à vectoriser ne peut pas être vide.")

        await self._check_reachable()

        try:
            vector = await asyncio.get_event_loop().run_in_executor(
                None, self._client.embed_query, text
            )
            return vector
        except Exception as exc:
            logger.error("Erreur lors de l'embedding de la requête : %s", exc)
            raise RuntimeError(f"Erreur d'embedding (query) : {exc}") from exc


# ---------------------------------------------------------------------------
# Tests basiques — exécuter avec : python core/embeddings.py
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import os
    import sys

    # Permet d'importer config.py depuis le dossier backend/
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    embedder = LocalEmbeddings()

    async def test_embed_query() -> None:
        print("\n=== TEST embed_query() ===")
        vector = await embedder.embed_query("Qu'est-ce que le RAG ?")
        assert isinstance(vector, list), "Le résultat doit être une liste"
        assert all(isinstance(v, float) for v in vector), "Tous les éléments doivent être des float"
        print(f"Dimension : {len(vector)}")
        print(f"Extrait   : {vector[:5]}")
        print("OK")

    async def test_embed_documents_small() -> None:
        print("\n=== TEST embed_documents() — petit corpus ===")
        texts = [
            "Le RAG améliore la précision des LLM.",
            "Qdrant est une base vectorielle haute performance.",
            "Ollama permet d'exécuter des LLM en local.",
        ]
        vectors = await embedder.embed_documents(texts)
        assert len(vectors) == len(texts), f"Attendu {len(texts)} vecteurs, obtenu {len(vectors)}"
        dim = len(vectors[0])
        print(f"Nombre de vecteurs : {len(vectors)}")
        print(f"Dimension          : {dim}")
        assert all(len(v) == dim for v in vectors), "Tous les vecteurs doivent avoir la même dimension"
        print("OK")

    async def test_embed_documents_batching() -> None:
        print("\n=== TEST embed_documents() — batch processing (70 textes) ===")
        texts = [f"Document de test numéro {i}." for i in range(70)]
        vectors = await embedder.embed_documents(texts)
        assert len(vectors) == 70, f"Attendu 70 vecteurs, obtenu {len(vectors)}"
        print(f"Nombre de vecteurs : {len(vectors)}")
        print("OK — 3 batches traités (32 + 32 + 6)")

    async def test_empty_raises() -> None:
        print("\n=== TEST erreurs attendues ===")
        try:
            await embedder.embed_documents([])
            raise AssertionError("Doit lever ValueError pour liste vide")
        except ValueError:
            print("OK — ValueError sur liste vide")

        try:
            await embedder.embed_query("   ")
            raise AssertionError("Doit lever ValueError pour texte vide")
        except ValueError:
            print("OK — ValueError sur texte vide")

    async def run_all() -> None:
        await test_embed_query()
        await test_embed_documents_small()
        await test_embed_documents_batching()
        await test_empty_raises()
        print("\nTous les tests sont passés.")

    asyncio.run(run_all())
