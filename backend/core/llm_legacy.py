# DEPRECATED — remplacé par backend/core/llm/
# Ne plus importer ce fichier.
# Conservé uniquement pour référence historique.
"""
Client LLM via Ollama.
Expose une fonction de génération de texte en streaming à partir d'un prompt
et d'un historique de messages, en appelant le modèle configuré dans OLLAMA_LLM_MODEL.
"""

import asyncio
import logging
from typing import AsyncGenerator

import httpx
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_ollama import ChatOllama

from config import settings

logger = logging.getLogger(__name__)

# Type pour un message d'historique : {"role": "user"|"assistant"|"system", "content": str}
HistoryMessage = dict[str, str]


def _build_messages(prompt: str, history: list[HistoryMessage]) -> list[BaseMessage]:
    """Convertit l'historique dict en objets LangChain BaseMessage."""
    lc_messages: list[BaseMessage] = []
    for msg in history:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "system":
            lc_messages.append(SystemMessage(content=content))
        elif role == "assistant":
            lc_messages.append(AIMessage(content=content))
        else:
            lc_messages.append(HumanMessage(content=content))
    lc_messages.append(HumanMessage(content=prompt))
    return lc_messages


class OllamaLLMWrapper:
    """
    Wrapper autour de ChatOllama (langchain-ollama).

    Paramètres lus depuis config.settings :
      - ollama_base_url   : URL de l'instance Ollama
      - ollama_llm_model  : modèle à utiliser (ex: mistral, llama3)

    Timeout fixé à 120 secondes pour les réponses longues.
    """

    def __init__(self) -> None:
        self._model = settings.ollama_llm_model
        self._base_url = settings.ollama_base_url
        self._client = ChatOllama(
            model=self._model,
            base_url=self._base_url,
            timeout=120,
        )
        logger.info("OllamaLLMWrapper initialisé — modèle=%s url=%s", self._model, self._base_url)

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

    async def invoke(self, prompt: str, history: list[HistoryMessage] | None = None) -> str:
        """
        Appelle le LLM et retourne la réponse complète sous forme de str.

        Args:
            prompt:  Question ou instruction de l'utilisateur.
            history: Historique de messages [{"role": ..., "content": ...}].

        Returns:
            Texte de la réponse du modèle.

        Raises:
            RuntimeError: Si Ollama n'est pas joignable.
        """
        await self._check_reachable()
        messages = _build_messages(prompt, history or [])
        try:
            response = await self._client.ainvoke(messages)
            return response.content
        except Exception as exc:
            logger.error("Erreur lors de l'appel LLM : %s", exc)
            raise RuntimeError(f"Erreur LLM : {exc}") from exc

    async def stream(
        self, prompt: str, history: list[HistoryMessage] | None = None
    ) -> AsyncGenerator[str, None]:
        """
        Appelle le LLM et yield les tokens au fur et à mesure.

        Args:
            prompt:  Question ou instruction de l'utilisateur.
            history: Historique de messages [{"role": ..., "content": ...}].

        Yields:
            Fragments de texte (tokens) retournés par le modèle.

        Raises:
            RuntimeError: Si Ollama n'est pas joignable.
        """
        await self._check_reachable()
        messages = _build_messages(prompt, history or [])
        try:
            async for chunk in self._client.astream(messages):
                if chunk.content:
                    yield chunk.content
        except Exception as exc:
            logger.error("Erreur pendant le streaming LLM : %s", exc)
            raise RuntimeError(f"Erreur LLM (stream) : {exc}") from exc


# ---------------------------------------------------------------------------
# Tests basiques — exécuter avec : python core/llm.py
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import os
    import sys

    # Permet d'importer config.py depuis le dossier backend/
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    llm = OllamaLLMWrapper()

    async def test_invoke() -> None:
        print("\n=== TEST invoke() ===")
        response = await llm.invoke("Réponds en une phrase : qu'est-ce que le RAG ?")
        print(f"Réponse : {response}")
        assert isinstance(response, str) and len(response) > 0, "La réponse doit être une str non vide"
        print("OK")

    async def test_stream() -> None:
        print("\n=== TEST stream() ===")
        tokens: list[str] = []
        async for token in llm.stream(
            "Cite 3 avantages du RAG.",
            history=[{"role": "system", "content": "Tu es un assistant concis."}],
        ):
            print(token, end="", flush=True)
            tokens.append(token)
        print()
        assert len(tokens) > 0, "Le stream doit produire au moins un token"
        print("OK")

    async def test_history() -> None:
        print("\n=== TEST historique ===")
        history = [
            {"role": "user", "content": "Mon prénom est Alice."},
            {"role": "assistant", "content": "Bonjour Alice !"},
        ]
        response = await llm.invoke("Quel est mon prénom ?", history=history)
        print(f"Réponse : {response}")
        assert "alice" in response.lower(), "Le modèle doit se souvenir du prénom"
        print("OK")

    async def run_all() -> None:
        await test_invoke()
        await test_stream()
        await test_history()
        print("\nTous les tests sont passés.")

    asyncio.run(run_all())
