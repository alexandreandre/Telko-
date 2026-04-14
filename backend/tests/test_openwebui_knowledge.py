"""
Vérifie le choix de base documentaire pour Telko OpenWebUI :
- mode `telko` : Qdrant + appel stream sans paramètre `files` vers Open WebUI ;
- mode `openwebui` : prompt système délégué OW + `files` si configurés sur le provider.

Exécution : depuis `backend/` avec
  PYTHONPATH=. python3 -m unittest discover -s tests -p 'test_*.py' -v
"""

from __future__ import annotations

import asyncio
import unittest
from collections import defaultdict
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from core.llm.openwebui import OpenWebUIProvider, _DEFAULT_OPENWEBUI_FILES
from core.rag_pipeline import RAGPipeline


class RecordingOpenWebUI(OpenWebUIProvider):
    """Enregistre les arguments de stream() et le prompt système reçu."""

    def __init__(self) -> None:
        super().__init__(
            base_url="http://openwebui.test",
            api_key="test-key",
            model="test-model",
            timeout=5.0,
            chat_files=[{"type": "collection", "id": "coll-1"}],
        )
        self.captured_files_payload: object | None = None
        self.last_system_content: str | None = None

    async def stream(self, messages: list[dict], *, files_payload: object = _DEFAULT_OPENWEBUI_FILES):
        self.captured_files_payload = files_payload
        if messages and messages[0].get("role") == "system":
            self.last_system_content = str(messages[0].get("content", ""))
        yield "ok", None


def _bare_pipeline() -> RAGPipeline:
    """Pipeline sans __init__ (évite Qdrant / clés API au chargement)."""
    p = RAGPipeline.__new__(RAGPipeline)
    p._histories = defaultdict(list)
    store = MagicMock()
    store.similarity_search = AsyncMock(
        return_value=[
            SimpleNamespace(
                page_content="Contenu test indexé.",
                metadata={"source": "supabase:abc", "filename": "doc.txt"},
            )
        ]
    )
    store.fetch_all_by_source = MagicMock(return_value=[])
    store.get_last_embeddings_usage = MagicMock(return_value={})
    p._store = store
    return p


async def _consume_stream(gen):
    return [item async for item in gen]


class TestOpenWebUIPayload(unittest.TestCase):
    def test_payload_omits_files_when_empty_list(self) -> None:
        ow = OpenWebUIProvider(
            "http://x",
            "k",
            "m",
            chat_files=[{"type": "collection", "id": "1"}],
        )
        payload = ow._payload([{"role": "user", "content": "hi"}], stream=True, files=[])
        self.assertNotIn("files", payload)

    def test_payload_includes_configured_chat_files_by_default(self) -> None:
        ow = OpenWebUIProvider(
            "http://x",
            "k",
            "m",
            chat_files=[{"type": "collection", "id": "1"}],
        )
        payload = ow._payload([{"role": "user", "content": "hi"}], stream=True)
        self.assertIn("files", payload)
        self.assertEqual(payload["files"], [{"type": "collection", "id": "1"}])


class TestOpenWebUIStreamQueryBranches(unittest.TestCase):
    def test_telko_source_calls_stream_with_empty_files(self) -> None:
        async def run() -> None:
            pipeline = _bare_pipeline()
            llm = RecordingOpenWebUI()
            await _consume_stream(
                pipeline.stream_query(
                    message="Question ?",
                    conversation_id="c1",
                    user_id="u",
                    llm=llm,
                    openwebui_knowledge_source="telko",
                )
            )
            self.assertEqual(llm.captured_files_payload, [])
            self.assertIsNotNone(llm.last_system_content)
            self.assertIn("DOCUMENTS PERTINENTS", llm.last_system_content or "")
            self.assertIn("Contenu test indexé", llm.last_system_content or "")

        asyncio.run(run())

    def test_openwebui_source_calls_stream_without_files_override(self) -> None:
        async def run() -> None:
            pipeline = _bare_pipeline()
            llm = RecordingOpenWebUI()
            await _consume_stream(
                pipeline.stream_query(
                    message="Question ?",
                    conversation_id="c2",
                    user_id="u",
                    llm=llm,
                    openwebui_knowledge_source="openwebui",
                )
            )
            self.assertIs(llm.captured_files_payload, _DEFAULT_OPENWEBUI_FILES)
            self.assertIsNotNone(llm.last_system_content)
            self.assertIn("Open WebUI injecte", llm.last_system_content or "")
            self.assertNotIn("DOCUMENTS PERTINENTS", llm.last_system_content or "")

        asyncio.run(run())

    def test_none_source_defaults_to_telko(self) -> None:
        async def run() -> None:
            pipeline = _bare_pipeline()
            llm = RecordingOpenWebUI()
            await _consume_stream(
                pipeline.stream_query(
                    message="Q",
                    conversation_id="c3",
                    user_id="u",
                    llm=llm,
                    openwebui_knowledge_source=None,
                )
            )
            self.assertEqual(llm.captured_files_payload, [])

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
